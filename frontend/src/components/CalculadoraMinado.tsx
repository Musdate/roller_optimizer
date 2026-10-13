import { useEffect, useMemo, useState } from "react";
import { errMsg, fetchMining, type MiningData } from "../api";
import { totalsFor } from "../calc";
import { FREON_EQ_KEY, MINING_KEY, computeMining, leagueFor } from "../mining";
import { formatPower, parsePower } from "../power";
import { useStore, selectRoomList } from "../store";
import "../minado.css";

const UNITS = ["GH", "TH", "PH", "EH", "ZH"] as const;
type Unit = (typeof UNITS)[number];

const REFRESH_MS = 5 * 60 * 1000;

// Iconos oficiales de RollerCoin copiados en public/coins: static.rollercoin.com
// lo bloquean los ad-blockers (ver RoomRacks.tsx).
const coinIcon = (code: string) => `/coins/${code.toLowerCase()}.svg`;

interface Saved {
  powerNum: string;
  powerUnit: Unit;
  /** "auto" o el `level` de la liga elegida a mano. */
  league: string;
  /** Moneda en que se muestran los montos de la tabla. */
  show: "usd" | "cripto";
  /** Fila marcada; la usa la Calculadora Freon (RULES.md §10.6). */
  coin: string | null;
}

const EMPTY: Saved = { powerNum: "", powerUnit: "PH", league: "auto", show: "usd", coin: null };

function load(): Saved {
  try {
    const raw = localStorage.getItem(MINING_KEY);
    if (!raw) return EMPTY;
    const { powerNum, powerUnit, league, show, coin } = {
      ...EMPTY,
      ...(JSON.parse(raw) as Partial<Saved>),
    };
    return {
      powerNum,
      powerUnit,
      league,
      show: show === "cripto" ? "cripto" : "usd",
      coin: typeof coin === "string" ? coin : null,
    };
  } catch {
    return EMPTY;
  }
}

function parseOrZero(num: string, unit: Unit): bigint {
  if (!num.trim()) return 0n;
  try {
    return parsePower(`${num}${unit}`);
  } catch {
    return 0n;
  }
}

function splitPower(v: bigint): { num: string; unit: Unit } {
  const [num, sym] = formatPower(v).split(" ");
  return { num: String(Number(num)), unit: sym.replace("/s", "") as Unit };
}

const COIN_FMT = new Intl.NumberFormat("es", { maximumSignificantDigits: 4 });
const BIG_FMT = new Intl.NumberFormat("es", { maximumFractionDigits: 2 });

function fmtCoin(x: number): string {
  if (x === 0) return "0";
  return x >= 1000 ? BIG_FMT.format(x) : COIN_FMT.format(x);
}
function fmtUsd(x: number | null): string {
  if (x === null) return "—";
  if (x !== 0 && Math.abs(x) < 0.01) return `$${COIN_FMT.format(x)}`;
  return `$${x.toLocaleString("es", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtAgo(ts: number | null, now: number): string {
  if (ts === null) return "nunca";
  const min = Math.floor((now / 1000 - ts) / 60);
  return min < 1 ? "hace menos de 1 min" : `hace ${min} min`;
}

export default function CalculadoraMinado() {
  const [state, setState] = useState<Saved>(load);
  const { powerNum, powerUnit, league, show, coin: selected } = state;
  const [data, setData] = useState<MiningData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const toggleCoin = (code: string) =>
    setState((s) => ({ ...s, coin: s.coin === code ? null : code }));

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetchMining()
        .then((d) => {
          if (!alive) return;
          setData(d);
          setError(null);
        })
        .catch((e) => alive && setError(errMsg(e)));
    load();
    const id = window.setInterval(load, REFRESH_MS);
    const tick = window.setInterval(() => setNow(Date.now()), 30000);
    return () => {
      alive = false;
      window.clearInterval(id);
      window.clearInterval(tick);
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(MINING_KEY, JSON.stringify(state));
    } catch {
      // localStorage no disponible: no se recuerdan los valores, nada más.
    }
  }, [state]);

  const roomList = useStore(selectRoomList);
  const roomFinal = useMemo(
    () => totalsFor(roomList.map((it) => ({ item: it, count: it.inRoom ?? 0 }))).finalPower,
    [roomList],
  );
  const [freonEq, setFreonEq] = useState<bigint>(0n);
  useEffect(() => {
    try {
      setFreonEq(BigInt(localStorage.getItem(FREON_EQ_KEY) ?? "0"));
    } catch {
      setFreonEq(0n);
    }
  }, []);

  const setPower = (v: bigint) => {
    const p = splitPower(v);
    setState((s) => ({ ...s, powerNum: p.num, powerUnit: p.unit }));
  };

  const power = parseOrZero(powerNum, powerUnit);
  const autoLeague = data ? leagueFor(data.leagues, power) : undefined;
  const chosen =
    league === "auto"
      ? autoLeague
      : data?.leagues.find((l) => String(l.level) === league) ?? autoLeague;

  const r = useMemo(
    () => (chosen && data ? computeMining(chosen, power, data.prices) : null),
    [chosen, data, power],
  );
  const best = r?.rows.find((row) => row.code === r.best);

  return (
    <div className="mn">
      <h1>Calculadora de minado</h1>

      <div className="panel mn-inputs">
        <div className="stat mn-field">
          <span className="k">Poder</span>
          <div className="row" style={{ flexWrap: "nowrap" }}>
            <input
              type="number"
              min={0}
              step="any"
              value={powerNum}
              onChange={(e) => setState((s) => ({ ...s, powerNum: e.target.value }))}
              style={{ flex: 1, minWidth: 0 }}
            />
            <select
              value={powerUnit}
              onChange={(e) => setState((s) => ({ ...s, powerUnit: e.target.value as Unit }))}
            >
              {UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}/s
                </option>
              ))}
            </select>
          </div>
          <div className="row mn-sources">
            <button
              className="tiny"
              onClick={() => setPower(roomFinal)}
              disabled={roomFinal === 0n}
              title={
                roomFinal === 0n
                  ? "No tienes mineros puestos en la sala"
                  : `Poder final de la sala: ${formatPower(roomFinal)}`
              }
            >
              poder de la sala
            </button>
            <button
              className="tiny"
              onClick={() => setPower(freonEq)}
              disabled={freonEq === 0n}
              title={
                freonEq === 0n
                  ? "Primero calcula el poder equivalente en la Calculadora Freon"
                  : `Poder equivalente de la Calculadora Freon: ${formatPower(freonEq)}`
              }
            >
              poder equivalente Freon
            </button>
          </div>
        </div>

        <label className="stat mn-field">
          <span className="k">Liga</span>
          <select
            value={league}
            onChange={(e) => setState((s) => ({ ...s, league: e.target.value }))}
            disabled={!data}
          >
            <option value="auto">Según el poder{autoLeague ? ` (${autoLeague.title})` : ""}</option>
            {data?.leagues.map((l) => (
              <option key={l.level} value={String(l.level)}>
                {l.title}
              </option>
            ))}
          </select>
        </label>

        <div className="stat mn-hero">
          <span className="k">Mejor moneda{best ? `: ${best.code}` : ""}</span>
          <span className="v">{best ? `${fmtUsd(best.usdDay)}/día` : "—"}</span>
          {best?.usdDay != null && (
            <span className="muted">
              {fmtUsd(best.usdDay * 7)}/semana · {fmtUsd(best.usdDay * 30)}/mes
            </span>
          )}
        </div>
      </div>

      {error && !data && <div className="warn-box">{error}</div>}
      {data?.stale && (
        <div className="warn-box">
          No se pudo actualizar la red de RollerCoin: se muestran los datos de{" "}
          {fmtAgo(data.fetched_at, now)}.
        </div>
      )}

      {chosen && r && (
        <div className="panel">
          <div className="row between" style={{ marginBottom: 8 }}>
            <h2 style={{ margin: 0 }}>{chosen.title}</h2>
            <div className="mn-mode" role="group" aria-label="Mostrar montos en">
              {(["usd", "cripto"] as const).map((m) => (
                <button
                  key={m}
                  className={show === m ? "active" : undefined}
                  aria-pressed={show === m}
                  onClick={() => setState((s) => ({ ...s, show: m }))}
                >
                  {m === "usd" ? "USD" : "Cripto"}
                </button>
              ))}
            </div>
          </div>

          <div className="mn-table-wrap">
            <table className="mn-table">
              <thead>
                <tr>
                  <th>Moneda</th>
                  <th className="num">Red</th>
                  <th className="num">Por día</th>
                  <th className="num">Por mes</th>
                </tr>
              </thead>
              <tbody>
                {r.rows.map((row) => (
                  <tr
                    key={row.code}
                    className={[
                      "mn-row",
                      row.code === r.best && "mn-best",
                      row.code === selected && "mn-selected",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    tabIndex={0}
                    aria-selected={row.code === selected}
                    onClick={() => toggleCoin(row.code)}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter" && e.key !== " ") return;
                      e.preventDefault();
                      toggleCoin(row.code);
                    }}
                  >
                    <td>
                      <div className="mn-coin">
                        <img
                          src={coinIcon(row.code)}
                          alt=""
                          width={22}
                          height={22}
                          onError={(e) => (e.currentTarget.style.visibility = "hidden")}
                        />
                        {row.code}
                      </div>
                    </td>
                    <td className="num">
                      <div>{formatPower(BigInt(Math.round(row.networkPower)))}</div>
                      <div className="muted mn-sub">{row.users.toLocaleString("es")} mineros</div>
                    </td>
                    {show === "usd" ? (
                      <>
                        <td className="num mn-usd">{fmtUsd(row.usdDay)}</td>
                        <td className="num">
                          {fmtUsd(row.usdDay === null ? null : row.usdDay * 30)}
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="num mn-usd">
                          {fmtCoin(row.perDay)}
                        </td>
                        <td className="num">
                          {fmtCoin(row.perDay * 30)}
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="muted mn-note">
            Red actualizada {fmtAgo(data?.fetched_at ?? null, now)}; precios de{" "}
            {data?.price_source === "binance"
              ? "Binance"
              : data?.price_source === "coingecko"
                ? "CoinGecko"
                : "ninguna fuente"}{" "}
            {fmtAgo(data?.prices_at ?? null, now)}. RLT se cuenta a 1 USD; RST y HMT no
            tienen precio. El poder de la red cambia bloque a bloque: es una estimación
            con la foto de ahora, suponiendo que tu poder todavía no está en esa red.
          </p>
        </div>
      )}
    </div>
  );
}
