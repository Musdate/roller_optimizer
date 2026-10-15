import { useEffect, useMemo, useState } from "react";
import { totalsFor } from "../calc";
import { formatPower, groupDigits, parsePower, bpToPct } from "../power";
import { useStore, selectRoomList } from "../store";
import {
  DEFAULT_LEVELS,
  LEVEL_LABELS,
  MODULES,
  computeFreon,
  type Levels,
  type Lvl,
  type ModKey,
} from "../freon";
import { fetchMining, type MiningData } from "../api";
import { FREON_EQ_KEY, leagueFor, perDayFor, readMiningPrefs } from "../mining";
import "../freon.css";

const UNITS = ["GH", "TH", "PH", "EH", "ZH"] as const;
type Unit = (typeof UNITS)[number];

const STORE_KEY = "roller-freon";

const BRANCHES = [
  { branch: "ham" as const, title: "Hámsters" },
  { branch: "freon" as const, title: "Freon" },
];

interface Saved {
  powerNum: string;
  powerUnit: Unit;
  finalNum: string;
  finalUnit: Unit;
  freon: string;
  /** La máquina ya tiene freon: `freon` pasa a ser la recarga (RULES.md §10.3). */
  hasFreon: boolean;
  /** Freon que muestra el juego antes de recargar. */
  freonNow: string;
  /** Tiempo hasta la próxima merma (el contador no se reinicia al recargar). */
  leakH: string;
  leakM: string;
  /** Fin del evento de freon, valor de un input datetime-local (hora local). */
  deadline: string;
  /** Vida, fuerza y suerte de cada hámster; para el cálculo solo importa la suma. */
  hams: HamStats[];
  /** % de uso real de los slots de hámsters (descuenta huecos de la rotación). */
  usage: string;
  levels: Levels;
}

type HamStats = [string, string, string];

const HAM_PARAMS = ["Vida", "Fuerza", "Suerte"] as const;
const EMPTY_HAM: HamStats = ["", "", ""];

const hamSum = (h: HamStats) => h.reduce((acc, x) => acc + (Number(x) || 0), 0);

const EMPTY: Saved = {
  powerNum: "",
  powerUnit: "PH",
  finalNum: "",
  finalUnit: "PH",
  freon: "",
  hasFreon: false,
  freonNow: "",
  leakH: "",
  leakM: "",
  deadline: "",
  hams: [EMPTY_HAM],
  usage: "100",
  levels: DEFAULT_LEVELS,
};

function load(): Saved {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return EMPTY;
    const p = JSON.parse(raw) as Partial<Saved> & { stats?: string[] };
    // Antes había un solo stat por hámster (ya sumado): se conserva en "vida".
    const hams = p.hams ?? (p.stats ?? []).map((x): HamStats => [x, "", ""]);
    const filled = hams.filter((h) => h.some((x) => x.trim() !== ""));
    const { stats: _old, ...rest } = p;
    return {
      ...EMPTY,
      ...rest,
      hams: filled.length ? filled : [EMPTY_HAM],
      levels: { ...DEFAULT_LEVELS, ...(p.levels ?? {}) },
    };
  } catch {
    return EMPTY;
  }
}

/** BigInt en GH/s -> par (número, unidad) para los inputs. 6 decimales para
 *  que importar de la sala no pierda precisión visible. */
function splitPower(v: bigint): { num: string; unit: Unit } {
  const [num, sym] = formatPower(v, 6).split(" ");
  return { num: String(Number(num)), unit: sym.replace("/s", "") as Unit };
}

function formatHours(h: number): string {
  const d = Math.floor(h / 24);
  const rest = Math.floor(h % 24);
  return d > 0 ? `${d} d ${rest} h` : `${rest} h`;
}

const COIN_FMT = new Intl.NumberFormat("es", { maximumSignificantDigits: 4 });

function fmtUsd(x: number): string {
  if (x !== 0 && Math.abs(x) < 0.01) return `$${COIN_FMT.format(x)}`;
  return `$${x.toLocaleString("es", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

type Earn =
  | { msg: string }
  | {
      coin: string;
      extra: number;
      usd: number | null;
      league: string;
      dayEff: number;
      dayNow: number;
      days: number;
    };

function parseOrZero(num: string, unit: Unit): bigint {
  if (!num.trim()) return 0n;
  try {
    const v = parsePower(`${num} ${unit}`);
    return v > 0n ? v : 0n;
  } catch {
    return 0n;
  }
}

export default function CalculadoraFreon() {
  const [state, setState] = useState<Saved>(load);
  const {
    powerNum,
    powerUnit,
    finalNum,
    finalUnit,
    freon,
    hasFreon,
    freonNow,
    leakH,
    leakM,
    deadline,
    hams,
    usage,
    levels,
  } = state;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60000);
    return () => window.clearInterval(id);
  }, []);

  const [mining, setMining] = useState<MiningData | null>(null);
  const [miningPrefs] = useState(readMiningPrefs);
  useEffect(() => {
    if (!miningPrefs.coin) return;
    let alive = true;
    fetchMining()
      .then((d) => alive && setMining(d))
      .catch(() => {
        // sin datos de red: la tarjeta de ganancia queda sin calcular
      });
    return () => {
      alive = false;
    };
  }, [miningPrefs.coin]);

  const roomList = useStore(selectRoomList);
  const roomTotals = useMemo(
    () => totalsFor(roomList.map((it) => ({ item: it, count: it.inRoom ?? 0 }))),
    [roomList],
  );

  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch {
      // localStorage no disponible: no se recuerdan los valores, nada más.
    }
  }, [state]);

  const setLevel = (key: ModKey, lvl: Lvl) =>
    setState((s) => ({ ...s, levels: { ...s.levels, [key]: lvl } }));
  const setHamParam = (i: number, k: number, v: string) =>
    setState((s) => ({
      ...s,
      hams: s.hams.map((h, j) =>
        j === i ? (h.map((x, n) => (n === k ? v : x)) as HamStats) : h,
      ),
    }));
  const addHam = () => setState((s) => ({ ...s, hams: [...s.hams, EMPTY_HAM] }));
  const removeHam = (i: number) =>
    setState((s) => ({
      ...s,
      hams: s.hams.length > 1 ? s.hams.filter((_, j) => j !== i) : [EMPTY_HAM],
    }));

  function importRoom() {
    const p = splitPower(roomTotals.rawPower);
    const f = splitPower(roomTotals.finalPower);
    setState((s) => ({
      ...s,
      powerNum: p.num,
      powerUnit: p.unit,
      finalNum: f.num,
      finalUnit: f.unit,
    }));
  }

  const raw = useMemo(() => parseOrZero(powerNum, powerUnit), [powerNum, powerUnit]);
  const typedFinal = useMemo(
    () => parseOrZero(finalNum, finalUnit),
    [finalNum, finalUnit],
  );
  // Sin poder final se asume que no hay bonus de sala: el final es el bruto.
  const roomFinal = typedFinal >= raw ? typedFinal : raw;

  const deadlineMs = deadline ? new Date(deadline).getTime() : NaN;
  const hoursLeft = Number.isFinite(deadlineMs) ? (deadlineMs - now) / 3600000 : null;
  const deadlinePassed = hoursLeft !== null && hoursLeft <= 0;

  const current = hasFreon ? Number(freonNow) || 0 : 0;
  const nextLeakH =
    hasFreon && (leakH.trim() || leakM.trim())
      ? (Number(leakH) || 0) + (Number(leakM) || 0) / 60
      : null;
  const usagePct = usage.trim() === "" ? 100 : Number(usage) || 0;
  const r = useMemo(
    () =>
      computeFreon(
        levels,
        hams.map(hamSum),
        Number(freon) || 0,
        hoursLeft,
        usagePct,
        current,
        nextLeakH,
      ),
    [levels, hams, freon, hoursLeft, usagePct, current, nextLeakH],
  );
  // RULES.md §10.6: con freon en la máquina se mide lo que suma la recarga.
  const base = useMemo(
    () =>
      hasFreon
        ? computeFreon(levels, hams.map(hamSum), 0, hoursLeft, usagePct, current, nextLeakH)
        : null,
    [hasFreon, levels, hams, hoursLeft, usagePct, current, nextLeakH],
  );

  // El bonus del juego es aditivo (§3), así que el freon se suma sobre el
  // poder bruto y el bonus de sala ya viene metido en `roomFinal`.
  const addOn = (bp: number) => (raw * BigInt(bp)) / 10000n;
  const peak = roomFinal + addOn(r.peakBonusBp);
  const effective = roomFinal + addOn(r.effBonusBp);
  const baseline = base ? roomFinal + addOn(base.effBonusBp) : roomFinal;
  const gain = effective - roomFinal;
  const hasRecharge = hasFreon && (Number(freon) || 0) > 0;
  const effText = formatPower(effective);

  // RULES.md §10.6: lo que se mina de más hasta el fin del evento frente a `basePower`.
  const earnFor = (basePower: bigint): Earn => {
    const coin = miningPrefs.coin;
    if (!coin) return { msg: "Selecciona una moneda en la Calculadora de minado" };
    if (r.hoursLeft === null) return { msg: "Pon la fecha de fin del evento" };
    if (!mining) return { msg: "Cargando la red…" };
    const league =
      (miningPrefs.league !== "auto" &&
        mining.leagues.find((l) => String(l.level) === miningPrefs.league)) ||
      leagueFor(mining.leagues, roomFinal);
    const cur = league?.currencies.find((c) => c.code === coin);
    if (!league || !cur) return { msg: `${coin} no se mina en ${league?.title ?? "esa liga"}` };
    const dayEff = perDayFor(cur, Number(effective));
    const dayNow = perDayFor(cur, Number(basePower));
    const days = r.hoursLeft / 24;
    const extra = (dayEff - dayNow) * days;
    const price = mining.prices[coin];
    return {
      coin,
      extra,
      usd: price === undefined ? null : extra * price,
      league: league.title,
      dayEff,
      dayNow,
      days,
    };
  };
  const earn = earnFor(roomFinal);
  const earnRe = hasRecharge ? earnFor(baseline) : null;

  useEffect(() => {
    try {
      localStorage.setItem(FREON_EQ_KEY, effective.toString());
    } catch {
      // localStorage no disponible: la calculadora de minado no lo ofrece, nada más.
    }
  }, [effective]);


  return (
    <div className="frn">
      <h1>Calculadora Freon</h1>

      <div className="frn-top">
        <div className="frn-scene" aria-hidden="true">
          <img className="frn-machine" src="/freon/machine.png" alt="" />
          <div className="frn-badge">
            <b>{r.tier.label}</b>
            <span>límite {groupDigits(String(r.freonLimit))} Freon</span>
          </div>
        </div>

        <div className="panel">
          <div className="row between" style={{ marginBottom: 10 }}>
            <h2 style={{ margin: 0 }}>Tu sala</h2>
            <button
              className="tiny"
              onClick={importRoom}
              disabled={roomList.length === 0}
              title={
                roomList.length === 0
                  ? "No tienes mineros puestos en la sala"
                  : "Copia el poder bruto y final de la sala"
              }
            >
              importar de sala
            </button>
          </div>

          <div className="frn-fields">
            <div className="frn-powers">
              <label className="stat frn-field">
                <span className="k">Poder bruto de mineros</span>
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
                    onChange={(e) =>
                      setState((s) => ({ ...s, powerUnit: e.target.value as Unit }))
                    }
                  >
                    {UNITS.map((u) => (
                      <option key={u} value={u}>
                        {u}/s
                      </option>
                    ))}
                  </select>
                </div>
              </label>

              <label className="stat frn-field">
                <span className="k">Poder final total</span>
                <div className="row" style={{ flexWrap: "nowrap" }}>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={finalNum}
                    onChange={(e) => setState((s) => ({ ...s, finalNum: e.target.value }))}
                    style={{ flex: 1, minWidth: 0 }}
                  />
                  <select
                    value={finalUnit}
                    onChange={(e) =>
                      setState((s) => ({ ...s, finalUnit: e.target.value as Unit }))
                    }
                  >
                    {UNITS.map((u) => (
                      <option key={u} value={u}>
                        {u}/s
                      </option>
                    ))}
                  </select>
                </div>
              </label>
            </div>

            <label className="row frn-check">
              <input
                type="checkbox"
                checked={hasFreon}
                onChange={(e) => setState((s) => ({ ...s, hasFreon: e.target.checked }))}
              />
              La máquina ya tiene freon
            </label>

            {hasFreon && (
              <div className="frn-powers">
                <label className="stat frn-field">
                  <span className="k">Freon actual</span>
                  <input
                    type="number"
                    min={0}
                    step={100}
                    value={freonNow}
                    onChange={(e) => setState((s) => ({ ...s, freonNow: e.target.value }))}
                  />
                </label>
                <div className="stat frn-field">
                  <span className="k">Próxima merma en</span>
                  <div className="row frn-hm" style={{ flexWrap: "nowrap" }}>
                    <input
                      type="number"
                      min={0}
                      max={r.leakTimeH}
                      step={1}
                      placeholder={String(r.leakTimeH)}
                      aria-label="Horas hasta la próxima merma"
                      value={leakH}
                      onChange={(e) => setState((s) => ({ ...s, leakH: e.target.value }))}
                    />
                    <span className="muted">h</span>
                    <input
                      type="number"
                      min={0}
                      max={59}
                      step={1}
                      placeholder="0"
                      aria-label="Minutos hasta la próxima merma"
                      value={leakM}
                      onChange={(e) => setState((s) => ({ ...s, leakM: e.target.value }))}
                    />
                    <span className="muted">min</span>
                  </div>
                </div>
              </div>
            )}

            <label className="stat frn-field">
              <span className="k">{hasFreon ? "Recarga" : "Freon cargado"}</span>
              <input
                type="number"
                min={0}
                step={100}
                value={freon}
                onChange={(e) => setState((s) => ({ ...s, freon: e.target.value }))}
              />
            </label>

            <label className="stat frn-field">
              <span className="k">
                Fin del evento
                {r.hoursLeft !== null && <> (quedan {formatHours(r.hoursLeft)})</>}
              </span>
              <input
                type="datetime-local"
                value={deadline}
                onChange={(e) => setState((s) => ({ ...s, deadline: e.target.value }))}
              />
            </label>

            <section className="frn-ham-section" aria-label="Hámsters">
              <div className="frn-ham-title">
                <span>Hámsters</span>
                <span className="muted">
                  {r.hamCount} {r.hamCount === 1 ? "hámster" : "hámsters"} · {r.slots} slots
                </span>
              </div>
              <div className="frn-hams">
                <div className="frn-ham-head" aria-hidden>
                  <span>#</span>
                  {HAM_PARAMS.map((label) => (
                    <span key={label}>{label}</span>
                  ))}
                  <span>Total</span>
                  <span />
                </div>
                {hams.map((h, i) => (
                  <div className="frn-ham" key={i}>
                    <span className="frn-ham-n">{i + 1}</span>
                    {HAM_PARAMS.map((label, k) => (
                      <input
                        key={label}
                        type="number"
                        min={0}
                        step={1}
                        placeholder={label}
                        aria-label={`${label} del hámster ${i + 1}`}
                        value={h[k]}
                        onChange={(e) => setHamParam(i, k, e.target.value)}
                      />
                    ))}
                    <span className="frn-ham-sum" title="Suma de los tres">
                      {hamSum(h) || "—"}
                    </span>
                    <button
                      className="tiny"
                      onClick={() => removeHam(i)}
                      title="Quitar hámster"
                      aria-label={`Quitar hámster ${i + 1}`}
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button className="tiny" onClick={addHam}>
                  + hámster
                </button>
              </div>
              {r.slots > 0 && (
                <span className="muted frn-hams-need">
                  Para tener los {r.slots} slots siempre ocupados necesitas {r.hamsNeeded}{" "}
                  hámsters (tienes {r.hamCount}).
                </span>
              )}

              <label className="stat frn-field">
                <span className="k">
                  Uso real de los slots (%){" "}
                  <span className="frn-info" tabIndex={0} aria-label="Qué es">
                    i
                    <span className="frn-info-tip" role="tooltip">
                      Qué parte del tiempo tus slots de hámsters están ocupados de verdad.
                      La rotación ideal supone que, apenas un hámster termina su turno, entra
                      otro; en la práctica quedan huecos (expediciones, turnos que no
                      arrancas a tiempo). Este % descuenta esos huecos solo del aporte de los
                      hámsters: con 80%, su bonus promedio queda en el 80%. El freon no se ve
                      afectado. Por defecto, 100%.
                    </span>
                  </span>
                </span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={5}
                  value={usage}
                  onChange={(e) => setState((s) => ({ ...s, usage: e.target.value }))}
                />
              </label>
            </section>
          </div>

          <div className="frn-result">
            <div className="frn-heroes">
              <div className="frn-hero">
                <span className="k">
                  Ganancia total del freon{" "}
                  <span className="frn-info" tabIndex={0} aria-label="Cómo se calcula">
                    i
                    <span className="frn-info-tip" role="tooltip">
                      Lo que minas de más con la máquina activa hasta el fin del evento, en
                      la moneda marcada en la Calculadora de minado. Se usa el poder
                      equivalente ({effText}): el poder fijo que mina lo mismo que tu ciclo
                      real.{" "}
                      {r.slots === 0 ? (
                        <>Hámsters: sin slots (sube Ham Platforms), no aportan.</>
                      ) : (
                        <>
                          {r.hamRotating ? (
                            <>
                              Hámsters: rotación ideal de {r.hamCount} en {r.slots} slots, los
                              de más stat primero, cada uno como mucho{" "}
                              {(r.hamActiveRatio * 100).toFixed(0)}% del tiempo ({r.dutyTimeH} h
                              + 24 h de descanso)
                            </>
                          ) : (
                            <>
                              Hámsters {bpToPct(r.hamBonusBp)} durante {r.dutyTimeH} h + 24 h de
                              descanso = {(r.hamActiveRatio * 100).toFixed(0)}%{" "}
                              {r.hoursLeft !== null
                                ? "del tiempo que queda del evento"
                                : "del ciclo"}
                            </>
                          )}
                          , con uso real {r.usagePct}% → {bpToPct(r.hamBonusEffBp)}.
                        </>
                      )}{" "}
                      {r.hoursLeft !== null ? (
                        <>
                          Freon {bpToPct(r.freonBonusBp)}{" "}
                          {hasFreon ? "tras recargar" : "al cargar"}, que con la merma
                          (−{r.leakPct}% cada {r.leakTimeH} h) promedia{" "}
                          {bpToPct(r.freonAvgBonusBp)} hasta el fin del evento.
                        </>
                      ) : (
                        <>Freon {bpToPct(r.freonBonusBp)} continuo, sin merma (no hay fecha de fin).</>
                      )}{" "}
                      {"coin" in earn ? (
                        <>
                          En {earn.league}, con ese poder minas{" "}
                          {COIN_FMT.format(earn.dayEff)} {earn.coin}/día; con tu poder final
                          actual ({formatPower(roomFinal)}), {COIN_FMT.format(earn.dayNow)}{" "}
                          {earn.coin}/día. La diferencia por los{" "}
                          {earn.days.toLocaleString("es", { maximumFractionDigits: 1 })} días que
                          quedan del evento da {COIN_FMT.format(earn.extra)} {earn.coin}.
                        </>
                      ) : (
                        <>
                          Se calcula con la red de esa moneda: lo que minas por día con el poder
                          equivalente menos lo que minas con tu poder final actual, por los días
                          que quedan del evento.
                        </>
                      )}{" "}
                      La liga es la elegida en la Calculadora de minado (o la de tu poder
                      final), y la red es una foto de ahora.
                    </span>
                  </span>
                </span>
                {"msg" in earn ? (
                  <span className="muted frn-earn-msg">{earn.msg}</span>
                ) : (
                  <>
                    <span className="v">
                      +{COIN_FMT.format(earn.extra)} {earn.coin}
                    </span>
                    {earn.usd !== null && <span className="muted">≈ {fmtUsd(earn.usd)}</span>}
                  </>
                )}
              </div>
              {earnRe && (
                <div className="frn-hero">
                  <span className="k">
                    Ganancia de la recarga{" "}
                    <span className="frn-info" tabIndex={0} aria-label="Cómo se calcula">
                      i
                      <span className="frn-info-tip" role="tooltip">
                        Lo que suma la recarga sola, comparado con dejar el freon que ya tienes
                        ({groupDigits(String(Math.floor(current)))}) hasta el fin del evento.
                        Hámsters iguales en los dos casos.{" "}
                        {"coin" in earnRe ? (
                          <>
                            Con la recarga, poder equivalente {effText}:{" "}
                            {COIN_FMT.format(earnRe.dayEff)} {earnRe.coin}/día; sin recargar,{" "}
                            {formatPower(baseline)}: {COIN_FMT.format(earnRe.dayNow)}{" "}
                            {earnRe.coin}/día. La diferencia por los{" "}
                            {earnRe.days.toLocaleString("es", { maximumFractionDigits: 1 })}{" "}
                            días que quedan da {COIN_FMT.format(earnRe.extra)} {earnRe.coin}.
                          </>
                        ) : (
                          <>
                            Se calcula igual que la ganancia total, pero contra el poder
                            equivalente sin recargar.
                          </>
                        )}
                      </span>
                    </span>
                  </span>
                  {"msg" in earnRe ? (
                    <span className="muted frn-earn-msg">{earnRe.msg}</span>
                  ) : (
                    <>
                      <span className="v">
                        +{COIN_FMT.format(earnRe.extra)} {earnRe.coin}
                      </span>
                      {earnRe.usd !== null && (
                        <span className="muted">≈ {fmtUsd(earnRe.usd)}</span>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
            <div className="stat-row">
              <div className="stat">
                <span className="k">Ganancia real</span>
                <span className="v frn-gain">+{formatPower(gain)}</span>
              </div>
              <div className="stat">
                <span className="k">Pico (turno activo)</span>
                <span className="v">{formatPower(peak)}</span>
              </div>
              <div className="stat">
                <span className="k">Bonus efectivo</span>
                <span className="v">{bpToPct(r.effBonusBp)}</span>
              </div>
            </div>
          </div>

          {deadlinePassed && (
            <div className="warn-box" style={{ marginTop: 10 }}>
              La fecha de fin del evento ya pasó: se calcula sin merma y con el
              ciclo completo de los hámsters.
            </div>
          )}

          {r.freonCapped && (
            <div className="warn-box" style={{ marginTop: 10 }}>
              La máquina solo almacena {groupDigits(String(r.freonLimit))} Freon: lo que
              cargues de más se pierde.
            </div>
          )}
        </div>
      </div>

      <div className="panel">
        <h2>Módulos</h2>
        <div className="frn-modules">
          {BRANCHES.map((b) => (
            <section className="frn-branch" key={b.branch}>
              <h3>{b.title}</h3>
              {MODULES.filter((m) => m.branch === b.branch).map((m) => (
                <div className="frn-mod" key={m.key}>
                  <div className="frn-mod-name">
                    <b>{m.name}</b>
                    <span>{m.desc}</span>
                  </div>
                  <select
                    value={levels[m.key]}
                    onChange={(e) => setLevel(m.key, Number(e.target.value) as Lvl)}
                  >
                    {LEVEL_LABELS.map((lab, i) => (
                      <option key={lab} value={i}>
                        {lab}
                      </option>
                    ))}
                  </select>
                  <span className="frn-mod-val">{m.values[levels[m.key]]}</span>
                </div>
              ))}
            </section>
          ))}
        </div>

        <div className="frn-foot">
          <div className="stat">
            <span className="k">Mejoras</span>
            <span className="v">{r.upgrades} / 18</span>
          </div>
          <div className="stat">
            <span className="k">RLT invertido</span>
            <span className="v">{r.rltSpent}</span>
          </div>
          <div className="stat">
            <span className="k">Ciclo</span>
            <span className="v">
              {r.dutyTimeH} h + 24 h
            </span>
          </div>
          {r.hoursLeft !== null ? (
            <div className="stat">
              <span className="k">
                Freon al fin del evento (−{r.leakPct}% cada {r.leakTimeH} h)
              </span>
              <span className="v">{groupDigits(String(r.freonAtEnd))}</span>
            </div>
          ) : (
            <div className="stat">
              <span className="k">
                Freon tras {r.dutyTimeH} h (−{r.leakPct}% cada {r.leakTimeH} h)
              </span>
              <span className="v">{groupDigits(String(r.freonAfterDuty))}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
