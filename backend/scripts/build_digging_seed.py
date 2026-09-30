"""Reconstruye backend/app/data/digging_seed.json desde el código del juego en
GitHub: patrones de `desert.ts` y artefacto por capítulo (RULES.md §11.6).

    python scripts/build_digging_seed.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import sunflower as sf


def main() -> None:
    data = sf.download_seed()
    sf._SEED_FILE.parent.mkdir(parents=True, exist_ok=True)
    sf._SEED_FILE.write_text(json.dumps(data, indent=1), encoding="utf-8")
    print(f"{len(data['formations'])} patrones, {len(data['chapters'])} capítulos -> {sf._SEED_FILE}")


if __name__ == "__main__":
    main()
