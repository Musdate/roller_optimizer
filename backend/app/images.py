"""Proxy de imágenes externas (RULES.md §8.2): el navegador solo ve
`/api/img/<clave>`, nunca el dominio de origen."""

from __future__ import annotations

import hashlib
import re
import threading
import time
from pathlib import Path
from typing import Callable, Iterable
from urllib.parse import urlparse

import httpx

_CACHE_DIR = Path(__file__).resolve().parent.parent / ".cache" / "img"
PREFIX = "/api/img/"
_TYPES = {
    ".png": "image/png",
    ".webp": "image/webp",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
}
KEY_RE = re.compile(r"^[0-9a-f]{24}\.(png|webp|jpg|jpeg|gif|svg)$")
# Una clave desconocida obliga a recorrer el catálogo entero: con esto, una
# ráfaga de claves inventadas no lo recorre más de una vez por minuto.
_REBUILD_EVERY_S = 60.0


def _key(url: str) -> str:
    ext = Path(urlparse(url).path).suffix.lower()
    if ext not in _TYPES:
        ext = ".png"
    return hashlib.sha256(url.encode("utf-8")).hexdigest()[:24] + ext


class ImageProxy:
    def __init__(self) -> None:
        self._urls: dict[str, str] = {}
        self._lock = threading.Lock()
        self._sources: list[Callable[[], Iterable[str]]] = []
        self._rebuilt_at = 0.0

    def add_source(self, fn: Callable[[], Iterable[str]]) -> None:
        """URLs que el proxy reconoce aunque nadie las haya pedido desde que
        arrancó el proceso (clientes con el inventario guardado)."""
        self._sources.append(fn)

    def public(self, url: str) -> str:
        if not url or url.startswith(PREFIX):
            return url
        key = _key(url)
        with self._lock:
            self._urls[key] = url
        return PREFIX + key

    def _lookup(self, key: str) -> str | None:
        with self._lock:
            url = self._urls.get(key)
            if url or time.monotonic() - self._rebuilt_at < _REBUILD_EVERY_S:
                return url
            self._rebuilt_at = time.monotonic()
        for src in self._sources:
            for u in src():
                self.public(u)
        with self._lock:
            return self._urls.get(key)

    def get(self, key: str) -> tuple[bytes, str] | None:
        media = _TYPES[Path(key).suffix]
        path = _CACHE_DIR / key
        if path.is_file():
            return path.read_bytes(), media
        url = self._lookup(key)
        if not url:
            return None
        try:
            res = httpx.get(
                url, timeout=20, follow_redirects=True, headers={"User-Agent": "optimizador-roller/0.1"}
            )
        except httpx.HTTPError:
            return None
        if res.status_code != 200:
            return None
        try:
            _CACHE_DIR.mkdir(parents=True, exist_ok=True)
            tmp = path.with_name(f"{key}.{threading.get_ident()}.tmp")
            tmp.write_bytes(res.content)
            tmp.replace(path)
        except OSError:
            pass  # sin caché en disco igual se sirve
        return res.content, media


images = ImageProxy()
