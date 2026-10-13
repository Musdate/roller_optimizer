"""Red por liga y precios para la calculadora de minado (RULES.md §12).

Sin seed: el poder de red cambia bloque a bloque y un snapshot viejo daría
números engañosos. Se guarda en memoria 5 minutos; si la API falla se sigue con
lo último que había (marcado `stale`).
"""

from __future__ import annotations

import threading
import time
from urllib.parse import quote

import httpx

_LEAGUES_URL = "https://api.rollercoincalculator.app/api/League"
_BINANCE_URL = "https://data-api.binance.vision/api/v3/ticker/price"
_COINGECKO_URL = "https://api.coingecko.com/api/v3/simple/price"
_TTL_S = 5 * 60
_HEADERS = {"User-Agent": "optimizador-roller/0.1"}

# clave del juego → (moneda, divisor del payout). RULES.md §12.1.
COINS: dict[str, tuple[str, int]] = {
    "RLT": ("RLT", 10**6),
    "RST": ("RST", 10**6),
    "HMT": ("HMT", 10**6),
    "SAT": ("BTC", 10**10),
    "LTC_SMALL": ("LTC", 10**8),
    "BNB_SMALL": ("BNB", 10**10),
    "ETH_SMALL": ("ETH", 10**10),
    "TRX_SMALL": ("TRX", 10**10),
    "MATIC_SMALL": ("POL", 10**10),
    "SOL_SMALL": ("SOL", 10**9),
    "XRP_SMALL": ("XRP", 10**6),
    "ALGO_SMALL": ("ALGO", 10**6),
    "USDT_SMALL": ("USDT", 10**6),
    "DOGE_SMALL": ("DOGE", 10**4),
}

FIXED_PRICES = {"RLT": 1.0, "USDT": 1.0}

_COINGECKO_IDS = {
    "BTC": "bitcoin",
    "ETH": "ethereum",
    "BNB": "binancecoin",
    "POL": "polygon-ecosystem-token",
    "XRP": "ripple",
    "DOGE": "dogecoin",
    "TRX": "tron",
    "SOL": "solana",
    "LTC": "litecoin",
    "ALGO": "algorand",
}


def normalize_leagues(rows: list[dict]) -> list[dict]:
    out = []
    for r in rows:
        currencies = []
        for c in r.get("currencies") or []:
            coin = COINS.get(str(c.get("name")))
            if coin is None:
                continue
            code, divisor = coin
            currencies.append(
                {
                    "code": code,
                    "network_power": int(c["totalPower"]),
                    "block_reward": float(c["payoutAmount"]) / divisor,
                    "block_seconds": int(c["duration"]),
                    "users": int(c.get("userCount") or 0),
                }
            )
        out.append(
            {
                "level": int(r["level"]),
                "title": str(r["title"]),
                "min_power": int(r["minPower"]),
                "currencies": currencies,
            }
        )
    out.sort(key=lambda r: r["min_power"])
    if not out or not any(r["currencies"] for r in out):
        raise ValueError("ligas sin monedas")
    return out


def _fetch_binance(c: httpx.Client) -> dict[str, float]:
    symbols = [f"{code}USDT" for code in _COINGECKO_IDS]
    q = quote("[" + ",".join(f'"{s}"' for s in symbols) + "]")
    res = c.get(f"{_BINANCE_URL}?symbols={q}")
    res.raise_for_status()
    return {row["symbol"][: -len("USDT")]: float(row["price"]) for row in res.json()}


def _fetch_coingecko(c: httpx.Client) -> dict[str, float]:
    ids = ",".join(_COINGECKO_IDS.values())
    res = c.get(_COINGECKO_URL, params={"ids": ids, "vs_currencies": "usd"})
    res.raise_for_status()
    data = res.json()
    return {
        code: float(data[cg]["usd"])
        for code, cg in _COINGECKO_IDS.items()
        if cg in data and "usd" in data[cg]
    }


class MiningUnavailable(Exception):
    pass


class _Mining:
    def __init__(self) -> None:
        self._leagues: list[dict] | None = None
        self._fetched_at: int | None = None
        self._stale = False
        self._leagues_attempt = 0.0
        self._prices: dict[str, float] = {}
        self._prices_at: int | None = None
        self._price_source: str | None = None
        self._prices_attempt = 0.0
        self._lock = threading.Lock()

    def snapshot(self) -> dict:
        with self._lock:
            now = time.time()
            if now - self._leagues_attempt >= _TTL_S:
                self._leagues_attempt = now
                self._refresh_leagues()
            if now - self._prices_attempt >= _TTL_S:
                self._prices_attempt = now
                self._refresh_prices()
            if self._leagues is None:
                # sin datos: el próximo pedido vuelve a intentar enseguida
                self._leagues_attempt = 0.0
                raise MiningUnavailable("No se pudieron obtener los datos de la red de RollerCoin. Inténtalo en unos minutos.")
            return {
                "fetched_at": self._fetched_at,
                "stale": self._stale,
                "prices_at": self._prices_at,
                "price_source": self._price_source,
                "prices": {**self._prices, **FIXED_PRICES},
                "leagues": self._leagues,
            }

    def _refresh_leagues(self) -> None:
        try:
            with httpx.Client(timeout=15, headers=_HEADERS) as c:
                res = c.get(_LEAGUES_URL)
                res.raise_for_status()
                self._leagues = normalize_leagues(res.json())
                self._fetched_at = int(time.time())
                self._stale = False
        except (httpx.HTTPError, ValueError, KeyError, TypeError):
            self._stale = True  # se sigue con lo último que había

    def _refresh_prices(self) -> None:
        with httpx.Client(timeout=10, headers=_HEADERS) as c:
            for source, fetch in (("binance", _fetch_binance), ("coingecko", _fetch_coingecko)):
                try:
                    prices = fetch(c)
                except (httpx.HTTPError, ValueError, KeyError, TypeError):
                    continue
                if prices:
                    self._prices = prices
                    self._prices_at = int(time.time())
                    self._price_source = source
                    return


mining = _Mining()
