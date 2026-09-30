"""Minijuego de excavación de Sunflower Land (RULES.md §11).

Solo datos: patrones del día y hoyos excavados de una granja, desde el API
comunitario. El solver vive en el frontend (`excavacion.ts`).
"""

from __future__ import annotations

import json
import os
import re
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx

_API = "https://api.sunflower-land.com/community/farms/{id}"
_GITHUB_RAW = "https://raw.githubusercontent.com/sunflower-land/sunflower-land/main/src/"
_GAME_ASSETS = "https://sunflower-land.com/game-assets"
_SEED_FILE = Path(__file__).resolve().parent / "data" / "digging_seed.json"
_ENV_FILE = Path(__file__).resolve().parents[1] / ".env"

_MIN_GAP_S = 5.2  # el API limita ~1 pedido / 5 s por IP
_MAX_WAITERS = 6
_CACHE_TTL_S = 10.0
_SEED_RETRY_S = 3600.0
_BASE_DIGS = 25
_DIG_COLLECTIBLES = {"Heart of Davy Jones": 20, "Meerkat": 5, "Pharaoh Chicken": 1}
_DIG_WEARABLES = {"Bionic Drill": 5}


class SunflowerError(Exception):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status


# ---- seed (formas + artefacto por capítulo) -------------------------------------


def parse_formations(desert_ts: str) -> dict[str, list[dict]]:
    start = desert_ts.index("export const DIGGING_FORMATIONS")
    end = desert_ts.index("} satisfies Record<string, DiggingFormation>", start)
    body = desert_ts[start:end]
    out: dict[str, list[dict]] = {}
    for m in re.finditer(r"(\w+):\s*\[(.*?)\]", body, re.S):
        cells = [
            {"x": int(x), "y": int(y), "item": item}
            for x, y, item in re.findall(r'x:\s*(-?\d+),\s*y:\s*(-?\d+),\s*name:\s*"([^"]+)"', m.group(2))
        ]
        if cells:
            out[m.group(1)] = cells
    if not out:
        raise ValueError("no se encontraron patrones en desert.ts")
    return out


def parse_chapters(desert_ts: str, chapters_ts: str) -> list[dict]:
    art_body = desert_ts[desert_ts.index("export const CHAPTER_ARTEFACT") :]
    art_body = art_body[: art_body.index("};")]
    artefacts = dict(re.findall(r'"([^"]+)":\s*"([^"]+)"', art_body))
    dates_body = chapters_ts[chapters_ts.index("export const CHAPTERS:") :]
    out = []
    for name, start, end in re.findall(
        r'"([^"]+)":\s*\{\s*startDate:\s*new Date\("([^"]+)"\),.*?endDate:\s*new Date\("([^"]+)"\)',
        dates_body,
        re.S,
    ):
        if name in artefacts:
            out.append({"name": name, "start": start, "end": end, "artefact": artefacts[name]})
    if not out:
        raise ValueError("no se encontraron capítulos en chapters.ts")
    return out


def parse_icons(names: set[str], images_ts: str, sunnyside_ts: str) -> dict[str, str]:
    """URL oficial del icono de cada ítem (`ITEM_DETAILS[name].image`). Se enlaza,
    no se copia: parte son del Sunnyside Asset Pack, que no se puede redistribuir."""
    imports = dict(re.findall(r'^import (\w+) from "(assets/[^"]+)";', images_ts, re.M))
    out: dict[str, str] = {}
    for name in names:
        key = re.escape(name)
        m = re.search(rf'^  (?:"{key}"|{key}): \{{\s*image: ([\w.]+)', images_ts, re.M)
        if not m:
            continue
        ref = m.group(1)
        if ref in imports:
            out[name] = _GITHUB_RAW + imports[ref]
        elif ref.startswith("SUNNYSIDE."):
            parts = ref.split(".")[1:]
            pos = 0
            for depth, part in enumerate(parts[:-1], start=1):
                sec = re.compile(rf"^{'  ' * depth}{part}: \{{", re.M).search(sunnyside_ts, pos)
                pos = sec.end() if sec else len(sunnyside_ts)
            leaf = re.compile(rf"^\s+{parts[-1]}: `\$\{{CONFIG\.PROTECTED_IMAGE_URL\}}([^`]+)`", re.M).search(sunnyside_ts, pos)
            if leaf:
                out[name] = _GAME_ASSETS + leaf.group(1)
    return out


def download_seed() -> dict:
    with httpx.Client(timeout=30, headers={"User-Agent": "optimizador-roller/0.1"}) as c:
        texts = {}
        for path in (
            "features/game/types/desert.ts",
            "features/game/types/chapters.ts",
            "features/game/types/images.ts",
            "assets/sunnyside.ts",
        ):
            res = c.get(_GITHUB_RAW + path)
            res.raise_for_status()
            texts[path.rsplit("/", 1)[-1]] = res.text
    formations = parse_formations(texts["desert.ts"])
    chapters = parse_chapters(texts["desert.ts"], texts["chapters.ts"])
    names = {c["item"] for f in formations.values() for c in f} | {ch["artefact"] for ch in chapters} | {"Crab", "Sand"}
    names.discard("Seasonal Artefact")
    return {
        "formations": formations,
        "chapters": chapters,
        "icons": parse_icons(names, texts["images.ts"], texts["sunnyside.ts"]),
    }


class _Seed:
    def __init__(self) -> None:
        self._data = (
            json.loads(_SEED_FILE.read_text(encoding="utf-8")) if _SEED_FILE.exists() else download_seed()
        )
        self._last_attempt = 0.0
        self._lock = threading.Lock()

    @property
    def formations(self) -> dict[str, list[dict]]:
        return self._data["formations"]

    @property
    def icons(self) -> dict[str, str]:
        return self._data.get("icons") or {}

    def artefact(self, now_ms: int) -> str:
        now = datetime.fromtimestamp(now_ms / 1000, tz=timezone.utc)
        for ch in self._data["chapters"]:
            if _iso(ch["start"]) <= now < _iso(ch["end"]):
                return ch["artefact"]
        return self._data["chapters"][-1]["artefact"]

    def ensure(self, names: list[str]) -> None:
        """Si el juego agregó un patrón (o un capítulo) que el seed no conoce,
        lo re-descarga desde GitHub; como mucho una vez por hora."""
        missing = any(n not in self.formations for n in names)
        stale_chapter = _iso(self._data["chapters"][-1]["end"]) <= datetime.now(timezone.utc)
        if not (missing or stale_chapter):
            return
        with self._lock:
            if time.time() - self._last_attempt < _SEED_RETRY_S:
                return
            self._last_attempt = time.time()
        try:
            self._data = download_seed()
        except (httpx.HTTPError, ValueError):
            pass


def _iso(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


seed = _Seed()


# ---- API comunitario ---------------------------------------------------------------


def _api_key() -> str:
    key = os.environ.get("SFL_API_KEY", "").strip()
    if key or not _ENV_FILE.exists():
        return key
    for line in _ENV_FILE.read_text(encoding="utf-8").splitlines():
        name, sep, value = line.partition("=")
        if sep and name.strip() == "SFL_API_KEY":
            return value.strip().strip("\"'")
    return ""


class _Client:
    """Pedidos al API de a uno y separados `_MIN_GAP_S`: el límite es por IP,
    compartido por todos los usuarios de la vista pública."""

    def __init__(self) -> None:
        self._gate = threading.Lock()
        self._state = threading.Lock()
        self._waiters = 0
        self._last = 0.0
        self._cache: dict[str, tuple[float, dict]] = {}

    def farm(self, land_id: str) -> dict:
        hit = self._cache.get(land_id)
        if hit and time.monotonic() - hit[0] < _CACHE_TTL_S:
            return hit[1]
        key = _api_key()
        if not key:
            raise SunflowerError(503, "El servidor no tiene configurada la API key de Sunflower Land.")
        with self._state:
            if self._waiters >= _MAX_WAITERS:
                raise SunflowerError(429, "Hay muchas consultas en cola. Inténtalo de nuevo en unos segundos.")
            self._waiters += 1
        try:
            with self._gate:
                hit = self._cache.get(land_id)
                if hit and time.monotonic() - hit[0] < _CACHE_TTL_S:
                    return hit[1]
                wait = self._last + _MIN_GAP_S - time.monotonic()
                if wait > 0:
                    time.sleep(wait)
                try:
                    res = httpx.get(
                        _API.format(id=land_id),
                        headers={"x-api-key": key, "User-Agent": "optimizador-roller/0.1"},
                        timeout=20,
                    )
                except httpx.HTTPError as exc:
                    raise SunflowerError(502, "No se pudo consultar Sunflower Land. Inténtalo de nuevo.") from exc
                finally:
                    self._last = time.monotonic()
                if res.status_code == 404:
                    raise SunflowerError(404, "No existe una granja con ese ID.")
                if res.status_code == 429:
                    raise SunflowerError(429, "Sunflower Land está limitando las consultas. Espera unos segundos.")
                if res.status_code == 401:
                    raise SunflowerError(503, "La API key de Sunflower Land no es válida o venció el VIP.")
                if res.status_code != 200:
                    raise SunflowerError(502, "Sunflower Land respondió con un error. Inténtalo de nuevo.")
                data = res.json()
                self._cache[land_id] = (time.monotonic(), data)
                return data
        finally:
            with self._state:
                self._waiters -= 1


client = _Client()


# ---- estado del minijuego -------------------------------------------------------------


def _placed(farm: dict, name: str) -> bool:
    now = time.time() * 1000
    surfaces = [
        farm.get("collectibles") or {},
        (farm.get("home") or {}).get("collectibles") or {},
        ((farm.get("interior") or {}).get("ground") or {}).get("collectibles") or {},
        ((farm.get("interior") or {}).get("level_one") or {}).get("collectibles") or {},
    ]
    return any(
        (p.get("readyAt") or 0) <= now and p.get("coordinates") and not p.get("used")
        for s in surfaces
        for p in s.get(name) or []
    )


def _equipped(farm: dict) -> set[str]:
    out = set(((farm.get("bumpkin") or {}).get("equipped") or {}).values())
    for b in ((farm.get("farmHands") or {}).get("bumpkins") or {}).values():
        out.update((b.get("equipped") or {}).values())
    return out


def _amount(v) -> int:
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return 0


def digging_state(land_id: str) -> dict:
    data = client.farm(land_id)
    farm = data.get("farm") or {}
    dg = (farm.get("desert") or {}).get("digging") or {}
    patterns: list[str] = list(dg.get("patterns") or [])
    seed.ensure(patterns)
    now_ms = int(time.time() * 1000)
    artefact = seed.artefact(now_ms)
    unknown = [p for p in patterns if p not in seed.formations]
    if unknown:
        raise SunflowerError(502, f"Patrón desconocido: {', '.join(unknown)}. Actualiza el seed de patrones.")

    today = datetime.now(timezone.utc).date()
    grid = dg.get("grid") or []
    holes = []
    for entry in grid:
        for h in entry if isinstance(entry, list) else [entry]:
            dug_at = int(h.get("dugAt") or 0)
            if datetime.fromtimestamp(dug_at / 1000, tz=timezone.utc).date() != today:
                continue
            item = next(iter(h.get("items") or {}), None)
            if item is None:
                continue
            holes.append({"x": int(h["x"]), "y": int(h["y"]), "item": item, "tool": h.get("tool") or "", "dug_at": dug_at})
    used = sum(
        1
        for entry in grid
        if any(
            datetime.fromtimestamp(int(h.get("dugAt") or 0) / 1000, tz=timezone.utc).date() == today
            for h in (entry if isinstance(entry, list) else [entry])
        )
    )

    max_digs = _BASE_DIGS
    max_digs += sum(v for n, v in _DIG_COLLECTIBLES.items() if _placed(farm, n))
    worn = _equipped(farm)
    max_digs += sum(v for n, v in _DIG_WEARABLES.items() if n in worn)
    extra = _amount(dg.get("extraDigs"))
    left = max(0, max_digs - used) + extra

    inv = farm.get("inventory") or {}
    shovels = _amount(inv.get("Sand Shovel"))
    # cada excavación gasta una Sand Shovel, salvo con Ancient Shovel equipada
    budget = left if "Ancient Shovel" in worn else min(left, shovels)
    formations = {
        name: [{**c, "item": artefact if c["item"] == "Seasonal Artefact" else c["item"]} for c in seed.formations[name]]
        for name in dict.fromkeys(patterns)
    }
    return {
        "land_id": str(data.get("id") or land_id),
        "updated_at": _amount(data.get("updatedAt")),
        "artefact": artefact,
        "patterns": patterns,
        "formations": formations,
        "holes": holes,
        "stale": bool(grid) and not holes,
        "digs": {"max": max_digs, "used": used, "extra": extra, "left": left},
        "icons": {
            n: seed.icons[n]
            for n in {c["item"] for f in formations.values() for c in f} | {"Crab", "Sand"}
            if n in seed.icons
        },
        "shovels": shovels,
        "budget": budget,
        "drills": _amount(inv.get("Sand Drill")),
    }
