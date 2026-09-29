"""Optimizador de sala RollerCoin.

Lógica pura (solo depende de ortools). Ver RULES.md para la especificación.

Objetivo lexicográfico sobre combinaciones con  F(S) <= tope (RULES.md §5.3).
Con margen, dentro de la ventana  piso <= F(S) <= tope:
    1. maximizar P(S)      (mayor poder bruto)
    2. maximizar F(S)
    3. minimizar mineros
    4. minimizar merges    (solo con allow_merges, ver RULES.md §5.9)
Respaldo (sin margen, o si nada llega al piso):
    1. maximizar F(S)      (acercarse al techo)
    2. minimizar B(S)      (menor bonus)
    3. maximizar P(S)      (mayor poder bruto)
    4. minimizar mineros
    5. minimizar merges

donde
    P(S) = suma de poder bruto de cada minero colocado
    B(S) = suma de bonus (bp) contando 1 vez por modelo (dedup)
    F(S) = P(S) * (10000 + B(S)) // 10000
"""

from __future__ import annotations

import math
import os
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, field, replace

from ortools.sat.python import cp_model

BP = 10_000  # 10000 bp = 100%
# Cota superior deseada para expresiones lineales internas (margen amplio vs int64).
_INT_SAFE = 10**17
# Tiempo de las pasadas de desempate tras detener o agotar el plazo (§5.10).
_POLISH_S = 3.0
# Tope de cada pasada de desempate: encuentran su mejor valor casi al toque
# (arrancan de la solución anterior) pero demostrarlo puede no terminar nunca
# con muchos empates exactos de poder bruto (RULES.md §7.3).
_TIEBREAK_S = 10.0


def _default_workers() -> int:
    try:
        return max(1, int(os.environ.get("OPT_WORKERS", "8")))
    except ValueError:
        return 8


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
    locked: int = 0     # copias bloqueadas en la sala: van sí o sí (RULES.md §5.11)


class LockedOverCapError(ValueError):
    """Los mineros bloqueados solos ya no entran (tope o celdas)."""


@dataclass
class OptimizeRequest:
    target_final_power: int | None  # tope; None = sin tope (última liga)
    max_slots: int
    slot_mode: str = "miners"       # "miners" | "cells"
    time_limit_s: float = 10.0
    workers: int = field(default_factory=_default_workers)
    margin_bp: int | None = None    # None = solo respaldo (RULES.md §5.2)
    primary_only: bool = False      # solo la pasada principal ("¿cuánto aporta?", §5.9)
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
    target_final_power: int | None = 0
    floor_power: int = 0
    in_window: bool = False
    headroom: int | None = 0
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


Progress = Callable[..., None]


def optimize(
    models: list[MinerModel],
    req: OptimizeRequest,
    progress: Progress | None = None,
    stop: threading.Event | None = None,
) -> OptimizeResult:
    """`progress(phase=..., best=..., bound=...)` informa la pasada en curso
    (GH/s; None si no aplica). `stop` corta la búsqueda (RULES.md §5.10)."""
    t_start = time.monotonic()
    deadline = t_start + float(req.time_limit_s)

    def report(**kw) -> None:
        if progress is not None:
            progress(**kw)

    # --- saneo de entrada -------------------------------------------------
    valid = {
        m.id: replace(m, locked=min(max(m.locked, 0), m.quantity))
        for m in models
        if m.quantity >= 0
        and m.power >= 0
        and m.width >= 1
        # inútil: solo gasta slot (salvo que esté bloqueado en la sala)
        and not (m.power == 0 and m.bonus_bp == 0 and m.locked <= 0)
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
    max_slots = int(req.max_slots)
    cells_mode = req.slot_mode == "cells"
    by_id = {m.id: m for m in usable}

    # Sin tope (última liga) se usa la F de todas las copias alcanzables, que
    # ninguna sala puede superar (RULES.md §7.2).
    upper = final_power(
        sum(m.power * disp[m.id] for m in usable),
        sum(max(m.bonus_bp, 0) for m in usable),
    )
    shown_target = None if req.target_final_power is None else int(req.target_final_power)
    cap = upper if shown_target is None else shown_target
    floor: int | None = None
    if req.margin_bp is not None:
        margin = min(max(int(req.margin_bp), 0), BP)
        floor = 0 if shown_target is None else cap - cap * margin // BP

    def finish(counts, scale, status, merges=None) -> OptimizeResult:
        return _finalize(
            by_id, counts, cap, shown_target, floor, scale,
            time.monotonic() - t_start, cells_mode, status, merges,
        )

    locked = {m.id: m.locked for m in usable if m.locked > 0}
    if locked:
        locked_slots = sum(c * (by_id[i].width if cells_mode else 1) for i, c in locked.items())
        if locked_slots > max_slots:
            raise LockedOverCapError(
                "Los mineros bloqueados ocupan más celdas de las disponibles."
            )
        locked_final = final_power(
            sum(by_id[i].power * c for i, c in locked.items()),
            sum(by_id[i].bonus_bp for i in locked),
        )
        if locked_final > cap:
            raise LockedOverCapError(
                "Los mineros bloqueados ya superan el tope: desbloquea alguno o elige un tope mayor."
            )

    if not usable or max_slots <= 0 or cap <= 0:
        return finish({}, 1, "optimal")

    # --- atajo: si TODAS las copias entran en la sala y ni así se pasa del ---
    # tope, usar todo el inventario es lex-óptimo en los dos modos (mayor P y
    # mayor F posibles). Con merges posibles no vale: mergear también sube
    # poder y bonus.
    total_cells = sum(
        m.quantity * (m.width if cells_mode else 1) for m in usable
    )
    if total_cells <= max_slots and not mergeable:
        # de un modelo sin poder solo cuenta el bonus: sobra 1 copia (menos mineros)
        all_counts = {m.id: m.quantity if m.power > 0 else max(1, m.locked) for m in usable}
        all_raw = sum(by_id[i].power * c for i, c in all_counts.items())
        all_bonus = sum(by_id[i].bonus_bp for i in all_counts)
        if final_power(all_raw, all_bonus) <= cap:
            return finish(all_counts, 1, "optimal")

    # recortar el tope a lo alcanzable no cambia la solución y evita inflar la escala
    target = min(cap, upper)

    # --- heurística voraz: solución factible rápida (hint + fallback) --------
    greedy = _greedy(usable, target, max_slots, cells_mode)

    # --- escala (RULES.md §7.4) ----------------------------------------------
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

    def build(floor_s: int | None):
        """Modelo CP-SAT exacto (linealización manual del producto)."""
        model = cp_model.CpModel()
        use: dict[str, cp_model.IntVar] = {}
        y: dict[str, cp_model.IntVar] = {}
        for m in usable:
            u = model.new_int_var(m.locked, slot_cap(m), f"use_{m.id}")
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
        if floor_s is not None:
            model.add(F >= BP * floor_s)
        return model, use, y, k, P_s, B, F

    def hint(model, use, y, k, counts, merges=None) -> None:
        model.clear_hints()
        for mid, v in use.items():
            model.add_hint(v, counts.get(mid, 0))
            model.add_hint(y[mid], 1 if counts.get(mid, 0) > 0 else 0)
        for mid, v in k.items():
            model.add_hint(v, (merges or {}).get(mid, 0))

    solver = cp_model.CpSolver()
    solver.parameters.num_workers = int(req.workers)

    class _Cb(cp_model.CpSolverSolutionCallback):
        def __init__(self, to_gh):
            super().__init__()
            self.to_gh = to_gh

        def on_solution_callback(self) -> None:
            if self.to_gh:
                report(
                    best=self.to_gh(self.objective_value),
                    bound=self.to_gh(self.best_objective_bound),
                )

    def run(model, phase: str, to_gh=None, gap: float = 0.0, first: bool = False) -> int:
        """Una pasada con lo que queda del plazo. Tras detener o agotarlo, las
        de desempate corren igual con `_POLISH_S` (RULES.md §7.3)."""
        report(phase=phase, best=None, bound=None)
        stopped = stop is not None and stop.is_set()
        left = deadline - time.monotonic()
        if stopped:
            limit = _POLISH_S
        elif first:
            limit = max(1.0, left)
        else:
            limit = max(_POLISH_S, min(_TIEBREAK_S, left))
        solver.parameters.relative_gap_limit = gap
        solver.parameters.max_time_in_seconds = limit
        solver.best_bound_callback = (lambda b: report(bound=to_gh(b))) if to_gh else None
        done = threading.Event()
        if stop is not None and not stopped:
            def watch() -> None:
                while not done.wait(0.2):
                    if stop.is_set():
                        solver.stop_search()
                        return
            threading.Thread(target=watch, daemon=True).start()
        try:
            return solver.solve(model, _Cb(to_gh))
        finally:
            done.set()

    def fewer_miners(model, use, y, k, counts, merges):
        """Pasada 3 de los dos modos: menos mineros y, a igualdad, menos merges
        (RULES.md §7.3). Un minero pesa más que todos los merges posibles."""
        hint(model, use, y, k, counts, merges)
        w = sum(disp[mid] // 2 for mid in k) + 1
        model.minimize(sum(use.values()) * w + sum(k.values()))
        st = run(model, "miners")
        if st in ok:
            counts, merges = values(use, k)
        return counts, merges, st == cp_model.OPTIMAL

    def values(use, k) -> tuple[dict[str, int], dict[str, int]]:
        cs = {mid: int(solver.value(v)) for mid, v in use.items() if solver.value(v) > 0}
        ms = {mid: int(solver.value(v)) for mid, v in k.items() if solver.value(v) > 0}
        return cs, ms

    ok = (cp_model.OPTIMAL, cp_model.FEASIBLE)

    def f_to_gh(v: float) -> int:
        return int(v) * S // BP

    def p_to_gh(v: float) -> int:
        return int(v) * S

    # (counts, merges, pasada principal demostrada, todas demostradas)
    result: tuple[dict[str, int], dict[str, int], bool, bool] | None = None

    # --- modo ventana (RULES.md §7.3) ----------------------------------------
    if floor is not None:
        model, use, y, k, P_s, B, F = build(-(-floor // S))
        hint(model, use, y, k, greedy)
        model.maximize(P_s)
        st1 = run(model, "raw", p_to_gh, gap=1e-6, first=True)
        if st1 in ok and req.primary_only:
            counts, merges = values(use, k)
            result = (counts, merges, st1 == cp_model.OPTIMAL, st1 == cp_model.OPTIMAL)
        elif st1 in ok:
            counts, merges = values(use, k)
            model.add(P_s >= int(solver.value(P_s)))
            hint(model, use, y, k, counts, merges)
            model.maximize(F)
            st2 = run(model, "final", f_to_gh, gap=1e-6)
            if st2 in ok:
                counts, merges = values(use, k)
                f_star = int(solver.value(F))
            proven = st1 == cp_model.OPTIMAL and st2 == cp_model.OPTIMAL
            if st2 in ok:
                model.add(F >= f_star)
                counts, merges, p3 = fewer_miners(model, use, y, k, counts, merges)
                proven = proven and p3
            result = (counts, merges, st1 == cp_model.OPTIMAL, proven)

    # --- modo respaldo -------------------------------------------------------
    if result is None:
        model, use, y, k, P_s, B, F = build(None)
        hint(model, use, y, k, greedy)
        model.maximize(F)
        # gap 1e-6 sobre F queda bajo lo que se muestra (50 EH/s -> 0.00005 EH/s)
        st1 = run(model, "fallback", f_to_gh, gap=1e-6, first=floor is None)
        if st1 not in ok:
            return finish(greedy, S, "feasible")
        counts, merges = values(use, k)
        if req.primary_only:
            proven = st1 == cp_model.OPTIMAL
            return finish(counts, S, "optimal" if proven else "feasible", merges)
        model.add(F >= int(solver.value(F)))
        hint(model, use, y, k, counts, merges)

        # Pasada 2 (combinada): menor bonus y, como desempate, mayor poder bruto.
        #   minimizar  B * W - P_s   con W tal que 1 bp de bonus pesa más que todo P_s
        # Sin gap: el objetivo lo domina B*W y un gap relativo dejaría P_s lejos
        # del óptimo (RULES.md §7.3).
        model.minimize(B * (avail_power_s + 1) - P_s)
        st2 = run(model, "tiebreak")
        if st2 in ok:
            counts, merges = values(use, k)
        proven = st1 == cp_model.OPTIMAL and st2 == cp_model.OPTIMAL

        # Pasada 3: a igual B y P_s, menos mineros y merges. Aparte y no como
        # peso en la 2 porque multiplicar B*W otra vez puede desbordar int64.
        if st2 in ok:
            model.add(B == int(solver.value(B)))
            model.add(P_s >= int(solver.value(P_s)))
            counts, merges, p3 = fewer_miners(model, use, y, k, counts, merges)
            proven = proven and p3
        result = (counts, merges, st1 == cp_model.OPTIMAL, proven)

    counts, merges, main_proven, proven = result
    status_label = "optimal" if proven else "optimal_primary" if main_proven else "feasible"

    # nunca peor que la heurística voraz (red de seguridad)
    if _lex_key(by_id, greedy, cap, floor) > _lex_key(by_id, counts, cap, floor):
        counts, merges = greedy, {}
        status_label = "feasible"

    return finish(counts, S, status_label, merges)


def _lex_key(
    by_id: dict[str, MinerModel],
    counts: dict[str, int],
    cap: int,
    floor: int | None,
) -> tuple[int, ...]:
    """Orden de RULES.md §5.3: dentro de la ventana siempre gana."""
    raw = sum(by_id[i].power * c for i, c in counts.items())
    bonus = sum(by_id[i].bonus_bp for i in counts)
    fin = final_power(raw, bonus)
    miners = sum(counts.values())
    if fin > cap:
        return (-1,)
    if floor is not None and fin >= floor:
        return (1, raw, fin, -miners)
    return (0, fin, -bonus, raw, -miners)


def _greedy(
    usable: list[MinerModel], target: int, max_slots: int, cells_mode: bool
) -> dict[str, int]:
    """Parte de los bloqueados y llena con los mineros de mayor poder sin
    pasar del objetivo."""
    counts: dict[str, int] = {m.id: m.locked for m in usable if m.locked > 0}
    cur_raw = sum(m.power * m.locked for m in usable)
    cur_bonus = sum(m.bonus_bp for m in usable if m.locked > 0)
    used = sum(m.locked * (m.width if cells_mode else 1) for m in usable)
    opened: set[str] = set(counts)
    for m in sorted(usable, key=lambda x: (-x.power, x.bonus_bp)):
        w = m.width if cells_mode else 1
        for _ in range(m.quantity - m.locked):
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
    cap: int,
    shown_target: int | None,
    floor: int | None,
    scale: int,
    solve_time: float,
    cells_mode: bool,
    status: str = "optimal",
    merges: dict[str, int] | None = None,
) -> OptimizeResult:
    # recálculo EXACTO con enteros de Python
    counts = _trim_overshoot(by_id, counts, cap)

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
    return OptimizeResult(
        status=status,
        picks=picks,
        merges=merge_list,
        raw_power=raw,
        bonus_bp=bonus,
        final_power=fin,
        target_final_power=shown_target,
        floor_power=floor or 0,
        in_window=floor is not None and floor <= fin <= cap,
        headroom=None if shown_target is None else shown_target - fin,
        headroom_pct=round(fin / shown_target * 100, 4) if shown_target else 0.0,
        slots_used=slots,
        cells_used=cells,
        scale=scale,
        solve_time_s=round(solve_time, 3),
    )


def _trim_overshoot(
    by_id: dict[str, MinerModel], counts: dict[str, int], target: int
) -> dict[str, int]:
    """Red de seguridad: si el redondeo dejó F por encima del objetivo, quita
    copias del minero de menor poder hasta cumplir, sin tocar las bloqueadas.
    En la práctica no se dispara.
    """
    counts = dict(counts)
    while counts:
        raw = sum(by_id[mid].power * c for mid, c in counts.items())
        bonus = sum(by_id[mid].bonus_bp for mid in counts)
        if final_power(raw, bonus) <= target:
            return counts
        free = [mid for mid, c in counts.items() if c > by_id[mid].locked]
        if not free:
            return counts
        weakest = min(free, key=lambda mid: by_id[mid].power)
        counts[weakest] -= 1
        if counts[weakest] == 0:
            del counts[weakest]
    return counts
