"""Reconstruye backend/app/data/catalog_seed.json desde `/api/Miner` (RULES.md §6).

    python scripts/build_seed.py
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import catalog as cat

SEED = cat._SEED_FILE


def main() -> None:
    data = cat._read_json(SEED)
    previous = data[0] if data else []
    miners = cat._fetch_all(previous=previous)
    if cat.last_refresh_incomplete:
        sys.exit("La API no devolvió todas las páginas; el seed no se tocó. Reintenta.")

    SEED.parent.mkdir(parents=True, exist_ok=True)
    SEED.write_text(json.dumps({"fetched_at": time.time(), "miners": miners}), encoding="utf-8")

    names = {m["name"] for m in miners}
    base = {m["name"] for m in miners if m["level"] == 1}
    print(f"LISTO. models={len(miners)} (antes {len(previous)})  names={len(names)}  missing_base={len(names - base)}")


if __name__ == "__main__":
    main()
