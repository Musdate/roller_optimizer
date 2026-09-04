"""Tests puntuales de app/catalog.py."""

from __future__ import annotations

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
