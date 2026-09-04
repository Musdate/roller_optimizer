"""Optimizador de sala RollerCoin.

Lógica pura (solo depende de ortools). Ver RULES.md para la especificación.

Objetivo lexicográfico sobre combinaciones con  F(S) <= objetivo:
    1. maximizar F(S)      (acercarse al techo)
    2. minimizar B(S)      (menor bonus)
    3. maximizar P(S)      (mayor poder bruto)

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


@dataclass
class OptimizeRequest:
    target_final_power: int
    max_slots: int
    slot_mode: str = "miners"       # "miners" | "cells"
    time_limit_s: float = 10.0
    workers: int = 8


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
class OptimizeResult:
    status: str
    picks: list[Pick] = field(default_factory=list)
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
    usable = [
        m
        for m in models
        if m.quantity > 0
        and m.power >= 0
        and m.width >= 1
        and not (m.power == 0 and m.bonus_bp == 0)  # inútil: solo gasta slot
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
    # decisión de qué descartar; más poder y más bonus => más F).
    total_cells = sum(
        m.quantity * (m.width if cells_mode else 1) for m in usable
    )
    if total_cells <= max_slots:
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
        return min(m.quantity, max_slots // max(w, 1))

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
    # frenar la demostración de optimalidad cuando ya estamos a < 1e-6 del óptimo
    # (sobre poderes de 1e12 GH/s eso es < 1e6 GH/s: despreciable).
    solver.parameters.relative_gap_limit = 1e-6
    per_pass = max(1.0, float(req.time_limit_s) / 2)

    total_time = 0.0

    def _run(set_obj) -> int:
        nonlocal total_time
        set_obj()
        solver.parameters.max_time_in_seconds = per_pass
        st = solver.solve(model)
        total_time += solver.wall_time
        return st

    # Pasada 1: maximizar F (acercarse al objetivo)
    st1 = _run(lambda: model.maximize(F))
    if st1 not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return _finalize(by_id, greedy, target, S, total_time, cells_mode, "feasible")
    f_star = int(solver.value(F))
    model.add(F >= f_star)

    # Pasada 2 (combinada): menor bonus y, como desempate, mayor poder bruto.
    #   minimizar  B * W - P_s   con W tal que 1 bp de bonus pesa más que todo P_s
    w = avail_power_s + 1
    st2 = _run(lambda: model.minimize(B * w - P_s))

    proven = st1 == cp_model.OPTIMAL and st2 == cp_model.OPTIMAL
    status_label = "optimal" if proven else "feasible"

    counts = {mid: int(solver.value(v)) for mid, v in use.items() if solver.value(v) > 0}

    # nunca peor que la heurística voraz (red de seguridad)
    if _lex_key(by_id, greedy, target) > _lex_key(by_id, counts, target):
        counts = greedy
        status_label = "feasible"

    return _finalize(by_id, counts, target, S, total_time, cells_mode, status_label)


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
    headroom = target - fin
    return OptimizeResult(
        status=status,
        picks=picks,
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
