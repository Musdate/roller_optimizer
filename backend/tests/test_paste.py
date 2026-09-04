"""Tests del parser de inventario pegado (app/paste.py)."""

from __future__ import annotations

from app.paste import parse_inventory

_CATALOG = [
    {"id": "cr2", "name": "Crimson Reflection", "level": 2, "power": 2_560_000, "bonus_bp": 250, "width": 2, "image": "cr2.png"},
    {"id": "cr3", "name": "Crimson Reflection", "level": 3, "power": 6_720_000, "bonus_bp": 500, "width": 2, "image": "cr3.png"},
    {"id": "cr4", "name": "Crimson Reflection", "level": 4, "power": 17_700_000, "bonus_bp": 800, "width": 2, "image": "cr4.png"},
    {"id": "de2", "name": "Devil’s Ember", "level": 2, "power": 17_070_000, "bonus_bp": 150, "width": 2, "image": "de2.png"},
]

_SAMPLE = """
3
Crimson Reflection
Set
Size:
2 Cells
Power
17.700 Ph/s
Bonus
8 %
Quantity:
1
Can't be sold
Miner details
open
2
Crimson Reflection
Set
Size:
2 Cells
Power
6.720 Ph/s
Bonus
5 %
Quantity:
3
Can't be sold
Miner details
open
1
Devil's Ember
Size:
2 Cells
Power
17.070 Ph/s
Bonus
1.5 %
Quantity:
2
Miner details
open
"""


def test_matches_by_power_not_by_shown_level():
    res = parse_inventory(_SAMPLE, _CATALOG)
    got = {(it.id, it.quantity, it.matched) for it in res.items}
    # la web muestra "3" pero por poder (17.7 PH/s) es nuestro nivel 4
    assert ("cr4", 1, True) in got
    # la web muestra "2" -> nuestro nivel 3
    assert ("cr3", 3, True) in got
    assert res.skipped == []


def test_apostrophe_variants_match():
    res = parse_inventory(_SAMPLE, _CATALOG)
    de = [it for it in res.items if it.id == "de2"]
    assert de and de[0].matched and de[0].quantity == 2


def test_unmatched_is_kept_as_custom():
    txt = """
2
Totally Fake Miner
Size:
1 Cells
Power
5.000 Th/s
Bonus
3 %
Quantity:
4
Miner details
"""
    res = parse_inventory(txt, _CATALOG)
    assert len(res.items) == 1
    it = res.items[0]
    assert not it.matched
    assert it.quantity == 4
    assert it.width == 1
    assert it.power == 5_000  # "5.000 Th/s" = 5.0 Th/s = 5_000 GH/s
    assert it.bonus_bp == 300
    assert it.id.startswith("paste:")


def test_empty_text_yields_nothing():
    res = parse_inventory("   \n\n  ", _CATALOG)
    assert res.items == []
    assert res.skipped == []


def test_duplicate_blocks_are_summed():
    txt = _SAMPLE + _SAMPLE
    res = parse_inventory(txt, _CATALOG)
    cr3 = [it for it in res.items if it.id == "cr3"][0]
    assert cr3.quantity == 6  # 3 + 3
