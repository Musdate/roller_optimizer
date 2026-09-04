"""Tests del optimizador: casos explícitos + comparación contra fuerza bruta."""

from __future__ import annotations

import itertools
import random

import pytest

from app.optimizer import (
    MinerModel,
    OptimizeRequest,
    final_power,
    optimize,
)


def brute_force(models: list[MinerModel], req: OptimizeRequest):
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
        key = (fin, -bonus, raw)
        if best is None or key > best[0]:
            best = (key, combo)
    return best


def result_key(res):
    raw = res.raw_power
    return (res.final_power, -res.bonus_bp, raw)


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
