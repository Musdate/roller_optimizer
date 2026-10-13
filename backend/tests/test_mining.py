"""Tests de la calculadora de minado (RULES.md §12)."""

from __future__ import annotations

import time

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.mining import FIXED_PRICES, mining, normalize_leagues

client = TestClient(app)

_RAW = [
    {
        "level": 9,
        "title": "Gold III",
        "minPower": 3500000000,
        "currencies": [
            {"name": "SAT", "totalPower": 13883172743977, "userCount": 1814, "payoutAmount": 293200.0, "duration": 611},
            {"name": "DOGE_SMALL", "totalPower": 18030082445509, "userCount": 2711, "payoutAmount": 293230.0, "duration": 608},
            {"name": "RLT", "totalPower": 16407492494518, "userCount": 3442, "payoutAmount": 4208400.0, "duration": 612},
            {"name": "NUEVA", "totalPower": 1, "userCount": 1, "payoutAmount": 1.0, "duration": 600},
        ],
    },
    {"level": 1, "title": "Bronze I", "minPower": 0, "currencies": []},
]


def test_divisores_y_orden():
    rows = normalize_leagues(_RAW)
    assert [r["title"] for r in rows] == ["Bronze I", "Gold III"]
    by = {c["code"]: c for c in rows[1]["currencies"]}
    assert set(by) == {"BTC", "DOGE", "RLT"}  # la moneda desconocida se ignora
    assert by["BTC"]["block_reward"] == pytest.approx(0.00002932)  # SAT: 1e10
    assert by["DOGE"]["block_reward"] == pytest.approx(29.323)
    assert by["RLT"]["block_reward"] == pytest.approx(4.2084)
    assert by["BTC"]["network_power"] == 13883172743977


def test_sin_monedas_es_error():
    with pytest.raises(ValueError):
        normalize_leagues([{"level": 1, "title": "Bronze I", "minPower": 0, "currencies": []}])


def _sin_red(monkeypatch, leagues):
    now = time.time()
    monkeypatch.setattr(mining, "_leagues", leagues)
    monkeypatch.setattr(mining, "_fetched_at", int(now))
    monkeypatch.setattr(mining, "_leagues_attempt", now)
    monkeypatch.setattr(mining, "_prices_attempt", now)
    monkeypatch.setattr(mining, "_prices", {"BTC": 80000.0})


def test_endpoint(monkeypatch):
    _sin_red(monkeypatch, normalize_leagues(_RAW))
    res = client.get("/api/mining")
    assert res.status_code == 200
    body = res.json()
    assert body["prices"] == {"BTC": 80000.0, **FIXED_PRICES}
    gold = body["leagues"][1]
    assert gold["min_power"] == "3500000000"
    assert gold["currencies"][0]["network_power"] == "13883172743977"


def test_sin_datos_503(monkeypatch):
    _sin_red(monkeypatch, None)
    assert client.get("/api/mining").status_code == 503
