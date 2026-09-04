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
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import httpx

_BASE = "https://api.rollercoincalculator.app/api"
_CDN = "https://cdn.rollercoincalculator.app"
_PAGE_SIZE = 1000
_CACHE_FILE = Path(__file__).resolve().parent.parent / ".cache" / "catalog.json"
_SEED_FILE = Path(__file__).resolve().parent / "data" / "catalog_seed.json"
_TTL_SECONDS = 7 * 24 * 3600
_CONCURRENCY = 16


def _image_url(file_name: str | None, version: int | None) -> str:
    if not file_name:
        return ""
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


def _model_from_required(ri: dict) -> dict | None:
    if ri.get("type") != "miners" or ri.get("power") is None:
        return None
    api_level = int(ri.get("level") or 0)
    return {
        "id": ri["itemId"],
        "name": ri.get("itemName", ""),
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
        resp = client.get(
            f"{_BASE}/Merges",
            params={"PageRequest.PageIndex": index, "PageRequest.PageSize": _PAGE_SIZE},
        )
        resp.raise_for_status()
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


def _fetch_ladder(client: httpx.Client, name: str) -> list[dict]:
    for attempt in range(3):
        try:
            r = client.get(f"{_BASE}/Merges/get-by-miner-name", params={"minerName": name})
            if r.status_code == 429 or r.status_code >= 500:
                time.sleep(0.5 * (attempt + 1))
                continue
            r.raise_for_status()
            return r.json() or []
        except httpx.HTTPError:
            time.sleep(0.5 * (attempt + 1))
    return []


def _fetch_all() -> list[dict]:
    miners: dict[str, dict] = {}
    with httpx.Client(timeout=60, headers={"User-Agent": "optimizador-roller/0.1"}) as client:
        # 1) resultados API 1..5
        for it in _fetch_results(client):
            m = _model_from_result(it)
            miners.setdefault(m["id"], m)

        names = sorted({m["name"] for m in miners.values()})

        # 2) mineros base (y verificación) vía get-by-miner-name en paralelo
        def worker(name: str) -> list[dict]:
            found: list[dict] = []
            for recipe in _fetch_ladder(client, name):
                found.append(_model_from_result(recipe))
                for ri in recipe.get("requiredItems", []):
                    m = _model_from_required(ri)
                    if m:
                        found.append(m)
            return found

        with ThreadPoolExecutor(max_workers=_CONCURRENCY) as pool:
            for batch in pool.map(worker, names):
                for m in batch:
                    miners.setdefault(m["id"], m)

    return sorted(miners.values(), key=lambda m: (m["name"], m["level"]))


def _read_json(path: Path) -> tuple[list[dict], float] | None:
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data["miners"], float(data["fetched_at"])
    except (json.JSONDecodeError, KeyError, OSError):
        return None


def _read_cache() -> tuple[list[dict], float] | None:
    return _read_json(_CACHE_FILE) or _read_json(_SEED_FILE)


def _write_cache(miners: list[dict]) -> None:
    _CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
    _CACHE_FILE.write_text(
        json.dumps({"fetched_at": time.time(), "miners": miners}), encoding="utf-8"
    )


class Catalog:
    def __init__(self) -> None:
        self._miners: list[dict] = []
        self._fetched_at: float = 0.0
        cached = _read_cache()
        if cached:
            self._miners, self._fetched_at = cached

    @property
    def stale(self) -> bool:
        return (time.time() - self._fetched_at) > _TTL_SECONDS

    @property
    def fetched_at(self) -> float:
        return self._fetched_at

    def ensure(self, force: bool = False) -> None:
        # NO refresca por antigüedad de forma automática (tardaría minutos y
        # bloquearía la request). Solo si no hay datos o si se fuerza.
        # La UI muestra `stale` y ofrece "recargar" -> POST /api/catalog/refresh.
        if force or not self._miners:
            self.refresh()

    def refresh(self) -> None:
        self._miners = _fetch_all()
        self._fetched_at = time.time()
        _write_cache(self._miners)

    def all(self) -> list[dict]:
        self.ensure()
        return self._miners

    def search(self, term: str = "", limit: int = 50) -> list[dict]:
        self.ensure()
        term = (term or "").strip().lower()
        hits = self._miners if not term else [m for m in self._miners if term in m["name"].lower()]
        return hits[: max(1, limit)]


catalog = Catalog()
