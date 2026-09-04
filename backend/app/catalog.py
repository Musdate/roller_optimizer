"""Catálogo de mineros desde la API pública de rollercoincalculator.

Ojo con los niveles (ver RULES.md §6): la API es de *merges*, su `resultItemLevel`
arranca en 1 pero ese "1" es en realidad el **nivel 2** del juego. El **nivel base**
(nivel 1 real) nunca aparece como resultado: solo vive dentro de `requiredItems`
del recipe de nivel 1. Por eso:

  1. traemos los resultados (niveles API 1..5) del listado masivo `/api/Merges`;
  2. traemos los mineros base con `/api/Merges/get-by-miner-name` (1 llamada por
     nombre, en paralelo) y sacamos los `requiredItems` de tipo "miners";
  3. `level` que exponemos = `api_level + 1`  → base = 1, API 1 = 2, ... API 5 = 6.
"""

from __future__ import annotations

import json
import threading
import time
from concurrent.futures import ThreadPoolExecutor
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
# colgar/timeout (no manda 429 limpio). Estrategia: 1 sola conexión, ~3 req/s,
# y una pausa cada _BURST requests. refresh() hace merge y saltea nombres que ya
# tienen su nivel base -> reintentar completa lo que falte.
_CONCURRENCY = 1
_MAX_RPS = 3.0
_MAX_RETRIES = 5
_BURST = 60
_BURST_PAUSE = 20.0


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


def _image_url(file_name: str | None, version: int | None) -> str:
    if not file_name:
        return ""
    file_name = file_name.translate(_FNAME_STRIP)
    return f"{_CDN}/miners/{file_name}.png" + (f"?v={version}" if version else "")


def _model_from_result(it: dict) -> dict:
    api_level = int(it["resultItemLevel"])
    return {
        "id": it["resultItemId"],
        "name": it["resultItemName"],
        "api_level": api_level,
        "level": api_level + 1,
        "power": int(it["resultItemPower"]),        # GH/s
        "bonus_bp": int(it["resultItemPercent"]),   # bp (10000 = 100%)
        "width": int(it.get("resultItemWidth") or 1),
        "image": _image_url(it.get("resultItemFileName"), it.get("resultItemImageVersion")),
    }


def _model_from_required(ri: dict, name: str | None = None) -> dict | None:
    # `name` = nombre canónico del recipe padre. La API a veces devuelve el
    # `itemName` del ingrediente con la comilla distinta (recta vs. tipográfica),
    # lo que rompe el agrupado por nombre.
    if ri.get("type") != "miners" or ri.get("power") is None:
        return None
    api_level = int(ri.get("level") or 0)
    return {
        "id": ri["itemId"],
        "name": name or ri.get("itemName", ""),
        "api_level": api_level,
        "level": api_level + 1,
        "power": int(ri["power"]),
        "bonus_bp": int(ri.get("percent") or 0),
        "width": int(ri.get("width") or 1),
        "image": _image_url(ri.get("fileName"), ri.get("imageVersion")),
    }


def _fetch_results(client: httpx.Client) -> list[dict]:
    out: list[dict] = []
    index = 0
    while True:
        resp = _get(
            client,
            "/Merges",
            {"PageRequest.PageIndex": index, "PageRequest.PageSize": _PAGE_SIZE},
        )
        if resp is None:
            break
        body = resp.json()
        items = body["items"] if isinstance(body, dict) else body
        if not items:
            break
        out.extend(items)
        if isinstance(body, dict) and not body.get("hasNext"):
            break
        index += 1
        if index > 100:
            break
    return out


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


def _fetch_ladder(client: httpx.Client, name: str) -> list[dict]:
    r = _get(client, "/Merges/get-by-miner-name", {"minerName": name})
    if r is None:
        return []
    try:
        return r.json() or []
    except json.JSONDecodeError:
        return []


# nº de nombres cuyo fetch de escalera falló en el último refresh
last_refresh_failures = 0


def _fetch_all(
    previous: list[dict] | None = None,
    on_total: Callable[[int], None] | None = None,
    on_progress: Callable[[int, list[dict]], None] | None = None,
) -> list[dict]:
    """`on_total(n)` se llama una vez, apenas se sabe cuántos NOMBRES faltan
    por escalar (después del listado masivo, antes del loop lento).
    `on_progress(done, batch)` se llama después de cada nombre resuelto, con
    el conteo acumulado y los modelos nuevos de ESE nombre (para que quien
    llama pueda ir mezclando el catálogo en vivo, no solo al terminar)."""
    global last_refresh_failures
    # arranca de lo que ya teníamos: un refresh parcial nunca pierde datos
    miners: dict[str, dict] = {m["id"]: m for m in (previous or [])}
    failures = 0

    with httpx.Client(timeout=60, headers={"User-Agent": "optimizador-roller/0.1"}) as client:
        # 1) resultados API 1..5 (listado masivo)
        for it in _fetch_results(client):
            miners[it["resultItemId"]] = _model_from_result(it)

        # 2) escalera + mineros base vía get-by-miner-name.
        # Saltea los nombres que YA tienen su nivel base (1): así reintentar
        # refresh() solo pega a los que faltan y converge en 2–3 pasadas.
        have_base = {m["name"] for m in miners.values() if m["level"] == 1}
        todo = sorted({m["name"] for m in miners.values()} - have_base)
        if on_total:
            on_total(len(todo))

        def worker(name: str) -> tuple[list[dict], bool]:
            recipes = _fetch_ladder(client, name)
            if not recipes:
                return [], True
            found: list[dict] = []
            for recipe in recipes:
                found.append(_model_from_result(recipe))
                for ri in recipe.get("requiredItems", []):
                    m = _model_from_required(ri, name=recipe.get("resultItemName"))
                    if m:
                        found.append(m)
            return found, False

        with ThreadPoolExecutor(max_workers=_CONCURRENCY) as pool:
            done = 0
            for batch, failed in pool.map(worker, todo):
                if failed:
                    failures += 1
                for m in batch:
                    miners[m["id"]] = m
                done += 1
                if on_progress:
                    on_progress(done, batch)

    last_refresh_failures = failures
    return sorted(miners.values(), key=lambda m: (m["name"], m["level"]))


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
        # nombres resueltos / total de nombres a resolver en el refresh en
        # curso (0/0 cuando no hay refresh corriendo). Se sabe recién
        # después del listado masivo -> total arranca en 0 y salta al valor
        # real apenas se conoce.
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
        # NO refresca por antigüedad de forma automática (tardaría minutos y
        # bloquearía la request). Solo si no hay datos o si se fuerza.
        if force or not self._miners:
            self.refresh()

    @property
    def refreshing(self) -> bool:
        return self._refreshing

    def refresh(self) -> None:
        """Bloqueante. Descarga completa (~15-20 min por el rate-limit).
        No-op si ya hay otro refresh en curso. `self._miners` (y por lo
        tanto `missing_base`/`all()`) se va actualizando EN VIVO a medida
        que cada nombre termina, no recién al final -- antes quedaba
        pegado al valor de antes de empezar durante los 15-20 min enteros."""
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
            self._miners = _fetch_all(previous=self._miners, on_total=on_total, on_progress=on_progress)
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

    @property
    def progress(self) -> dict:
        """{done, total} nombres resueltos / a resolver del refresh en
        curso. {0, 0} si no hay ninguno corriendo."""
        return {"done": self._progress_done, "total": self._progress_total}

    @property
    def missing_base(self) -> int:
        """Nombres sin su nivel base (1). Indica un fetch incompleto."""
        names = {m["name"] for m in self._miners}
        have_base = {m["name"] for m in self._miners if m["level"] == 1}
        return len(names - have_base)

    def check_for_updates(self) -> dict:
        """Fetch rápido (solo el listado masivo, sin la escalera por nombre
        que es lo lento) para saber cuántos nombres distintos hay AHORA en
        la API de RollerCoin vs. los que ya tenemos, sin arrancar el
        refresh completo (~15-20 min). No toca el catálogo ni compite con
        `refresh()` -- se puede llamar aunque haya uno en curso."""
        with httpx.Client(timeout=30, headers={"User-Agent": "optimizador-roller/0.1"}) as client:
            results = _fetch_results(client)
        remote_names = {r["resultItemName"] for r in results}
        local_names = {m["name"] for m in self._miners}
        new_names = sorted(remote_names - local_names)
        return {
            "remote_names": len(remote_names),
            "local_names": len(local_names),
            "new_count": len(new_names),
            "new_names": new_names[:50],
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
