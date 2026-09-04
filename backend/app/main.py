"""API FastAPI: catálogo + optimización.

Capa delgada sobre `optimizer.py` (lógica pura) y `catalog.py` (datos).
"""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .catalog import RoomSyncError, catalog, fetch_user_room
from .models import (
    CatalogMinerOut,
    OptimizeRequestBody,
    OptimizeResponse,
    ParsedItemOut,
    ParseInventoryBody,
    ParseInventoryResponse,
    PickOut,
    RoomImportItem,
    RoomImportResponse,
)
from .optimizer import MinerModel, OptimizeRequest, optimize
from .paste import parse_inventory

app = FastAPI(title="Optimizador Sala RollerCoin", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api")
def api_root() -> dict:
    return {
        "service": "Optimizador Sala RollerCoin — API",
        "docs": "/docs",
        "endpoints": [
            "/api/health",
            "/api/catalog",
            "/api/catalog/by-ids",
            "/api/catalog/refresh",
            "/api/catalog/check",
            "/api/room/import",
            "/api/inventory/parse",
            "/api/optimize",
        ],
    }


@app.get("/api/health")
def health() -> dict:
    rows = catalog.all()  # recarga el seed si cambió en disco
    progress = catalog.progress
    return {
        "ok": True,
        "catalog_size": len(rows),
        "catalog_fetched_at": catalog.fetched_at,
        "catalog_stale": catalog.stale,
        "catalog_missing_base": catalog.missing_base,
        "catalog_refreshing": catalog.refreshing,
        # nombres resueltos / a resolver del refresh en curso (0/0 si no
        # hay ninguno corriendo, o mientras se espera el listado masivo).
        "catalog_progress_done": progress["done"],
        "catalog_progress_total": progress["total"],
    }


@app.get("/api/catalog", response_model=list[CatalogMinerOut])
def get_catalog(
    search: str = Query(default=""),
    limit: int = Query(default=50, ge=1, le=1000),
) -> list[CatalogMinerOut]:
    try:
        rows = catalog.search(search, limit)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, f"no se pudo obtener el catálogo: {exc}") from exc
    return [
        CatalogMinerOut(
            id=r["id"],
            name=r["name"],
            level=r["level"],
            api_level=r.get("api_level", 0),
            power=str(r["power"]),
            bonus_bp=r["bonus_bp"],
            width=r["width"],
            image=r["image"],
        )
        for r in rows
    ]


@app.get("/api/catalog/by-ids", response_model=list[CatalogMinerOut])
def get_catalog_by_ids(ids: str = Query(default="")) -> list[CatalogMinerOut]:
    """Datos actuales del catálogo para un set de ids (coma-separados), sin
    límite de `search`. Para volver a sincronizar ítems ya guardados en el
    inventario del cliente (imagen/poder/bonus quedan congelados en el
    momento en que se agregaron -- si el catálogo se corrigió después, p.ej.
    el saneo de apóstrofos en las URLs de imagen, el inventario ya guardado
    sigue apuntando a la URL vieja rota hasta que se resincroniza)."""
    id_set = {i.strip() for i in ids.split(",") if i.strip()}
    if not id_set:
        return []
    rows = [m for m in catalog.all() if m["id"] in id_set]
    return [
        CatalogMinerOut(
            id=r["id"],
            name=r["name"],
            level=r["level"],
            api_level=r.get("api_level", 0),
            power=str(r["power"]),
            bonus_bp=r["bonus_bp"],
            width=r["width"],
            image=r["image"],
        )
        for r in rows
    ]


@app.post("/api/catalog/refresh")
def refresh_catalog() -> dict:
    started = catalog.refresh_async()
    return {
        "ok": True,
        "started": started,
        "already_running": not started,
        "refreshing": catalog.refreshing,
        "missing_base": catalog.missing_base,
    }


@app.get("/api/catalog/check")
def check_catalog() -> dict:
    """Chequeo rápido (~segundos, no ~15 min) de cuántos mineros nuevos hay
    en la API de RollerCoin antes de decidir si vale la pena recargar todo."""
    try:
        return catalog.check_for_updates()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, f"no se pudo chequear el catálogo: {exc}") from exc


@app.get("/api/room/import", response_model=RoomImportResponse)
def import_real_room(user_id: str = Query(alias="userId", min_length=1, max_length=64)) -> RoomImportResponse:
    """Sala real (ya puesta en el juego) de un usuario de RollerCoin, para
    reemplazar la sala local con lo que de verdad está puesto."""
    try:
        room = fetch_user_room(user_id)
    except RoomSyncError as exc:
        raise HTTPException(502, str(exc)) from exc
    items = [
        RoomImportItem(
            id=r["id"],
            name=r["name"],
            level=r["level"],
            api_level=r["api_level"],
            power=str(r["power"]),
            bonus_bp=r["bonus_bp"],
            width=r["width"],
            image=r["image"],
            count=r["count"],
        )
        for r in room["items"]
    ]
    return RoomImportResponse(
        items=items,
        total_cells=sum(i.width * i.count for i in items),
        room_slots=room["room_slots"],
    )


@app.post("/api/inventory/parse", response_model=ParseInventoryResponse)
def parse_pasted_inventory(body: ParseInventoryBody) -> ParseInventoryResponse:
    res = parse_inventory(body.text, catalog.all())
    return ParseInventoryResponse(
        items=[
            ParsedItemOut(
                id=it.id,
                name=it.name,
                level=it.level,
                power=str(it.power),
                bonus_bp=it.bonus_bp,
                width=it.width,
                quantity=it.quantity,
                image=it.image,
                matched=it.matched,
            )
            for it in res.items
        ],
        skipped=res.skipped,
    )


@app.post("/api/optimize", response_model=OptimizeResponse)
def run_optimize(body: OptimizeRequestBody) -> OptimizeResponse:
    models = [
        MinerModel(
            id=it.id,
            power=it.power,
            bonus_bp=it.bonus_bp,
            quantity=it.quantity,
            width=it.width,
            name=it.name,
            level=it.level,
        )
        for it in body.inventory
    ]
    req = OptimizeRequest(
        target_final_power=body.target_final_power,
        max_slots=body.max_slots,
        slot_mode=body.slot_mode,
        time_limit_s=body.time_limit_s,
    )
    res = optimize(models, req)
    return OptimizeResponse(
        status=res.status,
        picks=[
            PickOut(
                id=p.id,
                name=p.name,
                level=p.level,
                count=p.count,
                power=str(p.power),
                bonus_bp=p.bonus_bp,
                width=p.width,
            )
            for p in res.picks
        ],
        raw_power=str(res.raw_power),
        bonus_bp=res.bonus_bp,
        bonus_pct=round(res.bonus_bp / 100, 2),
        final_power=str(res.final_power),
        target_final_power=str(res.target_final_power),
        headroom=str(res.headroom),
        headroom_pct=res.headroom_pct,
        slots_used=res.slots_used,
        cells_used=res.cells_used,
        scale=res.scale,
        solve_time_s=res.solve_time_s,
    )


# --- frontend estático -------------------------------------------------------
# En producción el build de Vite se copia a backend/static/ (ver Dockerfile) y
# se sirve desde la misma app: la UI queda en `/` y la API en `/api`. La app no
# usa routing de cliente, así que StaticFiles(html=True) alcanza.
_STATIC_DIR = Path(__file__).resolve().parent.parent / "static"
if _STATIC_DIR.is_dir():
    app.mount("/", StaticFiles(directory=str(_STATIC_DIR), html=True), name="frontend")
