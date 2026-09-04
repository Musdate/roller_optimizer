"""Schemas de la API (Pydantic v2).

Unidad de poder: GH/s (como la entrega la API de RollerCoin). Los números que
pueden exceder 2^53 viajan como STRING; el frontend usa BigInt. Ver RULES.md §8.
"""

from __future__ import annotations

from pydantic import BaseModel, Field, field_validator


def _to_int(v: object) -> int:
    if isinstance(v, bool):
        raise ValueError("se esperaba un entero, no un booleano")
    if isinstance(v, int):
        return v
    if isinstance(v, float):
        if not v.is_integer():
            raise ValueError("se esperaba un entero")
        return int(v)
    if isinstance(v, str):
        s = v.strip().replace("_", "")
        if not s:
            raise ValueError("entero vacío")
        return int(s)
    raise ValueError(f"no se puede interpretar {v!r} como entero")


class InventoryItem(BaseModel):
    id: str
    name: str = ""
    level: int = 0
    power: int
    bonus_bp: int = 0
    width: int = 1
    quantity: int = Field(ge=0)

    _v_power = field_validator("power", "bonus_bp", mode="before")(
        staticmethod(_to_int)
    )

    @field_validator("width")
    @classmethod
    def _width_range(cls, v: int) -> int:
        return 1 if v < 1 else v


class OptimizeRequestBody(BaseModel):
    target_final_power: int
    max_slots: int = Field(gt=0)
    slot_mode: str = "miners"
    time_limit_s: float = Field(default=10.0, gt=0, le=120)
    inventory: list[InventoryItem]

    _v_target = field_validator("target_final_power", mode="before")(
        staticmethod(_to_int)
    )

    @field_validator("slot_mode")
    @classmethod
    def _mode(cls, v: str) -> str:
        if v not in ("miners", "cells"):
            raise ValueError("slot_mode debe ser 'miners' o 'cells'")
        return v


class PickOut(BaseModel):
    id: str
    name: str
    level: int
    count: int
    power: str
    bonus_bp: int
    width: int


class OptimizeResponse(BaseModel):
    status: str
    picks: list[PickOut]
    raw_power: str
    bonus_bp: int
    bonus_pct: float
    final_power: str
    target_final_power: str
    headroom: str
    headroom_pct: float
    slots_used: int
    cells_used: int
    scale: int
    solve_time_s: float


class CatalogMinerOut(BaseModel):
    id: str
    name: str
    level: int          # nivel del juego (= api_level + 1); base = 1
    api_level: int = 0  # nivel crudo de la API de merges
    power: str
    bonus_bp: int
    width: int
    image: str
