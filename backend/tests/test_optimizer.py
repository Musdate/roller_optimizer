"""Tests del optimizador: casos explícitos + comparación contra fuerza bruta."""

from __future__ import annotations

import itertools
import random
import threading
import time

import pytest

from app.optimizer import (
    MinerModel,
    OptimizeRequest,
    final_power,
    optimize,
)


def window_key(fin, bonus, raw, floor, miners):
    """Orden de RULES.md §5.3 (sin merges): dentro de la ventana siempre gana."""
    if floor is not None and fin >= floor:
        return (1, raw, fin, -miners)
    return (0, fin, -bonus, raw, -miners)


def brute_force(models: list[MinerModel], req: OptimizeRequest, floor=None):
    """Óptimo de referencia por enumeración (solo para inventarios chicos)."""
    ranges = [range(min(m.quantity, req.max_slots) + 1) for m in models]
    best = None  # (final, -bonus, raw, counts)
    for combo in itertools.product(*ranges):
        if req.slot_mode == "cells":
            used = sum(c * m.width for c, m in zip(combo, models))
        else:
            used = sum(combo)
        if used > req.max_slots:
            continue
        raw = sum(c * m.power for c, m in zip(combo, models))
        bonus = sum(m.bonus_bp for c, m in zip(combo, models) if c > 0)
        fin = final_power(raw, bonus)
        if fin > req.target_final_power:
            continue
        key = window_key(fin, bonus, raw, floor, sum(combo))
        if best is None or key > best[0]:
            best = (key, combo)
    return best


def result_key(res, floor=None):
    miners = sum(p.count for p in res.picks)
    return window_key(res.final_power, res.bonus_bp, res.raw_power, floor, miners)


# --------------------------------------------------------------------------- #
# Casos explícitos
# --------------------------------------------------------------------------- #


def test_sin_bonus_tope_simple():
    m = MinerModel(id="a", power=100, bonus_bp=0, quantity=10, name="A")
    res = optimize([m], OptimizeRequest(target_final_power=550, max_slots=48))
    assert res.slots_used == 5
    assert res.raw_power == 500
    assert res.final_power == 500
    assert res.final_power <= 550


def test_hit_exacto_con_bonus():
    # 5 mineros: 500 * 1.10 = 550 == objetivo
    m = MinerModel(id="a", power=100, bonus_bp=1000, quantity=20, name="A")
    res = optimize([m], OptimizeRequest(target_final_power=550, max_slots=48))
    assert res.final_power == 550
    assert res.bonus_bp == 1000
    assert res.slots_used == 5


def test_prefiere_acercarse_sobre_bonus_bajo():
    # B (sin bonus) llega a 1000 exacto; A (50%) como mucho llega a 900.
    a = MinerModel(id="a", power=100, bonus_bp=5000, quantity=20, name="A")
    b = MinerModel(id="b", power=100, bonus_bp=0, quantity=20, name="B")
    res = optimize([a, b], OptimizeRequest(target_final_power=1000, max_slots=48))
    assert res.final_power == 1000
    assert res.bonus_bp == 0
    assert {p.id for p in res.picks} == {"b"}


def test_desempata_por_bonus_menor():
    # Dos formas de llegar a 1000 exacto: con o sin el bonus de C.
    # sin C: 10 * B(100,0%) -> 1000
    # con C: usar C aporta bonus pero no ayuda a acercarse -> peor
    b = MinerModel(id="b", power=100, bonus_bp=0, quantity=20, name="B")
    c = MinerModel(id="c", power=100, bonus_bp=3000, quantity=20, name="C")
    res = optimize([b, c], OptimizeRequest(target_final_power=1000, max_slots=48))
    assert res.final_power == 1000
    assert res.bonus_bp == 0


def test_limite_de_slots_mineros():
    m = MinerModel(id="a", power=100, bonus_bp=0, quantity=500, name="A")
    res = optimize([m], OptimizeRequest(target_final_power=10**12, max_slots=48))
    assert res.slots_used == 48
    assert res.raw_power == 4800


def test_modo_celdas_con_width_2():
    m = MinerModel(id="a", power=100, bonus_bp=0, quantity=500, width=2, name="A")
    res = optimize(
        [m],
        OptimizeRequest(target_final_power=10**12, max_slots=48, slot_mode="cells"),
    )
    assert res.slots_used == 24
    assert res.cells_used == 48


def test_nunca_supera_objetivo_numeros_grandes():
    m = MinerModel(id="a", power=52_000_000_000, bonus_bp=6000, quantity=72, name="Ice")
    res = optimize([m], OptimizeRequest(target_final_power=5_450_000_000_000, max_slots=72))
    assert res.final_power <= 5_450_000_000_000
    assert res.slots_used == 65  # 65*52e9*1.6 = 5.408e12 ; 66 -> 5.4912e12 > objetivo


def test_escalado_no_desborda_ni_supera():
    # objetivo grande + bonus alto -> se activa el escalado (S > 1)
    # final(k) = 52e9 * k * 3 = 1.56e11 * k ; objetivo 1.02e13 -> k=65 (66 se pasa)
    m = MinerModel(id="a", power=52_000_000_000, bonus_bp=20000, quantity=72, name="Big")
    target = 10_200_000_000_000
    res = optimize([m], OptimizeRequest(target_final_power=target, max_slots=72))
    assert res.scale > 1
    assert res.final_power <= target
    assert res.slots_used == 65
    # sumar una copia más se pasa del objetivo
    assert final_power(res.raw_power + m.power, res.bonus_bp) > target


def test_inventario_vacio():
    res = optimize([], OptimizeRequest(target_final_power=1000, max_slots=48))
    assert res.picks == []
    assert res.final_power == 0


def test_objetivo_cero():
    m = MinerModel(id="a", power=100, bonus_bp=0, quantity=10, name="A")
    res = optimize([m], OptimizeRequest(target_final_power=0, max_slots=48))
    assert res.picks == []


# --------------------------------------------------------------------------- #
# Fuzz contra fuerza bruta
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("seed", range(25))
def test_fuzz_vs_fuerza_bruta(seed):
    rng = random.Random(seed)
    n = rng.randint(1, 4)
    models = [
        MinerModel(
            id=f"m{i}",
            power=rng.choice([1, 5, 10, 25, 100, 250, 1000]),
            bonus_bp=rng.choice([0, 0, 100, 500, 1000, 2500, 5000]),
            quantity=rng.randint(1, 5),
            width=rng.choice([1, 1, 2]),
            name=f"M{i}",
        )
        for i in range(n)
    ]
    max_slots = rng.randint(1, 8)
    slot_mode = rng.choice(["miners", "cells"])
    # objetivo: algo entre 0 y el máximo alcanzable
    max_raw = sum(min(m.quantity, max_slots) * m.power for m in models)
    max_bonus = sum(m.bonus_bp for m in models)
    ceil_f = final_power(max_raw, max_bonus)
    target = rng.randint(0, ceil_f + 50)

    req = OptimizeRequest(
        target_final_power=target, max_slots=max_slots, slot_mode=slot_mode
    )
    res = optimize(models, req)
    ref = brute_force(models, req)

    assert res.final_power <= target
    if ref is None:
        # brute force no encontró nada estrictamente positivo -> la vacía siempre vale
        assert res.final_power == 0
        return
    (ref_key, _combo) = ref
    assert result_key(res) == ref_key, (
        f"seed={seed} models={models} slots={max_slots}/{slot_mode} target={target}\n"
        f"got  {result_key(res)}\nwant {ref_key}"
    )


# --------------------------------------------------------------------------- #
# Merges (RULES.md §5.9)
# --------------------------------------------------------------------------- #


def _chain(qtys, powers, bonuses, width=1):
    """Escalera c0 -> c1 -> ... del mismo minero."""
    n = len(qtys)
    return [
        MinerModel(
            id=f"c{i}",
            power=powers[i],
            bonus_bp=bonuses[i],
            quantity=qtys[i],
            width=width,
            name="C",
            level=i + 1,
            next_id=f"c{i + 1}" if i + 1 < n else None,
        )
        for i in range(n)
    ]


def _merged_counts(models, res):
    """Copias disponibles tras aplicar los merges del resultado."""
    avail = {m.id: m.quantity for m in models}
    for mg in res.merges:
        avail[mg.from_id] -= 2 * mg.count
        avail[mg.to_id] += mg.count
    return avail


def test_merge_mejora_la_sala():
    # 1 celda: 2x nivel 1 (750, 1%) -> 1x nivel 2 (2000, 2.5%)
    models = _chain([2, 0], [750, 2000], [100, 250])
    req = OptimizeRequest(target_final_power=10**6, max_slots=1, allow_merges=True)
    res = optimize(models, req)
    assert [(m.from_id, m.to_id, m.count) for m in res.merges] == [("c0", "c1", 1)]
    assert [(p.id, p.count) for p in res.picks] == [("c1", 1)]
    assert res.final_power == final_power(2000, 250)


def test_sin_allow_merges_ignora_next_id():
    models = _chain([2, 0], [750, 2000], [100, 250])
    req = OptimizeRequest(target_final_power=10**6, max_slots=1)
    res = optimize(models, req)
    assert res.merges == []
    assert [(p.id, p.count) for p in res.picks] == [("c0", 1)]


def test_merge_en_cadena():
    # 4x nivel 1 -> 2x nivel 2 -> 1x nivel 3
    models = _chain([4, 0, 0], [750, 2000, 5500], [100, 250, 500])
    req = OptimizeRequest(target_final_power=10**6, max_slots=1, allow_merges=True)
    res = optimize(models, req)
    assert [(m.from_id, m.count) for m in res.merges] == [("c0", 2), ("c1", 1)]
    assert [(p.id, p.count) for p in res.picks] == [("c2", 1)]


def test_merge_descartado_no_se_usa():
    # 4x nivel 1 -> 2x nivel 2 -> 1x nivel 3, pero 2 -> 3 está descartado
    models = _chain([4, 0, 0], [750, 2000, 5500], [100, 250, 500])
    req = OptimizeRequest(
        target_final_power=10**6,
        max_slots=1,
        allow_merges=True,
        excluded_merges=frozenset({"c1"}),
    )
    res = optimize(models, req)
    assert [(m.from_id, m.count) for m in res.merges] == [("c0", 1)]
    assert [(p.id, p.count) for p in res.picks] == [("c1", 1)]


def test_no_mergea_copias_que_no_se_usan():
    # sobran copias de nivel 1 fuera de la sala: mergearlas no cambia nada
    models = _chain([6, 1], [100, 150], [0, 0])
    req = OptimizeRequest(target_final_power=10**6, max_slots=2, allow_merges=True)
    res = optimize(models, req)
    # óptimo: 2x nivel 2 (300) -> hace falta exactamente 1 merge
    assert res.raw_power == 300
    assert sum(m.count for m in res.merges) == 1


def brute_force_merges(models, req, floor=None):
    """Como brute_force pero enumerando merges en una escalera c0 -> c1 -> c2."""
    chain = [m for m in models if m.id.startswith("c")]
    best = None
    k_ranges = [range(chain[0].quantity // 2 + 1)]
    for k0 in k_ranges[0]:
        for k1 in range((chain[1].quantity + k0) // 2 + 1):
            avail = {m.id: m.quantity for m in models}
            avail["c0"] -= 2 * k0
            avail["c1"] += k0 - 2 * k1
            avail["c2"] += k1
            if min(avail.values()) < 0:
                continue
            ranges = [range(min(avail[m.id], req.max_slots) + 1) for m in models]
            for combo in itertools.product(*ranges):
                if req.slot_mode == "cells":
                    used = sum(c * m.width for c, m in zip(combo, models))
                else:
                    used = sum(combo)
                if used > req.max_slots:
                    continue
                raw = sum(c * m.power for c, m in zip(combo, models))
                bonus = sum(m.bonus_bp for c, m in zip(combo, models) if c > 0)
                fin = final_power(raw, bonus)
                if fin > req.target_final_power:
                    continue
                key = window_key(fin, bonus, raw, floor, sum(combo)) + (-(k0 + k1),)
                if best is None or key > best:
                    best = key
    return best


@pytest.mark.parametrize("seed", range(25))
def test_fuzz_merges_vs_fuerza_bruta(seed):
    rng = random.Random(1000 + seed)
    p0 = rng.choice([100, 300, 750])
    chain = _chain(
        [rng.randint(0, 5), rng.randint(0, 2), rng.randint(0, 1)],
        [p0, p0 * rng.choice([2, 3]), p0 * rng.choice([5, 7])],
        [rng.choice([0, 100]), rng.choice([0, 250]), rng.choice([0, 500])],
        width=rng.choice([1, 2]),
    )
    others = [
        MinerModel(
            id=f"m{i}",
            power=rng.choice([50, 200, 1000]),
            bonus_bp=rng.choice([0, 100, 1000]),
            quantity=rng.randint(1, 3),
            width=rng.choice([1, 2]),
            name=f"M{i}",
        )
        for i in range(rng.randint(0, 2))
    ]
    models = chain + others
    max_slots = rng.randint(1, 6)
    slot_mode = rng.choice(["miners", "cells"])
    max_raw = sum(m.power * 4 for m in models)
    target = rng.randint(0, final_power(max_raw, 1000) + 50)

    req = OptimizeRequest(
        target_final_power=target,
        max_slots=max_slots,
        slot_mode=slot_mode,
        allow_merges=True,
    )
    res = optimize(models, req)
    ref = brute_force_merges(models, req)

    assert res.final_power <= target
    avail = _merged_counts(models, res)
    assert min(avail.values()) >= 0
    for p in res.picks:
        assert p.count <= avail[p.id]
    got = result_key(res) + (-sum(m.count for m in res.merges),)
    assert got == ref, (
        f"seed={seed} models={models} slots={max_slots}/{slot_mode} target={target}\n"
        f"got  {got}\nwant {ref}"
    )


# --------------------------------------------------------------------------- #
# Ventana: margen bajo el tope (RULES.md §5.2, §5.3)
# --------------------------------------------------------------------------- #


def test_ventana_prefiere_bruto_sobre_poder_final():
    # a: 100 bruto, +100% -> F 200 (justo el tope). b+c: 190 bruto sin bonus.
    a = MinerModel(id="a", power=100, bonus_bp=10000, quantity=1, name="A")
    b = MinerModel(id="b", power=95, bonus_bp=0, quantity=2, name="B")
    req = OptimizeRequest(target_final_power=200, max_slots=2, margin_bp=1000)
    res = optimize([a, b], req)
    assert res.raw_power == 190 and res.final_power == 190
    assert res.in_window and res.floor_power == 180


def test_sin_margen_mantiene_criterio_de_poder_final():
    a = MinerModel(id="a", power=100, bonus_bp=10000, quantity=1, name="A")
    b = MinerModel(id="b", power=95, bonus_bp=0, quantity=2, name="B")
    res = optimize([a, b], OptimizeRequest(target_final_power=200, max_slots=2))
    assert res.final_power == 200 and not res.in_window


def test_ventana_inalcanzable_usa_respaldo():
    a = MinerModel(id="a", power=10, bonus_bp=0, quantity=3, name="A")
    req = OptimizeRequest(target_final_power=1000, max_slots=48, margin_bp=100)
    res = optimize([a], req)
    assert res.final_power == 30 and not res.in_window


def test_ventana_desempata_por_poder_final():
    # mismo bruto (100); con bonus sube F dentro de la ventana
    a = MinerModel(id="a", power=100, bonus_bp=500, quantity=1, name="A")
    b = MinerModel(id="b", power=100, bonus_bp=0, quantity=1, name="B")
    req = OptimizeRequest(target_final_power=110, max_slots=1, margin_bp=1000)
    res = optimize([a, b], req)
    assert [p.id for p in res.picks] == ["a"] and res.final_power == 105


def test_sin_tope_maximiza_bruto():
    a = MinerModel(id="a", power=1000, bonus_bp=0, quantity=2, name="A")
    b = MinerModel(id="b", power=900, bonus_bp=5000, quantity=2, name="B")
    req = OptimizeRequest(target_final_power=None, max_slots=2, margin_bp=100)
    res = optimize([a, b], req)
    assert res.raw_power == 2000
    assert res.target_final_power is None and res.headroom is None
    assert res.in_window


@pytest.mark.parametrize("seed", range(25))
def test_fuzz_ventana_vs_fuerza_bruta(seed):
    rng = random.Random(500 + seed)
    models = [
        MinerModel(
            id=f"m{i}",
            power=rng.choice([1, 5, 10, 25, 100, 250, 1000]),
            bonus_bp=rng.choice([0, 0, 100, 500, 1000, 2500, 5000]),
            quantity=rng.randint(1, 5),
            width=rng.choice([1, 1, 2]),
            name=f"M{i}",
        )
        for i in range(rng.randint(1, 4))
    ]
    max_slots = rng.randint(1, 8)
    slot_mode = rng.choice(["miners", "cells"])
    max_raw = sum(min(m.quantity, max_slots) * m.power for m in models)
    target = rng.randint(1, final_power(max_raw, sum(m.bonus_bp for m in models)) + 50)
    margin = rng.choice([0, 100, 500, 1000, 3000])
    floor = target - target * margin // 10000

    req = OptimizeRequest(
        target_final_power=target, max_slots=max_slots, slot_mode=slot_mode,
        margin_bp=margin,
    )
    res = optimize(models, req)
    ref = brute_force(models, req, floor)

    assert res.final_power <= target
    assert res.in_window == (res.final_power >= floor)
    (ref_key, _combo) = ref
    assert result_key(res, floor) == ref_key, (
        f"seed={seed} models={models} slots={max_slots}/{slot_mode} "
        f"target={target} floor={floor}\ngot  {result_key(res, floor)}\nwant {ref_key}"
    )


@pytest.mark.parametrize("seed", range(25))
def test_fuzz_ventana_merges_vs_fuerza_bruta(seed):
    rng = random.Random(2000 + seed)
    p0 = rng.choice([100, 300, 750])
    chain = _chain(
        [rng.randint(0, 5), rng.randint(0, 2), rng.randint(0, 1)],
        [p0, p0 * rng.choice([2, 3]), p0 * rng.choice([5, 7])],
        [rng.choice([0, 100]), rng.choice([0, 250]), rng.choice([0, 500])],
        width=rng.choice([1, 2]),
    )
    others = [
        MinerModel(
            id=f"m{i}",
            power=rng.choice([50, 200, 1000]),
            bonus_bp=rng.choice([0, 100, 1000]),
            quantity=rng.randint(1, 3),
            width=rng.choice([1, 2]),
            name=f"M{i}",
        )
        for i in range(rng.randint(0, 2))
    ]
    models = chain + others
    max_slots = rng.randint(1, 6)
    slot_mode = rng.choice(["miners", "cells"])
    target = rng.randint(1, final_power(sum(m.power * 4 for m in models), 1000) + 50)
    margin = rng.choice([100, 1000, 3000])
    floor = target - target * margin // 10000

    req = OptimizeRequest(
        target_final_power=target, max_slots=max_slots, slot_mode=slot_mode,
        allow_merges=True, margin_bp=margin,
    )
    res = optimize(models, req)
    ref = brute_force_merges(models, req, floor)

    assert res.final_power <= target
    avail = _merged_counts(models, res)
    assert min(avail.values()) >= 0
    for p in res.picks:
        assert p.count <= avail[p.id]
    got = result_key(res, floor) + (-sum(m.count for m in res.merges),)
    assert got == ref, (
        f"seed={seed} models={models} slots={max_slots}/{slot_mode} "
        f"target={target} floor={floor}\ngot  {got}\nwant {ref}"
    )


# --------------------------------------------------------------------------- #
# Progreso y detener (RULES.md §5.10)
# --------------------------------------------------------------------------- #


def _big_inventory(n=60, seed=7):
    rng = random.Random(seed)
    return [
        MinerModel(
            id=f"x{i}",
            power=rng.randint(10**6, 10**9),
            bonus_bp=rng.randint(0, 3000),
            quantity=rng.randint(1, 6),
            width=rng.choice([1, 2]),
            name=f"X{i}",
        )
        for i in range(n)
    ]


def test_informa_progreso():
    events = []
    models = _big_inventory()
    req = OptimizeRequest(
        target_final_power=10**11, max_slots=96, slot_mode="cells",
        margin_bp=100, time_limit_s=5,
    )
    res = optimize(models, req, progress=lambda **kw: events.append(kw))
    phases = [e["phase"] for e in events if "phase" in e]
    assert phases[0] == "raw"
    assert any(e.get("best") for e in events)
    assert res.final_power <= 10**11


def test_detener_devuelve_la_mejor_encontrada():
    stop = threading.Event()
    stop.set()  # detenido desde el arranque: todo corre con _POLISH_S
    models = _big_inventory(seed=11)
    req = OptimizeRequest(
        target_final_power=10**11, max_slots=96, slot_mode="cells",
        margin_bp=100, time_limit_s=300,
    )
    t0 = time.monotonic()
    res = optimize(models, req, stop=stop)
    assert time.monotonic() - t0 < 30
    assert res.final_power <= 10**11
    assert res.picks


def test_desempata_por_menos_mineros():
    # 2x a y 1x b dan el mismo bruto y poder final: gana la de 1 minero
    a = MinerModel(id="a", power=10, bonus_bp=0, quantity=2, name="A")
    b = MinerModel(id="b", power=20, bonus_bp=0, quantity=1, name="B")
    for margin in (None, 1000):
        req = OptimizeRequest(target_final_power=20, max_slots=1 + 1, margin_bp=margin)
        res = optimize([a, b], req)
        assert [(p.id, p.count) for p in res.picks] == [("b", 1)], margin


def test_atajo_no_repite_mineros_sin_poder():
    solo_bonus = MinerModel(id="z", power=0, bonus_bp=100, quantity=3, name="Z")
    a = MinerModel(id="a", power=100, bonus_bp=0, quantity=1, name="A")
    res = optimize([solo_bonus, a], OptimizeRequest(target_final_power=10**6, max_slots=48))
    assert {p.id: p.count for p in res.picks} == {"a": 1, "z": 1}


# --------------------------------------------------------------------------- #
# "¿cuánto aporta?": solo la pasada principal (RULES.md §5.9)
# --------------------------------------------------------------------------- #


def test_primary_only_da_el_mismo_bruto_que_la_optimizacion_completa():
    models = _big_inventory(n=20, seed=3)
    base = dict(target_final_power=10**10, max_slots=24, slot_mode="cells", time_limit_s=10)
    for margin in (None, 100):
        full = optimize(models, OptimizeRequest(**base, margin_bp=margin))
        prim = optimize(models, OptimizeRequest(**base, margin_bp=margin, primary_only=True))
        key = (lambda r: r.raw_power) if margin else (lambda r: r.final_power)
        # la pasada principal corta con gap relativo 1e-6 (RULES.md §7.3)
        assert abs(key(prim) - key(full)) <= key(full) * 1e-6, margin


def test_aporte_del_merge_cuenta_el_minero_desplazado():
    # 2 celdas: con merge c1 (2000) + m (600); sin merge, 2x c0 (1500)
    models = _chain([2, 0], [750, 2000], [0, 0]) + [
        MinerModel(id="m", power=600, bonus_bp=0, quantity=1, name="M")
    ]
    base = dict(target_final_power=10**6, max_slots=2, allow_merges=True, margin_bp=100)
    res = optimize(models, OptimizeRequest(**base))
    alt = optimize(
        models,
        OptimizeRequest(**base, excluded_merges=frozenset({"c0"}), primary_only=True),
    )
    assert res.raw_power - alt.raw_power == 1100
