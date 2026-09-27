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
    target_final_power: int | None  # None = sin tope (última liga)
    margin_bp: int | None = Field(default=None, ge=0, le=10000)  # RULES.md §5.2
    primary_only: bool = False  # "¿cuánto aporta?" (RULES.md §5.9)
    max_slots: int = Field(gt=0)
    slot_mode: str = "miners"
    time_limit_s: float = Field(default=10.0, gt=0, le=300)
    allow_merges: bool = False
    excluded_merges: list[str] = []
    inventory: list[InventoryItem]

    @field_validator("target_final_power", mode="before")
    @classmethod
    def _target(cls, v: object) -> int | None:
        return None if v is None else _to_int(v)

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
    image: str = ""


class MergeTargetOut(BaseModel):
    id: str
    name: str
    level: int
    power: str
    bonus_bp: int
    width: int
    image: str = ""


class MergeOut(BaseModel):
    from_id: str
    from_name: str
    from_level: int
    from_power: str
    count: int  # consume 2·count copias del origen, produce count del destino
    to: MergeTargetOut


class OptimizeResponse(BaseModel):
    status: str
    picks: list[PickOut]
    merges: list[MergeOut] = []
    raw_power: str
    bonus_bp: int
    bonus_pct: float
    final_power: str
    target_final_power: str | None  # None = sin tope
    floor_power: str
    in_window: bool
    headroom: str | None
    headroom_pct: float
    slots_used: int
    cells_used: int
    scale: int
    solve_time_s: float


class OptimizeJobStarted(BaseModel):
    job_id: str


class OptimizeJobStatus(BaseModel):
    """Estado de un trabajo de optimización (RULES.md §5.10, §8)."""

    state: str  # "running" | "done" | "error"
    elapsed_s: float
    time_limit_s: float
    phase: str = ""
    best: str = ""   # GH/s
    bound: str = ""  # GH/s
    stopping: bool = False
    result: OptimizeResponse | None = None
    error: str = ""


class LeagueOut(BaseModel):
    level: int
    title: str
    min_power: str
    max_power: str | None  # tope; None en la última liga
    image: str = ""


class ParseInventoryBody(BaseModel):
    text: str = Field(min_length=1, max_length=200_000)


class ParsedItemOut(BaseModel):
    id: str
    name: str
    level: int
    power: str
    bonus_bp: int
    width: int
    quantity: int
    image: str = ""
    matched: bool


class ParseInventoryResponse(BaseModel):
    items: list[ParsedItemOut]
    skipped: list[str]


class CatalogMinerOut(BaseModel):
    id: str
    name: str
    level: int          # nivel del juego (= api_level + 1); base = 1
    api_level: int = 0  # nivel crudo de la API de merges
    power: str
    bonus_bp: int
    width: int
    image: str


class RoomImportItem(CatalogMinerOut):
    count: int  # copias realmente puestas en la sala del juego


class RoomImportResponse(BaseModel):
    items: list[RoomImportItem]
    total_cells: int  # suma de width*count, informativo
    room_slots: list[str | None]  # 96 celdas en el mismo orden que en el juego
