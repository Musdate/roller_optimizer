"""Optimizador de sala RollerCoin.

Lógica pura (solo depende de ortools). Ver RULES.md para la especificación.

Objetivo lexicográfico sobre combinaciones con  F(S) <= objetivo:
    1. maximizar F(S)      (acercarse al techo)
    2. minimizar B(S)      (menor bonus)
    3. maximizar P(S)      (mayor poder bruto)
    4. minimizar merges    (solo con allow_merges, ver RULES.md §5.9)

donde
    P(S) = suma de poder bruto de cada minero colocado
    B(S) = suma de bonus (bp) contando 1 vez por modelo (dedup)
    F(S) = P(S) * (10000 + B(S)) // 10000
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from ortools.sat.python import cp_model

BP = 10_000  # 10000 bp = 100%
# Cota superior deseada para expresiones lineales internas (margen amplio vs int64).
_INT_SAFE = 10**17


@dataclass(frozen=True)
class MinerModel:
    id: str
    power: int          # poder bruto exacto (GH/s, como lo da la API)
    bonus_bp: int       # bonus en bp (10000 = 100%)
    quantity: int       # copias en inventario
    width: int = 1      # celdas (1 o 2)
    name: str = ""
    level: int = 0
    next_id: str | None = None  # modelo que sale de mergear 2 copias de este


@dataclass
class OptimizeRequest:
    target_final_power: int
    max_slots: int
    slot_mode: str = "miners"       # "miners" | "cells"
    time_limit_s: float = 10.0
    workers: int = 8
    allow_merges: bool = False
    excluded_merges: frozenset[str] = frozenset()  # ids de origen que no se mergean


@dataclass
class Pick:
    id: str
    count: int
    power: int
    bonus_bp: int
    width: int
    name: str = ""
    level: int = 0


@dataclass
class Merge:
    from_id: str
    to_id: str
    count: int  # consume 2·count copias de from_id, produce count de to_id


@dataclass
class OptimizeResult:
    status: str
    picks: list[Pick] = field(default_factory=list)
    merges: list[Merge] = field(default_factory=list)
    raw_power: int = 0
    bonus_bp: int = 0
    final_power: int = 0
    target_final_power: int = 0
    headroom: int = 0
    headroom_pct: float = 0.0
    slots_used: int = 0
    cells_used: int = 0
    scale: int = 1
    solve_time_s: float = 0.0


def final_power(raw_power: int, bonus_bp: int) -> int:
    """Fórmula exacta del juego (división entera)."""
    return raw_power * (BP + bonus_bp) // BP


def _pick_scale(target: int, bonus_max_total: int) -> int:
    if target <= 0:
        return 1
    return max(1, math.ceil(target * max(bonus_max_total, 1) / _INT_SAFE))


def optimize(models: list[MinerModel], req: OptimizeRequest) -> OptimizeResult:
    # --- saneo de entrada -------------------------------------------------
    valid = {
        m.id: m
        for m in models
        if m.quantity >= 0
        and m.power >= 0
        and m.width >= 1
        and not (m.power == 0 and m.bonus_bp == 0)  # inútil: solo gasta slot
    }

    # prev[x] = modelo que, mergeando 2 copias, produce x (RULES.md §5.9)
    prev: dict[str, str] = {}
    if req.allow_merges:
        for m in valid.values():
            if (
                m.next_id
                and m.next_id in valid
                and m.next_id != m.id
                and m.id not in req.excluded_merges
            ):
                prev[m.next_id] = m.id

    # copias alcanzables: propias + las que llegan mergeando el nivel anterior
    disp: dict[str, int] = {}

    def _disp(mid: str, depth: int = 0) -> int:
        if mid not in disp:
            src = prev.get(mid)
            inflow = _disp(src, depth + 1) // 2 if src and depth < 16 else 0
            disp[mid] = valid[mid].quantity + inflow
        return disp[mid]

    usable = [m for m in valid.values() if _disp(m.id) > 0]
    usable_ids = {m.id for m in usable}
    # modelos que se pueden mergear a su nivel siguiente
    mergeable = [
        m for m in usable if m.next_id in usable_ids and prev.get(m.next_id) == m.id
    ]
    target = int(req.target_final_power)
    max_slots = int(req.max_slots)
    cells_mode = req.slot_mode == "cells"

    empty = OptimizeResult(
        status="optimal",
        target_final_power=target,
        headroom=target,
        headroom_pct=100.0 if target > 0 else 0.0,
        scale=1,
    )
    if not usable or max_slots <= 0 or target <= 0:
        return empty

    by_id = {m.id: m for m in usable}

    # --- atajo: si TODAS las copias entran en la sala y ni así se pasa del ---
    # objetivo, la solución lex-óptima es usar todo el inventario (no hay
    # decisión de qué descartar; más poder y más bonus => más F). Con merges
    # posibles no vale: mergear también sube poder y bonus.
    total_cells = sum(
        m.quantity * (m.width if cells_mode else 1) for m in usable
    )
    if total_cells <= max_slots and not mergeable:
        all_counts = {m.id: m.quantity for m in usable}
        all_raw = sum(by_id[i].power * c for i, c in all_counts.items())
        all_bonus = sum(by_id[i].bonus_bp for i in all_counts)
        if final_power(all_raw, all_bonus) <= target:
            return _finalize(by_id, all_counts, target, 1, 0.0, cells_mode, "optimal")

    # --- heurística voraz: solución factible rápida (hint + fallback) --------
    greedy = _greedy(usable, target, max_slots, cells_mode)

    # --- modelo CP-SAT exacto (linealización manual del producto) -----------
    bonus_max_total = sum(max(m.bonus_bp, 0) for m in usable)
    n = len(usable)
    max_single_bonus = max((m.bonus_bp for m in usable), default=0)
    S = 1
    if max_single_bonus > 0:
        S = max(1, math.ceil(target * n * max_single_bonus / (4 * 10**18)))
        S = max(S, _pick_scale(target, bonus_max_total + BP))

    target_s = target // S                                 # floor (conservador)
    power_s = {m.id: -(-m.power // S) for m in usable}      # ceil (conservador)

    def slot_cap(m: MinerModel) -> int:
        w = m.width if cells_mode else 1
        return min(disp[m.id], max_slots // max(w, 1))

    avail_power_s = sum(power_s[m.id] * slot_cap(m) for m in usable)
    M = max(min(target_s, avail_power_s), 1)

    model = cp_model.CpModel()
    use: dict[str, cp_model.IntVar] = {}
    y: dict[str, cp_model.IntVar] = {}
    for m in usable:
        cap = slot_cap(m)
        u = model.new_int_var(0, cap, f"use_{m.id}")
        b = model.new_bool_var(f"y_{m.id}")
        model.add(u >= 1).only_enforce_if(b)
        model.add(u == 0).only_enforce_if(b.negated())
        use[m.id], y[m.id] = u, b

    # k[m] = merges de m a su nivel siguiente (2 copias -> 1)
    k: dict[str, cp_model.IntVar] = {
        m.id: model.new_int_var(0, disp[m.id] // 2, f"k_{m.id}") for m in mergeable
    }
    for m in usable:
        src = prev.get(m.id)
        inflow = k[src] if src in k else 0
        if m.id in k or src in k:
            model.add(use[m.id] + 2 * k.get(m.id, 0) <= m.quantity + inflow)

    if cells_mode:
        model.add(sum(use[m.id] * m.width for m in usable) <= max_slots)
    else:
        model.add(sum(use[m.id] for m in usable) <= max_slots)

    P_s = model.new_int_var(0, M, "P_s")
    model.add(P_s == sum(use[m.id] * power_s[m.id] for m in usable))

    B = model.new_int_var(0, bonus_max_total, "B")
    model.add(B == sum(y[m.id] * m.bonus_bp for m in usable))

    # z[m] = P_s si y[m] else 0  (solo para modelos con bonus > 0)
    bonus_terms = []
    for m in usable:
        if m.bonus_bp <= 0:
            continue
        zz = model.new_int_var(0, M, f"z_{m.id}")
        model.add(zz <= P_s)
        model.add(zz <= M * y[m.id])
        model.add(zz >= P_s - M * (1 - y[m.id]))
        bonus_terms.append(m.bonus_bp * zz)

    # F = 10000*P_s + Σ bonus_bp[m]*z[m]  == P_s*(10000+B)
    f_ub = BP * M + M * bonus_max_total
    F = model.new_int_var(0, f_ub, "F")
    model.add(F == BP * P_s + sum(bonus_terms))
    model.add(F <= BP * target_s)

    # hint desde la heurística
    for m in usable:
        model.add_hint(use[m.id], greedy.get(m.id, 0))
        model.add_hint(y[m.id], 1 if greedy.get(m.id, 0) > 0 else 0)

    solver = cp_model.CpSolver()
    solver.parameters.num_workers = int(req.workers)
    per_pass = max(1.0, float(req.time_limit_s) / 2)

    total_time = 0.0

    def _run(set_obj, gap: float = 0.0, limit: float = per_pass) -> int:
        nonlocal total_time
        set_obj()
        solver.parameters.relative_gap_limit = gap
        solver.parameters.max_time_in_seconds = limit
        st = solver.solve(model)
        total_time += solver.wall_time
        return st

    # Pasada 1: maximizar F (acercarse al objetivo). El gap 1e-6 sobre F queda
    # bajo lo que se muestra (con 50 EH/s son 0.00005 EH/s).
    st1 = _run(lambda: model.maximize(F), gap=1e-6)
    if st1 not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return _finalize(by_id, greedy, target, S, total_time, cells_mode, "feasible")
    f_star = int(solver.value(F))
    model.add(F >= f_star)

    # Pasada 2 (combinada): menor bonus y, como desempate, mayor poder bruto.
    #   minimizar  B * W - P_s   con W tal que 1 bp de bonus pesa más que todo P_s
    # Sin gap: el objetivo lo domina B*W y un gap relativo dejaría P_s lejos
    # del óptimo (RULES.md §7.3).
    w = avail_power_s + 1
    st2 = _run(lambda: model.minimize(B * w - P_s))

    proven = st1 == cp_model.OPTIMAL and st2 == cp_model.OPTIMAL

    def _values() -> tuple[dict[str, int], dict[str, int]]:
        cs = {mid: int(solver.value(v)) for mid, v in use.items() if solver.value(v) > 0}
        ms = {mid: int(solver.value(v)) for mid, v in k.items() if solver.value(v) > 0}
        return cs, ms

    counts, merges = _values()

    # Pasada 3: a igual B y P_s, menos merges. Aparte y no como peso en la 2
    # porque multiplicar B*W otra vez puede desbordar int64.
    if merges:
        b_star, p_star = int(solver.value(B)), int(solver.value(P_s))
        model.add(B == b_star)
        model.add(P_s >= p_star)
        model.clear_hints()
        for mid, v in use.items():
            model.add_hint(v, counts.get(mid, 0))
            model.add_hint(y[mid], 1 if counts.get(mid, 0) > 0 else 0)
        for mid, v in k.items():
            model.add_hint(v, merges.get(mid, 0))
        left = max(1.0, float(req.time_limit_s) - total_time)
        st3 = _run(lambda: model.minimize(sum(k.values())), limit=left)
        if st3 in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            counts, merges = _values()
        proven = proven and st3 == cp_model.OPTIMAL

    status_label = "optimal" if proven else "feasible"

    # nunca peor que la heurística voraz (red de seguridad)
    if _lex_key(by_id, greedy, target) > _lex_key(by_id, counts, target):
        counts, merges = greedy, {}
        status_label = "feasible"

    return _finalize(
        by_id, counts, target, S, total_time, cells_mode, status_label, merges
    )


def _lex_key(
    by_id: dict[str, MinerModel], counts: dict[str, int], target: int
) -> tuple[int, int, int]:
    raw = sum(by_id[i].power * c for i, c in counts.items())
    bonus = sum(by_id[i].bonus_bp for i in counts)
    fin = final_power(raw, bonus)
    if fin > target:
        return (-1, 0, 0)
    return (fin, -bonus, raw)


def _greedy(
    usable: list[MinerModel], target: int, max_slots: int, cells_mode: bool
) -> dict[str, int]:
    """Llena con los mineros de mayor poder sin pasar del objetivo."""
    counts: dict[str, int] = {}
    cur_raw = 0
    cur_bonus = 0
    used = 0
    opened: set[str] = set()
    for m in sorted(usable, key=lambda x: (-x.power, x.bonus_bp)):
        w = m.width if cells_mode else 1
        for _ in range(m.quantity):
            if used + w > max_slots:
                break
            add_bonus = m.bonus_bp if m.id not in opened else 0
            if final_power(cur_raw + m.power, cur_bonus + add_bonus) > target:
                break
            cur_raw += m.power
            cur_bonus += add_bonus
            opened.add(m.id)
            counts[m.id] = counts.get(m.id, 0) + 1
            used += w
    return counts


def _finalize(
    by_id: dict[str, MinerModel],
    counts: dict[str, int],
    target: int,
    scale: int,
    solve_time: float,
    cells_mode: bool,
    status: str = "optimal",
    merges: dict[str, int] | None = None,
) -> OptimizeResult:
    # recálculo EXACTO con enteros de Python
    counts = _trim_overshoot(by_id, counts, target)

    raw = sum(by_id[mid].power * c for mid, c in counts.items())
    bonus = sum(by_id[mid].bonus_bp for mid in counts)
    fin = final_power(raw, bonus)
    slots = sum(counts.values())
    cells = sum(by_id[mid].width * c for mid, c in counts.items())

    picks = [
        Pick(
            id=mid,
            count=c,
            power=by_id[mid].power,
            bonus_bp=by_id[mid].bonus_bp,
            width=by_id[mid].width,
            name=by_id[mid].name,
            level=by_id[mid].level,
        )
        for mid, c in sorted(
            counts.items(), key=lambda kv: (-by_id[kv[0]].power, by_id[kv[0]].name)
        )
    ]
    merge_list = [
        Merge(from_id=mid, to_id=by_id[mid].next_id or "", count=c)
        for mid, c in sorted(
            (merges or {}).items(), key=lambda kv: (by_id[kv[0]].level, by_id[kv[0]].name)
        )
    ]
    headroom = target - fin
    return OptimizeResult(
        status=status,
        picks=picks,
        merges=merge_list,
        raw_power=raw,
        bonus_bp=bonus,
        final_power=fin,
        target_final_power=target,
        headroom=headroom,
        headroom_pct=round(fin / target * 100, 4) if target else 0.0,
        slots_used=slots,
        cells_used=cells,
        scale=scale,
        solve_time_s=round(solve_time, 3),
    )


def _trim_overshoot(
    by_id: dict[str, MinerModel], counts: dict[str, int], target: int
) -> dict[str, int]:
    """Red de seguridad: si el redondeo dejó F por encima del objetivo, quita
    copias del minero de menor poder hasta cumplir. En la práctica no se dispara.
    """
    counts = dict(counts)
    while counts:
        raw = sum(by_id[mid].power * c for mid, c in counts.items())
        bonus = sum(by_id[mid].bonus_bp for mid in counts)
        if final_power(raw, bonus) <= target:
            return counts
        weakest = min(counts, key=lambda mid: by_id[mid].power)
        counts[weakest] -= 1
        if counts[weakest] == 0:
            del counts[weakest]
    return counts
