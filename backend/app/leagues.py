"""Ligas de RollerCoin (RULES.md §6.3).

Se sirve siempre lo que haya en memoria (arranca del seed versionado) y, como
mucho una vez cada 24 h, se refresca desde la API en segundo plano: los umbrales
casi nunca cambian y la API limita agresivamente (429).
"""

from __future__ import annotations

import json
import threading
import time
from pathlib import Path

import httpx

_URL = "https://api.rollercoincalculator.app/api/League"
_SEED_FILE = Path(__file__).resolve().parent / "data" / "leagues_seed.json"
_REFRESH_EVERY_S = 24 * 3600


def _normalize(rows: list[dict]) -> list[dict]:
    out = [
        {
            "level": int(r["level"]),
            "title": str(r["title"]),
            "min_power": int(r["minPower"]),
            "image": str(r.get("imageUrl") or ""),
        }
        for r in rows
    ]
    out.sort(key=lambda r: r["min_power"])
    if len(out) < 2 or out[0]["min_power"] != 0:
        raise ValueError("lista de ligas inesperada")
    return out


class _Leagues:
    def __init__(self) -> None:
        self._rows = _normalize(json.loads(_SEED_FILE.read_text(encoding="utf-8")))
        self._last_attempt = 0.0
        self._lock = threading.Lock()

    def all(self) -> list[dict]:
        """Ligas ordenadas con `max_power` = tope (`None` en la última)."""
        self._maybe_refresh()
        rows = self._rows
        return [
            {**r, "max_power": rows[i + 1]["min_power"] - 1 if i + 1 < len(rows) else None}
            for i, r in enumerate(rows)
        ]

    def _maybe_refresh(self) -> None:
        now = time.time()
        with self._lock:
            if now - self._last_attempt < _REFRESH_EVERY_S:
                return
            self._last_attempt = now
        threading.Thread(target=self._refresh, daemon=True).start()

    def _refresh(self) -> None:
        try:
            with httpx.Client(timeout=20, headers={"User-Agent": "optimizador-roller/0.1"}) as c:
                res = c.get(_URL)
                res.raise_for_status()
                self._rows = _normalize(res.json())
        except (httpx.HTTPError, ValueError, KeyError, TypeError):
            pass  # se sigue con lo último que había


leagues = _Leagues()
