"""Catálogo de mineros desde la API pública de rollercoincalculator.

Fuente: `/api/Miner` (RULES.md §6), paginado, 1 ítem por (nombre, nivel),
incluidos los mineros sin merge. Su `level` arranca en 0 (= nivel base del
juego) -> `level` que exponemos = `api_level + 1` (base = 1, ... API 5 = 6).
"""

from __future__ import annotations

import json
import threading
import time
from pathlib import Path
from typing import Callable

import httpx

_BASE = "https://api.rollercoincalculator.app/api"
_CDN = "https://cdn.rollercoincalculator.app"
_PAGE_SIZE = 1000
_CACHE_FILE = Path(__file__).resolve().parent.parent / ".cache" / "catalog.json"
_SEED_FILE = Path(__file__).resolve().parent / "data" / "catalog_seed.json"
_TTL_SECONDS = 7 * 24 * 3600

# La API tolera ~5 req/s en 1 conexión hasta ~80 seguidas y después empieza a
# colgar/timeout (no manda 429 limpio). Estrategia: ~3 req/s y una pausa cada
# _BURST requests.
_MAX_RPS = 3.0
_MAX_RETRIES = 5
_BURST = 60
_BURST_PAUSE = 20.0


def _eta_seconds(requests: int) -> int:
    """Cuánto tarda hacer `requests` pedidos con el limitador (~3 req/s más
    la pausa por ráfaga). Sirve para avisar en la UI antes de arrancar."""
    if requests <= 0:
        return 0
    return int(requests / _MAX_RPS + (requests // _BURST) * _BURST_PAUSE)


class _RateLimiter:
    def __init__(self, rps: float) -> None:
        self._min_interval = 1.0 / rps
        self._lock = threading.Lock()
        self._next = 0.0

    def wait(self) -> None:
        with self._lock:
            now = time.monotonic()
            sleep_for = self._next - now
            self._next = max(now, self._next) + self._min_interval
        if sleep_for > 0:
            time.sleep(sleep_for)


_limiter = _RateLimiter(_MAX_RPS)


# El CDN de RollerCoin quita los apóstrofos del nombre de archivo
# ("Captain's Fortune" -> captains_fortune.png), pero la API a veces devuelve el
# `fileName` con la comilla tipográfica (’) intacta -> URL rota. Se sanea aquí.
_FNAME_STRIP = str.maketrans({"'": "", "’": "", "ʼ": "", "`": ""})
# Excepciones: archivos que en el CDN SÍ conservan la comilla tipográfica
# (verificado contra el CDN, RULES.md §6). Clave = nombre ya saneado.
_CDN_KEEPS_APOSTROPHE = {
    "corsairs_oath": "corsair%E2%80%99s_oath",
    "satoshis_chest": "satoshi%E2%80%99s_chest",
}


def _image_url(file_name: str | None, version: int | None) -> str:
    if not file_name:
        return ""
    file_name = file_name.translate(_FNAME_STRIP)
    file_name = _CDN_KEEPS_APOSTROPHE.get(file_name, file_name)
    return f"{_CDN}/miners/{file_name}.png" + (f"?v={version}" if version else "")


def _model_from_miner(it: dict) -> dict:
    api_level = int(it.get("level") or 0)
    return {
        "id": it["id"],
        "name": it["name"],
        "api_level": api_level,
        "level": api_level + 1,
        "power": int(it["power"]),               # GH/s
        "bonus_bp": int(it.get("percent") or 0),  # bp (10000 = 100%)
        "width": int(it.get("width") or 1),
        "image": _image_url(it.get("fileName"), it.get("imageVersion")),
    }


_QUOTES = str.maketrans({"’": "'", "ʼ": "'", "`": "'"})


def _canonical_names(miners: list[dict]) -> list[dict]:
    """La API mezcla comilla recta y tipográfica entre niveles de un mismo
    minero ("King's Legacy" base, "King’s Legacy" el resto) y el catálogo
    agrupa por nombre: a todo el grupo se le pone el nombre de su nivel más
    alto (RULES.md §6)."""
    canon: dict[str, tuple[int, str]] = {}
    for m in miners:
        key = m["name"].translate(_QUOTES)
        if key not in canon or m["api_level"] > canon[key][0]:
            canon[key] = (m["api_level"], m["name"])
    return [{**m, "name": canon[m["name"].translate(_QUOTES)][1]} for m in miners]


_req_count = 0


def _get(client: httpx.Client, path: str, params: dict) -> httpx.Response | None:
    """GET con limitador global + pausa por ráfaga + backoff en 429/5xx/timeout.
    Devuelve None si se agotan los reintentos (no lanza)."""
    global _req_count
    delay = 3.0
    for _ in range(_MAX_RETRIES):
        _limiter.wait()
        _req_count += 1
        if _req_count % _BURST == 0:
            time.sleep(_BURST_PAUSE)
        try:
            r = client.get(f"{_BASE}{path}", params=params)
        except (httpx.TimeoutException, httpx.HTTPError):
            time.sleep(delay)
            delay = min(delay * 2, 60)
            continue
        if r.status_code == 429 or r.status_code >= 500:
            retry_after = r.headers.get("Retry-After")
            wait = float(retry_after) if (retry_after or "").replace(".", "", 1).isdigit() else delay
            time.sleep(min(wait, 60))
            delay = min(delay * 2, 60)
            continue
        return r if r.is_success else None
    return None


def _fetch_miners(
    client: httpx.Client,
    on_total: Callable[[int], None] | None = None,
    on_page: Callable[[list[dict]], None] | None = None,
) -> tuple[list[dict], bool]:
    """Todas las páginas de `/Miner` como modelos. Devuelve (modelos, completo);
    `completo` es False si alguna página no se pudo traer. `on_total(n)` recibe
    el total de modelos que anuncia la API (con la 1ª página) y `on_page` los
    modelos de cada página."""
    out: list[dict] = []
    index = 0
    while True:
        resp = _get(
            client,
            "/Miner",
            {"PageRequest.PageIndex": index, "PageRequest.PageSize": _PAGE_SIZE},
        )
        if resp is None:
            return out, False
        body = resp.json()
        if index == 0 and on_total:
            on_total(int(body.get("count") or 0))
        page = [_model_from_miner(it) for it in body.get("items") or []]
        out.extend(page)
        if on_page:
            on_page(page)
        if not page or not body.get("hasNext"):
            return out, True
        index += 1
        if index > 100:
            return out, True


def _new_client() -> httpx.Client:
    return httpx.Client(timeout=60, headers={"User-Agent": "optimizador-roller/0.1"})


# True si el último refresh no pudo traer todas las páginas
last_refresh_incomplete = False


def _fetch_all(
    previous: list[dict] | None = None,
    on_total: Callable[[int], None] | None = None,
    on_progress: Callable[[int, list[dict]], None] | None = None,
) -> list[dict]:
    """`on_total(n)` = modelos que anuncia la API; `on_progress(done, batch)`
    después de cada página, con el conteo acumulado y los modelos de ESA
    página (para que quien llama vaya mezclando el catálogo en vivo)."""
    global last_refresh_incomplete
    # arranca de lo que ya teníamos: un refresh parcial nunca pierde datos
    miners: dict[str, dict] = {m["id"]: m for m in (previous or [])}
    done = 0

    def on_page(page: list[dict]) -> None:
        nonlocal done
        for m in page:
            miners[m["id"]] = m
        done += len(page)
        if on_progress:
            on_progress(done, page)

    with _new_client() as client:
        _, complete = _fetch_miners(client, on_total=on_total, on_page=on_page)

    last_refresh_incomplete = not complete
    return sorted(_canonical_names(list(miners.values())), key=lambda m: (m["name"], m["level"]))


def _read_json(path: Path) -> tuple[list[dict], float, float] | None:
    """(miners, fetched_at, mtime) o None."""
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data["miners"], float(data["fetched_at"]), path.stat().st_mtime
    except (json.JSONDecodeError, KeyError, OSError):
        return None


def _read_cache() -> tuple[list[dict], float, float] | None:
    """El más nuevo entre .cache/catalog.json y el seed del repo."""
    candidates = [c for c in (_read_json(_CACHE_FILE), _read_json(_SEED_FILE)) if c]
    if not candidates:
        return None
    return max(candidates, key=lambda c: c[2])  # por mtime


def _write_cache(miners: list[dict]) -> None:
    _CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
    _CACHE_FILE.write_text(
        json.dumps({"fetched_at": time.time(), "miners": miners}), encoding="utf-8"
    )


class Catalog:
    def __init__(self) -> None:
        self._miners: list[dict] = []
        self._fetched_at: float = 0.0
        self._disk_mtime: float = 0.0
        self._refreshing = False
        self._refresh_lock = threading.Lock()
        # modelos traídos / total que anuncia la API en el refresh en curso
        # (0/0 cuando no hay refresh corriendo). El total llega con la 1ª
        # página -> arranca en 0 y salta al valor real apenas se conoce.
        self._progress_done = 0
        self._progress_total = 0
        self._load_from_disk()

    def _load_from_disk(self) -> bool:
        cached = _read_cache()
        if not cached:
            return False
        self._miners, self._fetched_at, self._disk_mtime = cached
        return True

    @property
    def stale(self) -> bool:
        return (time.time() - self._fetched_at) > _TTL_SECONDS

    @property
    def fetched_at(self) -> float:
        return self._fetched_at

    def ensure(self, force: bool = False) -> None:
        # Si el seed/caché en disco cambió (p. ej. scripts/build_seed.py), recargar.
        for path in (_CACHE_FILE, _SEED_FILE):
            try:
                if path.exists() and path.stat().st_mtime > self._disk_mtime:
                    self._load_from_disk()
                    break
            except OSError:
                pass
        # NO refresca por antigüedad de forma automática (bloquearía la
        # request). Solo si no hay datos o si se fuerza.
        if force or not self._miners:
            self.refresh()

    @property
    def refreshing(self) -> bool:
        return self._refreshing

    def refresh(self) -> None:
        """Bloqueante (segundos: ~9 páginas). No-op si ya hay otro refresh en
        curso. `self._miners` se va actualizando en vivo página a página."""
        if not self._refresh_lock.acquire(blocking=False):
            return
        self._refreshing = True
        self._progress_done = 0
        self._progress_total = 0
        merged: dict[str, dict] = {m["id"]: m for m in self._miners}

        def on_total(n: int) -> None:
            self._progress_total = n

        def on_progress(done: int, batch: list[dict]) -> None:
            for m in batch:
                merged[m["id"]] = m
            self._miners = list(merged.values())
            self._progress_done = done

        try:
            self._miners = _fetch_all(
                previous=self._miners,
                on_total=on_total,
                on_progress=on_progress,
            )
            self._fetched_at = time.time()
            _write_cache(self._miners)
            try:
                self._disk_mtime = _CACHE_FILE.stat().st_mtime
            except OSError:
                pass
        finally:
            self._refreshing = False
            self._progress_done = 0
            self._progress_total = 0
            self._refresh_lock.release()

    def refresh_async(self) -> bool:
        """Lanza refresh() en un hilo. Devuelve False si ya había uno corriendo."""
        if self._refreshing:
            return False
        threading.Thread(target=self.refresh, name="catalog-refresh", daemon=True).start()
        return True

    def autosync_async(self) -> bool:
        """Puesta al día al arrancar. En un hosting con disco efímero (Render
        duerme el servicio por inactividad y vuelve a levantar un contenedor
        nuevo) se pierde `.cache/catalog.json` y el catálogo retrocede al seed
        de la imagen; esto lo vuelve a poner al día solo."""
        if not self._miners:
            return False
        return self.refresh_async()

    @property
    def progress(self) -> dict:
        """{done, total} modelos traídos / anunciados del refresh en curso.
        {0, 0} si no hay ninguno corriendo."""
        return {"done": self._progress_done, "total": self._progress_total}

    @property
    def missing_base(self) -> int:
        """Nombres sin su nivel base (1). Indica un catálogo incompleto."""
        names = {m["name"] for m in self._miners}
        have_base = {m["name"] for m in self._miners if m["level"] == 1}
        return len(names - have_base)

    def check_for_updates(self) -> dict:
        """Compara el listado de la API con lo que ya tenemos, sin tocar el
        catálogo (se puede llamar aunque haya un refresh en curso).
        `pending` = nombres a los que les falta algún modelo."""
        with _new_client() as client:
            remote, _ = _fetch_miners(client)
        remote = _canonical_names(remote)
        local_ids = {m["id"] for m in self._miners}
        remote_names = {r["name"] for r in remote}
        local_names = {m["name"] for m in self._miners}
        new_names = sorted(remote_names - local_names)
        pending = len({r["name"] for r in remote if r["id"] not in local_ids})
        return {
            "remote_names": len(remote_names),
            "local_names": len(local_names),
            "new_count": len(new_names),
            "new_names": new_names[:50],
            "pending": pending,
            "eta_seconds": _eta_seconds(-(-len(remote) // _PAGE_SIZE)) if pending else 0,
        }

    def all(self) -> list[dict]:
        self.ensure()
        return self._miners

    def search(self, term: str = "", limit: int = 50) -> list[dict]:
        self.ensure()
        term = (term or "").strip().lower()
        hits = self._miners if not term else [m for m in self._miners if term in m["name"].lower()]
        return hits[: max(1, limit)]


catalog = Catalog()


class RoomSyncError(Exception):
    """Fallo al consultar la sala real de un usuario en la API de RollerCoin."""


# Sala 1 (la única con vista visual hoy) = 12 racks de 4 estantes x 2 celdas
# c/u = 96 celdas, igual que `ROOM1_CELLS` del frontend (frontend/src/store.ts).
_ROOM1_SHELVES_PER_RACK = 4
_ROOM1_CELLS_PER_SHELF = 2
_ROOM1_CELLS_PER_RACK = _ROOM1_SHELVES_PER_RACK * _ROOM1_CELLS_PER_SHELF  # 8
_ROOM1_MAX_RACKS = 12
_ROOM1_CELLS = _ROOM1_MAX_RACKS * _ROOM1_CELLS_PER_RACK  # 96


def fetch_user_room(user_id: str) -> dict:
    """Sala real (ya puesta en el juego) de `user_id`, vía
    `/RollercoinUser/room?userId=...` (mismo host que el catálogo). Cada
    minero puesto en el juego trae ya sus propios `power`/`bonus_percent`/
    `width`/`filename` -- no hace falta cruzar contra el catálogo local, así
    que esto funciona igual aunque el catálogo esté desactualizado.

    Devuelve `{"items": [...], "room_slots": [...]}`:
      - `items`: 1 dict por (id, nivel) distinto con `count` = copias
        puestas, ordenado de mayor a menor cantidad -- de TODAS las salas
        físicas que tenga la cuenta, así que el poder siempre da bien
        aunque haya más de una.
      - `room_slots`: 96 celdas (mismo layout que `ROOM1_CELLS` del
        frontend) con el id puesto en cada una, replicando el orden real
        del juego -- pero solo de la PRIMERA sala física (`rooms[0]`, la
        que el juego llama "Sala 1"). Los racks de esa sala se ordenan en
        orden de lectura (arriba-izq a abajo-der, según
        `racks[].placement.x/y`) y, dentro de cada rack, el mismo
        estante/lado (`miners[].placement.x/y`) que en RollerCoin. Los
        mineros puestos en una 2ª/3ª sala física no entran en el dibujo
        (nuestra vista visual hoy solo cubre una sala), pero sí siguen
        contados en `items[].count`.

    Sin reintentos para un `userId` inexistente: la API devuelve 500 (no
    404), y reintentarlo como si fuera un error transitorio del servidor
    solo haría esperar minutos para nada -- se falla rápido y se informa.
    Un 429 sí es transitorio de verdad (dos clicks seguidos en "recargar
    sala" alcanzan para gatillarlo) -- ahí se espera un toque y se
    reintenta una vez antes de rendirse."""
    def _do_request() -> httpx.Response:
        try:
            with httpx.Client(timeout=20, headers={"User-Agent": "optimizador-roller/0.1"}) as client:
                return client.get(f"{_BASE}/RollercoinUser/room", params={"userId": user_id})
        except httpx.HTTPError as exc:
            raise RoomSyncError(
                "No se pudo conectar con RollerCoin. Inténtalo de nuevo en unos minutos."
            ) from exc

    r = _do_request()
    if r.status_code == 429:
        time.sleep(3)
        r = _do_request()
    if r.status_code == 429:
        raise RoomSyncError(
            "RollerCoin está limitando las consultas en este momento. Espera unos segundos e inténtalo de nuevo."
        )
    if r.status_code != 200:
        raise RoomSyncError("No se encontró la sala. Verifica que el ID de usuario sea correcto.")
    try:
        body = r.json()
    except json.JSONDecodeError as exc:
        raise RoomSyncError(
            "RollerCoin devolvió una respuesta inesperada. Inténtalo de nuevo en unos minutos."
        ) from exc

    # las coordenadas (x, y) de cada rack son relativas a SU sala -- una
    # cuenta con 2+ salas físicas puede perfectamente tener un rack en
    # (0, 0) en cada una. Sin filtrar por sala antes de ordenar, los racks
    # de todas las salas quedarían mezclados en una sola lista (y los
    # primeros 12 que "ganen" el orden podrían ser una mezcla arbitraria de
    # varias salas reales, no una sola). Se elige la primera sala física
    # (`rooms[0]`, la "Sala 1" del juego) y solo se posicionan sus racks.
    all_rooms = body.get("rooms") or []
    room1_id = (all_rooms[0] or {}).get("_id") if all_rooms else None
    room_racks = body.get("racks") or []
    if room1_id is not None:
        room_racks = [rk for rk in room_racks if (rk.get("placement") or {}).get("user_room_id") == room1_id]

    # orden de lectura de los racks de esa sala: fila (y) y luego columna
    # (x), como se ven en el juego -- la API no manda un "índice" de rack.
    racks = sorted(
        room_racks,
        key=lambda rk: ((rk.get("placement") or {}).get("y", 0), (rk.get("placement") or {}).get("x", 0)),
    )
    rack_index = {rk["_id"]: i for i, rk in enumerate(racks) if rk.get("_id")}

    slots: list[str | None] = [None] * _ROOM1_CELLS
    grouped: dict[str, dict] = {}
    for m in body.get("miners") or []:
        mid = m.get("miner_id")
        if not mid:
            continue
        if mid not in grouped:
            api_level = int(m.get("level") or 0)
            grouped[mid] = {
                "id": mid,
                "name": m.get("name", ""),
                "api_level": api_level,
                "level": api_level + 1,
                "power": int(m.get("power") or 0),
                "bonus_bp": int(m.get("bonus_percent") or 0),
                "width": int(m.get("width") or 1),
                "image": _image_url(m.get("filename"), None),
                "count": 0,
            }
        grouped[mid]["count"] += 1

        placement = m.get("placement") or {}
        ri = rack_index.get(placement.get("user_rack_id"))
        local_y = int(placement.get("y") or 0)
        if ri is None or ri >= _ROOM1_MAX_RACKS or not (0 <= local_y < _ROOM1_SHELVES_PER_RACK):
            continue  # no entra en la vista de 12 racks / 4 estantes de sala 1
        shelf_start = ri * _ROOM1_CELLS_PER_RACK + local_y * _ROOM1_CELLS_PER_SHELF
        if grouped[mid]["width"] >= 2:
            # un minero de 2 celdas ocupa el estante entero (la API manda
            # x=0 para el único registro que representa ambas celdas).
            slots[shelf_start] = mid
            slots[shelf_start + 1] = mid
        else:
            local_x = int(placement.get("x") or 0)
            slots[shelf_start + (1 if local_x else 0)] = mid

    items = sorted(grouped.values(), key=lambda x: (-x["count"], x["name"]))
    return {"items": items, "room_slots": slots}
