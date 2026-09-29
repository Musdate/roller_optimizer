"""API FastAPI: catálogo + optimización.

Capa delgada sobre `optimizer.py` (lógica pura) y `catalog.py` (datos).
"""

from __future__ import annotations

import logging
import threading
import time
import uuid
from dataclasses import dataclass, field, replace
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .catalog import RoomSyncError, catalog, fetch_user_room
from .leagues import leagues
from .models import (
    CatalogMinerOut,
    LeagueOut,
    MergeOut,
    MergeTargetOut,
    OptimizeJobStarted,
    OptimizeJobStatus,
    OptimizeRequestBody,
    OptimizeResponse,
    ParsedItemOut,
    ParseInventoryBody,
    ParseInventoryResponse,
    PickOut,
    RoomImportItem,
    RoomImportResponse,
)
from .optimizer import MinerModel, OptimizeRequest, OptimizeResult, optimize
from .paste import parse_inventory

@asynccontextmanager
async def lifespan(app: FastAPI):
    # El disco del contenedor puede ser efímero (Render lo recicla al dormir
    # el servicio): el catálogo arranca del seed de la imagen y le faltan los
    # mineros que RollerCoin agregó después. `autosync_async` los trae solo,
    # en segundo plano y en segundos. Ver DEPLOY.md.
    catalog.autosync_async()
    yield


app = FastAPI(title="Optimizador Sala RollerCoin", version="0.1.0", lifespan=lifespan)

# El solver de OR-Tools puede tardar hasta `time_limit_s` (5 min desde el
# frontend) y suele usar varios núcleos por sí solo -- en un VPS chico, unas
# pocas optimizaciones a la vez alcanzan para saturar la CPU y poner lenta
# TODA la app. Con un solo candado no-bloqueante, como el de
# `catalog._refresh_lock`, como mucho corre 1 trabajo a la vez; el resto
# recibe un 429 al toque en vez de encolarse. El candado lo suelta el hilo
# del trabajo al terminar.
_optimize_lock = threading.Lock()
logger = logging.getLogger(__name__)

# Trabajos de optimización (RULES.md §5.10). Si nadie consulta el estado en
# `_HEARTBEAT_S` (se cerró la pestaña), se detiene solo: si no, el candado
# quedaría tomado hasta agotar los 5 min.
_HEARTBEAT_S = 15.0
_JOB_TTL_S = 600.0


@dataclass
class _Job:
    id: str
    time_limit_s: float
    started: float = field(default_factory=time.monotonic)
    last_seen: float = field(default_factory=time.monotonic)
    finished: float | None = None
    stop: threading.Event = field(default_factory=threading.Event)
    state: str = "running"
    phase: str = ""
    best: int | None = None
    bound: int | None = None
    result: OptimizeResponse | None = None
    error: str = ""


_jobs: dict[str, _Job] = {}
_jobs_lock = threading.Lock()

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
            "/api/leagues",
            "/api/optimize",
            "/api/optimize/{job_id}",
            "/api/optimize/{job_id}/stop",
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
        logger.exception("no se pudo obtener el catálogo")
        raise HTTPException(
            502, "No se pudo cargar el catálogo de mineros. Inténtalo de nuevo en unos minutos."
        ) from exc
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
    """Vuelve a bajar el catálogo (segundos) y lo mezcla con el actual."""
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
    """Cuántos mineros nuevos hay en la API de RollerCoin, sin tocar el catálogo."""
    try:
        return catalog.check_for_updates()
    except Exception as exc:  # noqa: BLE001
        logger.exception("no se pudo chequear el catálogo")
        raise HTTPException(
            502, "No se pudo consultar RollerCoin para buscar mineros nuevos. Inténtalo de nuevo en unos minutos."
        ) from exc


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


@app.get("/api/leagues", response_model=list[LeagueOut])
def get_leagues() -> list[LeagueOut]:
    return [
        LeagueOut(
            level=r["level"],
            title=r["title"],
            min_power=str(r["min_power"]),
            max_power=None if r["max_power"] is None else str(r["max_power"]),
            image=r["image"],
        )
        for r in leagues.all()
    ]


@app.post("/api/optimize", response_model=OptimizeJobStarted)
def start_optimize(body: OptimizeRequestBody) -> OptimizeJobStarted:
    if not _optimize_lock.acquire(blocking=False):
        raise HTTPException(
            429, "Ya hay una optimización en curso. Espera a que termine e inténtalo de nuevo."
        )
    try:
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
        rows = catalog.all()
        row_by_id = {r["id"]: r for r in rows}
        if body.allow_merges:
            models = _with_merge_targets(models, rows, row_by_id)
        req = OptimizeRequest(
            target_final_power=body.target_final_power,
            margin_bp=body.margin_bp,
            primary_only=body.primary_only,
            max_slots=body.max_slots,
            slot_mode=body.slot_mode,
            time_limit_s=body.time_limit_s,
            allow_merges=body.allow_merges,
            excluded_merges=frozenset(body.excluded_merges),
        )
        job = _Job(id=uuid.uuid4().hex, time_limit_s=body.time_limit_s)
        with _jobs_lock:
            _prune_jobs()
            _jobs[job.id] = job
        threading.Thread(
            target=_run_job, args=(job, models, req, row_by_id), daemon=True
        ).start()
    except BaseException:
        _optimize_lock.release()
        raise
    return OptimizeJobStarted(job_id=job.id)


@app.get("/api/optimize/{job_id}", response_model=OptimizeJobStatus)
def optimize_status(job_id: str) -> OptimizeJobStatus:
    job = _get_job(job_id)
    job.last_seen = time.monotonic()
    end = job.finished if job.finished is not None else time.monotonic()
    return OptimizeJobStatus(
        state=job.state,
        elapsed_s=round(end - job.started, 1),
        time_limit_s=job.time_limit_s,
        phase=job.phase,
        best="" if job.best is None else str(job.best),
        bound="" if job.bound is None else str(job.bound),
        stopping=job.stop.is_set(),
        result=job.result,
        error=job.error,
    )


@app.post("/api/optimize/{job_id}/stop", response_model=OptimizeJobStatus)
def optimize_stop(job_id: str) -> OptimizeJobStatus:
    _get_job(job_id).stop.set()
    return optimize_status(job_id)


def _get_job(job_id: str) -> _Job:
    with _jobs_lock:
        job = _jobs.get(job_id)
    if job is None:
        raise HTTPException(404, "La optimización ya no está disponible. Vuelve a optimizar.")
    return job


def _prune_jobs() -> None:
    now = time.monotonic()
    for jid in [j.id for j in _jobs.values() if j.finished and now - j.finished > _JOB_TTL_S]:
        del _jobs[jid]


def _run_job(
    job: _Job, models: list[MinerModel], req: OptimizeRequest, row_by_id: dict[str, dict]
) -> None:
    def progress(**kw) -> None:
        for k, v in kw.items():
            setattr(job, k, v)

    def heartbeat() -> None:
        while job.state == "running":
            if time.monotonic() - job.last_seen > _HEARTBEAT_S:
                job.stop.set()
                return
            time.sleep(1.0)

    threading.Thread(target=heartbeat, daemon=True).start()
    try:
        res = optimize(models, req, progress=progress, stop=job.stop)
        job.result = _to_response(res, {m.id: m for m in models}, row_by_id)
        job.state = "done"
    except Exception:  # noqa: BLE001
        logger.exception("falló la optimización")
        job.error = "Ocurrió un error inesperado al optimizar. Inténtalo de nuevo."
        job.state = "error"
    finally:
        job.finished = time.monotonic()
        _optimize_lock.release()


def _to_response(
    res: OptimizeResult,
    by_id: dict[str, MinerModel],
    row_by_id: dict[str, dict],
) -> OptimizeResponse:
    def image(mid: str) -> str:
        return row_by_id.get(mid, {}).get("image", "")

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
                image=image(p.id),
            )
            for p in res.picks
        ],
        merges=[
            MergeOut(
                from_id=mg.from_id,
                from_name=by_id[mg.from_id].name,
                from_level=by_id[mg.from_id].level,
                from_power=str(by_id[mg.from_id].power),
                count=mg.count,
                to=MergeTargetOut(
                    id=mg.to_id,
                    name=by_id[mg.to_id].name,
                    level=by_id[mg.to_id].level,
                    power=str(by_id[mg.to_id].power),
                    bonus_bp=by_id[mg.to_id].bonus_bp,
                    width=by_id[mg.to_id].width,
                    image=image(mg.to_id),
                ),
            )
            for mg in res.merges
        ],
        raw_power=str(res.raw_power),
        bonus_bp=res.bonus_bp,
        bonus_pct=round(res.bonus_bp / 100, 2),
        final_power=str(res.final_power),
        target_final_power=None if res.target_final_power is None else str(res.target_final_power),
        floor_power=str(res.floor_power),
        in_window=res.in_window,
        headroom=None if res.headroom is None else str(res.headroom),
        headroom_pct=res.headroom_pct,
        slots_used=res.slots_used,
        cells_used=res.cells_used,
        scale=res.scale,
        solve_time_s=res.solve_time_s,
    )


def _with_merge_targets(
    models: list[MinerModel], rows: list[dict], row_by_id: dict[str, dict]
) -> list[MinerModel]:
    """Enlaza cada modelo con su nivel siguiente del catálogo (`next_id`) y
    agrega como candidatos (quantity 0) los niveles que no están en el
    inventario, hasta el tope de la escalera (RULES.md §5.9)."""
    by_name_level = {(r["name"], r["level"]): r for r in rows}
    out: dict[str, MinerModel] = {m.id: m for m in models}
    queue = list(out)
    while queue:
        mid = queue.pop()
        row = row_by_id.get(mid)
        nxt = by_name_level.get((row["name"], row["level"] + 1)) if row else None
        if not nxt:
            continue
        out[mid] = replace(out[mid], next_id=nxt["id"])
        if nxt["id"] not in out:
            out[nxt["id"]] = MinerModel(
                id=nxt["id"],
                power=nxt["power"],
                bonus_bp=nxt["bonus_bp"],
                quantity=0,
                width=nxt["width"],
                name=nxt["name"],
                level=nxt["level"],
            )
            queue.append(nxt["id"])
    return list(out.values())


# --- frontend estático -------------------------------------------------------
# En producción el build de Vite se copia a backend/static/ (ver Dockerfile) y
# se sirve desde la misma app: la UI queda en `/` y la API en `/api`. La app no
# usa routing de cliente, así que StaticFiles(html=True) alcanza.
_STATIC_DIR = Path(__file__).resolve().parent.parent / "static"
if _STATIC_DIR.is_dir():
    app.mount("/", StaticFiles(directory=str(_STATIC_DIR), html=True), name="frontend")
