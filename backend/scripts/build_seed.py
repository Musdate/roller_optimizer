"""Reconstruye backend/app/data/catalog_seed.json de forma paciente.

La API de RollerCoin corta a las ~80 requests seguidas. Este script va lento
(1 conexión, ~3 req/s, pausa por ráfaga), hace checkpoint cada 25 nombres y
saltea los que ya tienen su nivel base -> se puede matar y volver a correr.

    python scripts/build_seed.py
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx

from app import catalog as cat

SEED = cat._SEED_FILE


def load() -> dict[str, dict]:
    data = cat._read_json(SEED)
    return {m["id"]: m for m in (data[0] if data else [])}


def save(miners: dict[str, dict]) -> None:
    SEED.parent.mkdir(parents=True, exist_ok=True)
    rows = sorted(miners.values(), key=lambda m: (m["name"], m["level"]))
    SEED.write_text(json.dumps({"fetched_at": time.time(), "miners": rows}), encoding="utf-8")


def stats(miners: dict[str, dict]) -> tuple[int, int]:
    names = {m["name"] for m in miners.values()}
    base = {m["name"] for m in miners.values() if m["level"] == 1}
    return len(names), len(names - base)


def main() -> None:
    miners = load()

    with httpx.Client(timeout=45, headers={"User-Agent": "optimizador-roller/seed"}) as client:
        # niveles 2..6 del listado masivo
        for it in cat._fetch_results(client):
            miners[it["resultItemId"]] = cat._model_from_result(it)
        save(miners)

        n_names, missing = stats(miners)
        have_base = {m["name"] for m in miners.values() if m["level"] == 1}
        todo = sorted({m["name"] for m in miners.values()} - have_base)
        print(f"names={n_names}  missing_base={missing}  -> {len(todo)} por bajar", flush=True)

        done = 0
        for name in todo:
            recipes = cat._fetch_ladder(client, name)
            if recipes:
                for recipe in recipes:
                    rm = cat._model_from_result(recipe)
                    miners[rm["id"]] = rm
                    for ri in recipe.get("requiredItems", []):
                        m = cat._model_from_required(ri, name=recipe.get("resultItemName"))
                        if m:
                            miners[m["id"]] = m
            else:
                print(f"  (sin datos: {name})", flush=True)
            done += 1
            if done % 25 == 0:
                save(miners)
                _, missing = stats(miners)
                print(f"  {done}/{len(todo)}  missing_base={missing}", flush=True)

        save(miners)

    n_names, missing = stats(miners)
    print(f"\nLISTO. models={len(miners)}  names={n_names}  missing_base={missing}", flush=True)


if __name__ == "__main__":
    main()
