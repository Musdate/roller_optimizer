"""Tests puntuales de app/catalog.py."""

from __future__ import annotations

from app import catalog as cat
from app.catalog import _image_url


def test_image_url_strips_apostrophes():
    # el CDN usa el slug sin apóstrofo; la API a veces manda la comilla tipográfica
    assert _image_url("captain’s_fortune", 123) == (
        "https://cdn.rollercoincalculator.app/miners/captains_fortune.png?v=123"
    )
    assert _image_url("devil's_ember", None) == (
        "https://cdn.rollercoincalculator.app/miners/devils_ember.png"
    )


def test_image_url_keeps_apostrophe_where_cdn_does():
    # excepción: en el CDN este archivo conserva la comilla tipográfica
    for raw in ("corsair’s_oath", "corsair's_oath", "corsairs_oath"):
        assert _image_url(raw, 7) == (
            "https://cdn.rollercoincalculator.app/miners/corsair%E2%80%99s_oath.png?v=7"
        )


def test_image_url_leaves_clean_names_alone():
    assert _image_url("devils_carnival", 9) == (
        "https://cdn.rollercoincalculator.app/miners/devils_carnival.png?v=9"
    )


def test_image_url_empty():
    assert _image_url("", 1) == ""
    assert _image_url(None, 1) == ""


def test_image_url_satoshis_chest_keeps_apostrophe():
    assert _image_url("satoshi’s_chest", 1) == (
        "https://cdn.rollercoincalculator.app/miners/satoshi%E2%80%99s_chest.png?v=1"
    )


# --- fetch desde /api/Miner (RULES.md §6) ---


def _api_miner(name: str, level: int, **kw) -> dict:
    return {
        "id": f"{name}-{level}",
        "name": name,
        "fileName": name.lower(),
        "imageVersion": 1,
        "level": level,
        "percent": 0,
        "power": 1000 * (level + 1),
        "width": 1,
        **kw,
    }


def test_model_from_miner_mapea_niveles_y_campos():
    m = cat._model_from_miner(_api_miner("Hamffindor", 0, percent=125, width=2))
    assert m == {
        "id": "Hamffindor-0",
        "name": "Hamffindor",
        "api_level": 0,
        "level": 1,
        "power": 1000,
        "bonus_bp": 125,
        "width": 2,
        "image": "https://cdn.rollercoincalculator.app/miners/hamffindor.png?v=1",
    }


def test_canonical_names_unifica_comillas_con_el_nivel_mas_alto():
    rows = [
        cat._model_from_miner(_api_miner("King's Legacy", 0)),
        cat._model_from_miner(_api_miner("King’s Legacy", 1)),
        cat._model_from_miner(_api_miner("King’s Legacy", 5)),
    ]
    assert {m["name"] for m in cat._canonical_names(rows)} == {"King’s Legacy"}


class _Resp:
    def __init__(self, body: dict) -> None:
        self._body = body

    def json(self) -> dict:
        return self._body


def _patch_pages(monkeypatch, pages: list[list[dict] | None]):
    """`None` en una página = el pedido falló (agotó reintentos)."""
    class _FakeClient:
        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

    def fake_get(client, path, params):
        assert path == "/Miner"
        i = params["PageRequest.PageIndex"]
        if pages[i] is None:
            return None
        return _Resp({
            "items": pages[i],
            "count": sum(len(p or []) for p in pages),
            "hasNext": i < len(pages) - 1,
        })

    monkeypatch.setattr(cat, "_new_client", lambda: _FakeClient())
    monkeypatch.setattr(cat, "_get", fake_get)


def test_fetch_all_pagina_y_mezcla_con_lo_previo(monkeypatch):
    _patch_pages(monkeypatch, [[_api_miner("A", 0), _api_miner("A", 1)], [_api_miner("Slyhamrin", 0)]])
    viejo = cat._model_from_miner(_api_miner("Viejo", 0))
    progreso: list[int] = []
    total: list[int] = []
    out = cat._fetch_all(
        previous=[viejo],
        on_total=total.append,
        on_progress=lambda done, batch: progreso.append(done),
    )
    assert {m["id"] for m in out} == {"A-0", "A-1", "Slyhamrin-0", "Viejo-0"}
    assert total == [3]
    assert progreso == [2, 3]
    assert not cat.last_refresh_incomplete


def test_fetch_all_pagina_fallida_no_borra_nada(monkeypatch):
    _patch_pages(monkeypatch, [[_api_miner("A", 0)], None])
    viejo = cat._model_from_miner(_api_miner("Viejo", 0))
    out = cat._fetch_all(previous=[viejo])
    assert {m["id"] for m in out} == {"A-0", "Viejo-0"}
    assert cat.last_refresh_incomplete


def test_eta_seconds_crece_con_las_pausas_por_rafaga():
    assert cat._eta_seconds(0) == 0
    assert cat._eta_seconds(15) == 5
    assert cat._eta_seconds(120) > 120 / cat._MAX_RPS
