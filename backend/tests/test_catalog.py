"""Tests puntuales de app/catalog.py."""

from __future__ import annotations

from app import catalog as cat
from app.catalog import _image_url


def test_image_url_strips_apostrophes():
    # el CDN usa el slug sin apóstrofo; la API a veces manda la comilla tipográfica
    assert _image_url("captain’s_fortune", 123) == (
        "https://cdn.rollercoincalculator.app/miners/captains_fortune.png?v=123"
    )
    assert _image_url("corsair's_oath", None) == (
        "https://cdn.rollercoincalculator.app/miners/corsairs_oath.png"
    )


def test_image_url_leaves_clean_names_alone():
    assert _image_url("devils_carnival", 9) == (
        "https://cdn.rollercoincalculator.app/miners/devils_carnival.png?v=9"
    )


def test_image_url_empty():
    assert _image_url("", 1) == ""
    assert _image_url(None, 1) == ""


# --- puesta al día incremental (ver DEPLOY.md: disco efímero en Render) ---


class _FakeClient:
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def _result(name: str, api_level: int) -> dict:
    return {
        "resultItemId": f"{name}-{api_level}",
        "resultItemName": name,
        "resultItemLevel": api_level,
        "resultItemPower": 100 * api_level,
        "resultItemPercent": 0,
        "resultItemWidth": 1,
        "resultItemFileName": name.lower(),
        "resultItemImageVersion": 1,
    }


def _base(name: str) -> dict:
    """Modelo de nivel 1 (base), como el que sale de `requiredItems`."""
    return {
        "id": f"{name}-base",
        "name": name,
        "api_level": 0,
        "level": 1,
        "power": 50,
        "bonus_bp": 0,
        "width": 1,
        "image": "",
    }


def _patch_api(monkeypatch, results: list[dict], escalados: list[str]):
    monkeypatch.setattr(cat.httpx, "Client", lambda *a, **k: _FakeClient())
    monkeypatch.setattr(cat, "_fetch_results", lambda client: results)

    def fake_ladder(client, name):
        escalados.append(name)
        return [
            {
                **_result(name, 1),
                "requiredItems": [
                    {"type": "miners", "itemId": f"{name}-base", "itemName": name,
                     "level": 0, "power": 50, "percent": 0, "width": 1, "fileName": ""},
                ],
            }
        ]

    monkeypatch.setattr(cat, "_fetch_ladder", fake_ladder)


def test_fetch_all_solo_escala_los_nombres_sin_base(monkeypatch):
    escalados: list[str] = []
    _patch_api(monkeypatch, [_result("Nuevo", 1)], escalados)
    out = cat._fetch_all(previous=[_base("Viejo"), cat._model_from_result(_result("Viejo", 1))])
    assert escalados == ["Nuevo"]
    assert {m["name"] for m in out} == {"Viejo", "Nuevo"}


def test_fetch_all_full_reescala_todo(monkeypatch):
    escalados: list[str] = []
    _patch_api(monkeypatch, [_result("Nuevo", 1)], escalados)
    cat._fetch_all(previous=[_base("Viejo"), cat._model_from_result(_result("Viejo", 1))], full=True)
    assert sorted(escalados) == ["Nuevo", "Viejo"]


def test_fetch_all_max_names_corta_el_paso_lento(monkeypatch):
    escalados: list[str] = []
    results = [_result(f"N{i}", 1) for i in range(3)]
    _patch_api(monkeypatch, results, escalados)
    out = cat._fetch_all(previous=[], max_names=2)
    assert escalados == []                      # no hizo la parte lenta
    assert cat.last_refresh_skipped == 3
    assert len(out) == 3                        # pero el listado masivo sí se guarda


def test_fetch_all_max_names_no_molesta_si_falta_poco(monkeypatch):
    escalados: list[str] = []
    _patch_api(monkeypatch, [_result("Nuevo", 1)], escalados)
    cat._fetch_all(previous=[], max_names=50)
    assert escalados == ["Nuevo"]
    assert cat.last_refresh_skipped == 0


def test_eta_seconds_crece_con_las_pausas_por_rafaga():
    assert cat._eta_seconds(0) == 0
    assert cat._eta_seconds(15) == 5
    assert cat._eta_seconds(120) > 120 / cat._MAX_RPS
