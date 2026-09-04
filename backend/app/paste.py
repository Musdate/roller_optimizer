"""Parser del texto que se copia de la página de inventario de RollerCoin.

Cada minero aparece como un bloque de líneas, con ruido entremedio:

    3
    Binglong Wyrm
    Set
    Size:
    2 Cells
    Power
    40.000 Ph/s
    Bonus
    22 %
    Quantity:
    1
    Can't be sold
    Miner details
    open

- El número suelto al principio del bloque es el **nivel de juego**.
- `Miner details` separa un minero del siguiente.
- Se intenta casar `(nombre, nivel)` contra el catálogo para usar datos exactos
  (id, poder, bonus, celdas, imagen). Si no casa, se devuelve lo parseado del
  texto como ítem "sin catálogo" (el frontend igual lo puede añadir).

Unidad interna de poder: GH/s (ver RULES.md §8.1).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

_NOISE = {
    "set", "can't be sold", "cant be sold", "miner details", "open", "close",
    "sell", "merge", "move", "info", "details", "new",
}

_UNIT_TO_GH = {
    "gh": 1, "th": 1_000, "ph": 1_000_000, "eh": 1_000_000_000, "zh": 1_000_000_000_000,
    "g": 1, "t": 1_000, "p": 1_000_000, "e": 1_000_000_000, "z": 1_000_000_000_000,
}


@dataclass
class ParsedMiner:
    name: str
    level: int
    quantity: int
    power: int              # GH/s (del texto; se pisa si casa con el catálogo)
    bonus_bp: int
    width: int
    # rellenos si casa con el catálogo:
    id: str = ""
    image: str = ""
    matched: bool = False


@dataclass
class ParseResult:
    items: list[ParsedMiner] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)


def _norm_name(s: str) -> str:
    s = s.replace("’", "'").replace("ʼ", "'").replace("`", "'")
    s = re.sub(r"\s+", " ", s).strip().lower()
    return s


def _loose_name(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", _norm_name(s))


def _parse_decimal(raw: str) -> float:
    s = raw.strip().replace(" ", "")
    if not s:
        return 0.0
    if "," in s and "." in s:
        # el separador que aparece más a la derecha es el decimal
        if s.rfind(",") > s.rfind("."):
            s = s.replace(".", "").replace(",", ".")
        else:
            s = s.replace(",", "")
    else:
        s = s.replace(",", ".")
    if s.count(".") > 1:  # varios puntos => todos menos el último son miles
        head, _, tail = s.rpartition(".")
        s = head.replace(".", "") + "." + tail
    try:
        return float(s)
    except ValueError:
        return 0.0


def _parse_power_gh(tok: str) -> int:
    m = re.match(r"^\s*([\d.,]+)\s*([a-zA-Z]{1,2})?\s*h?\s*/?\s*s?\s*$", tok, re.I)
    if not m:
        return 0
    value = _parse_decimal(m.group(1))
    unit = (m.group(2) or "gh").lower()
    mult = _UNIT_TO_GH.get(unit, _UNIT_TO_GH.get(unit[0], 1))
    return int(round(value * mult))


def _parse_bonus_bp(tok: str) -> int:
    m = re.match(r"^\s*([\d.,]+)\s*%?\s*$", tok)
    if not m:
        return 0
    return int(round(_parse_decimal(m.group(1)) * 100))


def _clean_lines(chunk: str) -> list[str]:
    out: list[str] = []
    for ln in chunk.splitlines():
        ln = ln.strip()
        if not ln or ln.lower() in _NOISE:
            continue
        out.append(ln)
    return out


def _value_after(lines: list[str], *labels: str) -> str | None:
    wanted = {l.lower() for l in labels}
    for i, ln in enumerate(lines):
        if ln.lower().rstrip(":") in wanted and i + 1 < len(lines):
            return lines[i + 1]
    return None


def _parse_chunk(chunk: str) -> ParsedMiner | None:
    lines = _clean_lines(chunk)
    if len(lines) < 4:
        return None

    # nivel = primer entero suelto; el nombre es la línea siguiente
    level = 0
    name = ""
    for i, ln in enumerate(lines):
        if re.fullmatch(r"\d{1,2}", ln):
            level = int(ln)
            if i + 1 < len(lines):
                name = lines[i + 1]
            break
    if not name:
        name = lines[0]

    # celdas
    width = 1
    size_val = _value_after(lines, "size")
    for cand in (size_val, *lines):
        if not cand:
            continue
        mw = re.match(r"^\s*(\d+)\s*cell", cand, re.I)
        if mw:
            width = max(1, int(mw.group(1)))
            break

    power_tok = _value_after(lines, "power", "hashpower", "hash power")
    bonus_tok = _value_after(lines, "bonus")
    qty_tok = _value_after(lines, "quantity", "amount", "count")

    power = _parse_power_gh(power_tok) if power_tok else 0
    bonus_bp = _parse_bonus_bp(bonus_tok) if bonus_tok else 0
    quantity = 1
    if qty_tok:
        mq = re.match(r"^\s*(\d+)", qty_tok.replace(".", "").replace(",", ""))
        if mq:
            quantity = max(1, int(mq.group(1)))

    if not name or power <= 0 and bonus_bp <= 0:
        return None

    return ParsedMiner(
        name=name, level=level, quantity=quantity,
        power=power, bonus_bp=bonus_bp, width=width,
    )


def _best_match(pm: ParsedMiner, cands: list[dict]) -> dict | None:
    """Elige, entre los mineros del catálogo con el mismo nombre, el que mejor
    encaja por poder (y bonus) con lo pegado.

    Ojo: el número de nivel que muestra la web de RollerCoin en el inventario
    NO coincide con nuestro `level` del catálogo (la web cuenta merges: su "1" es
    nuestro nivel 2). Por eso casamos por VALORES, no por el número de nivel.
    """
    best: dict | None = None
    best_err: float | None = None
    for r in cands:
        cp = max(int(r["power"]), 1)
        cb = int(r["bonus_bp"])
        perr = abs(cp - pm.power) / max(cp, pm.power, 1)
        berr = abs(cb - pm.bonus_bp) / max(cb, pm.bonus_bp, 1)
        err = perr * 2 + berr
        if best_err is None or err < best_err:
            best, best_err = r, err
    if best is not None and best_err is not None and best_err < 0.15:
        return best
    # un solo candidato y el poder no está lejísimos -> aceptar igual
    if len(cands) == 1 and best_err is not None and best_err < 0.6:
        return cands[0]
    return None


def parse_inventory(text: str, catalog_rows: list[dict]) -> ParseResult:
    # índices del catálogo para casar (por nombre; el nivel de la web no sirve)
    by_name: dict[str, list[dict]] = {}
    by_loose: dict[str, list[dict]] = {}
    for r in catalog_rows:
        by_name.setdefault(_norm_name(r["name"]), []).append(r)
        by_loose.setdefault(_loose_name(r["name"]), []).append(r)

    res = ParseResult()
    # separar por "Miner details" (o "Miner Details"); si no aparece, por doble salto
    parts = re.split(r"(?i)miner\s*details", text)
    if len(parts) == 1:
        parts = re.split(r"\n\s*\n", text)

    for part in parts:
        cleaned = _clean_lines(part)
        if len(cleaned) < 3:  # cola de "open" / bloques vacíos: ignorar en silencio
            continue
        pm = _parse_chunk(part)
        if pm is None:
            res.skipped.append(cleaned[0][:60])
            continue

        cands = by_name.get(_norm_name(pm.name)) or by_loose.get(_loose_name(pm.name)) or []
        hit = _best_match(pm, cands) if cands else None

        if hit is not None:
            pm.id = hit["id"]
            pm.name = hit["name"]
            pm.level = int(hit["level"])
            pm.power = int(hit["power"])
            pm.bonus_bp = int(hit["bonus_bp"])
            pm.width = int(hit["width"])
            pm.image = hit.get("image", "")
            pm.matched = True
        else:
            # id sintético estable para ítems sin catálogo
            pm.id = f"paste:{_loose_name(pm.name)}:{pm.level}"

        res.items.append(pm)

    # unir duplicados por id (mismo modelo pegado dos veces)
    merged: dict[str, ParsedMiner] = {}
    for it in res.items:
        if it.id in merged:
            merged[it.id].quantity += it.quantity
        else:
            merged[it.id] = it
    res.items = list(merged.values())
    return res
