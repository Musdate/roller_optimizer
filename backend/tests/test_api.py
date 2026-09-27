"""Tests de la API de trabajos de optimización y ligas (RULES.md §5.10, §8)."""

from __future__ import annotations

import time

from fastapi.testclient import TestClient

from app.leagues import leagues
from app.main import app

client = TestClient(app)

_BODY = {
    "target_final_power": "200",
    "margin_bp": 1000,
    "max_slots": 2,
    "slot_mode": "miners",
    "time_limit_s": 10,
    "inventory": [
        {"id": "a", "name": "A", "power": "100", "bonus_bp": 10000, "quantity": 1},
        {"id": "b", "name": "B", "power": "95", "bonus_bp": 0, "quantity": 2},
    ],
}


def _wait(job_id: str) -> dict:
    for _ in range(200):
        st = client.get(f"/api/optimize/{job_id}").json()
        if st["state"] != "running":
            return st
        time.sleep(0.05)
    raise AssertionError("el trabajo no terminó")


def test_trabajo_de_optimizacion():
    res = client.post("/api/optimize", json=_BODY)
    assert res.status_code == 200
    st = _wait(res.json()["job_id"])
    assert st["state"] == "done"
    r = st["result"]
    assert r["raw_power"] == "190" and r["in_window"] is True
    assert r["floor_power"] == "180" and r["target_final_power"] == "200"


def test_sin_tope():
    body = {**_BODY, "target_final_power": None}
    st = _wait(client.post("/api/optimize", json=body).json()["job_id"])
    r = st["result"]
    assert r["target_final_power"] is None and r["headroom"] is None
    assert r["raw_power"] == "195"


def test_detener_es_idempotente():
    job_id = client.post("/api/optimize", json=_BODY).json()["job_id"]
    assert client.post(f"/api/optimize/{job_id}/stop").status_code == 200
    assert client.post(f"/api/optimize/{job_id}/stop").json()["stopping"] is True
    assert _wait(job_id)["state"] == "done"


def test_trabajo_inexistente():
    assert client.get("/api/optimize/nope").status_code == 404


def test_ligas_con_tope(monkeypatch):
    monkeypatch.setattr(leagues, "_last_attempt", time.time())  # sin red: solo el seed
    rows = client.get("/api/leagues").json()
    assert len(rows) >= 2
    by_title = {r["title"]: r for r in rows}
    assert by_title["Platinum I"]["max_power"] == str(50_000_000_000 - 1)
    assert rows[-1]["max_power"] is None
