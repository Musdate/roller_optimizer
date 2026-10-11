import { useEffect, useMemo, useState } from "react";
import { CARDS, CRH_SOURCE, CRH_TOKEN, HEAT, ISLAND_LEVELS, MAX_DESKS, type Parts } from "../crh-data";
import {
  AUTO_INTERVALS,
  BOARD,
  CARD,
  CATALOG,
  COOLER,
  CPU,
  MIN_REPAIR_H,
  NEVER,
  PART_KINDS,
  RAM,
  carePlan,
  evaluateIsland,
  newKey,
  pickTokenPrice,
  specFromCard,
  upgradesFor,
  type CareMode,
  type CareTask,
  type Intervals,
  type LiveCare,
  type IslandCfg,
  type PartKind,
  type PcResult,
  type PcSpec,
  type RewardsCfg,
  type TokenPrice,
  type Upgrade,
} from "../crh";
import "../crh.css";

const STORE_KEY = "crh-calc";
const DOCS_URL = "https://www.computersrh.xyz/docs";
const PRICE_URL = `https://api.dexscreener.com/latest/dex/tokens/${CRH_TOKEN.address}`;

async function fetchTokenPrice(): Promise<TokenPrice> {
  const res = await fetch(PRICE_URL);
  if (!res.ok) throw new Error(`DexScreener respondió ${res.status}`);
  const data = (await res.json()) as { pairs?: Parameters<typeof pickTokenPrice>[0] | null };
  const p = pickTokenPrice(data.pairs ?? [], CRH_TOKEN.address, CRH_TOKEN.chainId);
  if (!p) throw new Error("DexScreener no tiene pools de CRH con precio");
  return p;
}

type IvKey = keyof Intervals;
const IV_FIELDS: { key: IvKey; label: string }[] = [
  { key: "cpuPaste", label: "Pasta CPU" },
  { key: "gpuPaste", label: "Pasta GPU" },
  { key: "fan", label: "Limpiar ventiladores" },
  { key: "repair", label: "Reparar" },
];

const CARE_MODES: { value: CareMode; label: string }[] = [
  { value: "optimal", label: "Óptima (calculada por PC)" },
  { value: "auto", label: "Auto-pasta + limpiar 48 h + reparar 14 d" },
  { value: "none", label: "Sin cuidado" },
  { value: "custom", label: "Personalizada" },
];

interface Saved {
  pcs: PcSpec[];
  islandLevel: number;
  care: CareMode;
  custom: Record<IvKey, string>;
  /** "Estimated hourly earnings" de Rewards & Claim. */
  hourlyTokens: string;
  /** Hash de la isla en el juego, bonus incluido. */
  islandHsGame: string;
  tokenUsd: string;
  /** Panel Care del juego por PC (clave = PcSpec.key), §12.11. */
  live: Record<string, Partial<Record<LiveField, string>>>;
}

type LiveField = "cpuPastePct" | "gpuPastePct" | "fanPct" | "hardwarePct" | "cpuC" | "gpuC";
const LIVE_FIELDS: { key: LiveField; label: string; unit: string }[] = [
  { key: "cpuC", label: "CPU", unit: "°C" },
  { key: "gpuC", label: "GPU", unit: "°C" },
  { key: "cpuPastePct", label: "CPU paste", unit: "%" },
  { key: "gpuPastePct", label: "GPU paste", unit: "%" },
  { key: "fanPct", label: "Fans", unit: "%" },
  { key: "hardwarePct", label: "Hardware", unit: "%" },
];
const TASK_LABEL: Record<CareTask, string> = {
  cpuPaste: "Pasta CPU",
  gpuPaste: "Pasta GPU",
  fan: "Limpiar ventiladores",
  repair: "Reparar",
};
const TASK_BAR: Record<CareTask, string> = { cpuPaste: "CPU paste", gpuPaste: "GPU paste", fan: "Fans", repair: "Hardware" };

function parseLive(v: Partial<Record<LiveField, string>> | undefined): LiveCare | null {
  if (!v) return null;
  const pct = (s?: string) => (s !== undefined && s.trim() !== "" && Number.isFinite(Number(s)) ? Number(s) : null);
  const [c, g, f, h] = [pct(v.cpuPastePct), pct(v.gpuPastePct), pct(v.fanPct), pct(v.hardwarePct)];
  if (c === null || g === null || f === null || h === null) return null;
  return { cpuPastePct: c, gpuPastePct: g, fanPct: f, hardwarePct: h, cpuC: pct(v.cpuC), gpuC: pct(v.gpuC) };
}

const DEFAULT: Saved = {
  pcs: [specFromCard(CARD.get("cedar")!)],
  islandLevel: 1,
  care: "optimal",
  custom: {
    cpuPaste: String(AUTO_INTERVALS.cpuPaste),
    gpuPaste: String(AUTO_INTERVALS.gpuPaste),
    fan: String(AUTO_INTERVALS.fan),
    repair: String(AUTO_INTERVALS.repair),
  },
  hourlyTokens: "",
  islandHsGame: "",
  tokenUsd: "",
  live: {},
};

function validSpec(s: PcSpec): boolean {
  if (s.cardId && CARD.get(s.cardId)?.sealed) return true;
  const p = s.parts;
  if (!p) return false;
  return PART_KINDS.every(({ kind }) => CATALOG[kind].some((x) => x.id === p[kind]));
}

function load(): Saved {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return DEFAULT;
    const p = JSON.parse(raw) as Partial<Saved>;
    const pcs = Array.isArray(p.pcs) ? p.pcs.filter(validSpec).slice(0, MAX_DESKS) : DEFAULT.pcs;
    return { ...DEFAULT, ...p, custom: { ...DEFAULT.custom, ...(p.custom ?? {}) }, pcs };
  } catch {
    return DEFAULT;
  }
}

const num = (s: string) => {
  const v = Number(s);
  return Number.isFinite(v) && v > 0 ? v : 0;
};
const ivFrom = (s: string) => (num(s) > 0 ? num(s) : NEVER);

function usd(x: number, digits = 2): string {
  const sign = x < 0 ? "−" : "";
  return `${sign}$${Math.abs(x).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}
function fmt(x: number, digits = 1): string {
  return x.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
function fmtTokens(x: number): string {
  return x >= 1000 ? fmt(x, 0) : fmt(x, x >= 10 ? 1 : 3);
}
const fmtIv = (h: number) => (h === NEVER ? "nunca" : `${fmt(h, h % 1 ? 1 : 0)} h`);
function fmtDays(d: number | null): string {
  if (d === null) return "nunca";
  if (d > 3650) return "> 10 años";
  return `${fmt(d, d < 10 ? 1 : 0)} días`;
}
function fmtMinutes(m: number): string {
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h ? `${h} h${r ? ` ${r} min` : ""}` : `${r} min`;
}
const signed = (x: number) => (x > 0 ? "good" : x < 0 ? "bad" : "");

export default function ComputersRH() {
  const [state, setState] = useState<Saved>(load);
  const [addCard, setAddCard] = useState("cedar");
  const [upTarget, setUpTarget] = useState<string>("all");
  const [upgrades, setUpgrades] = useState<{ forKey: string; list: Upgrade[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [price, setPrice] = useState<{ loading: boolean; info?: TokenPrice & { at: Date }; error?: string }>({
    loading: false,
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch {
      // localStorage no disponible: no se recuerda la isla, nada más.
    }
  }, [state]);

  const rewards: RewardsCfg = useMemo(
    () => ({
      tokensPer100: num(state.islandHsGame) > 0 ? (num(state.hourlyTokens) * 24 * 100) / num(state.islandHsGame) : 0,
      tokenUsd: num(state.tokenUsd),
    }),
    [state.hourlyTokens, state.islandHsGame, state.tokenUsd],
  );
  const cfg: IslandCfg = useMemo(
    () => ({
      islandLevel: state.islandLevel,
      care: state.care,
      custom: {
        cpuPaste: ivFrom(state.custom.cpuPaste),
        gpuPaste: ivFrom(state.custom.gpuPaste),
        fan: ivFrom(state.custom.fan),
        repair: ivFrom(state.custom.repair),
      },
    }),
    [state.islandLevel, state.care, state.custom],
  );

  const result = useMemo(() => evaluateIsland(state.pcs, cfg, rewards), [state.pcs, cfg, rewards]);
  const calcKey = useMemo(() => JSON.stringify([state.pcs, cfg, rewards]), [state.pcs, cfg, rewards]);
  const hasRewards = result.income > 0;

  const set = <K extends keyof Saved>(k: K, v: Saved[K]) => setState((s) => ({ ...s, [k]: v }));
  const setPcs = (fn: (pcs: PcSpec[]) => PcSpec[]) => setState((s) => ({ ...s, pcs: fn(s.pcs) }));

  function changeCard(i: number, value: string) {
    setPcs((pcs) =>
      pcs.map((p, j) => {
        if (j !== i) return p;
        if (value === "custom") return { ...p, cardId: null, parts: p.parts ?? { ...CARD.get("cedar")!.parts! } };
        const c = CARD.get(value)!;
        return { ...specFromCard(c), key: p.key };
      }),
    );
  }
  function changePart(i: number, patch: Partial<Parts>) {
    setPcs((pcs) => pcs.map((p, j) => (j === i && p.parts ? { ...p, cardId: null, parts: { ...p.parts, ...patch } } : p)));
  }

  function refreshPrice() {
    setPrice({ loading: true });
    fetchTokenPrice()
      .then((p) => {
        set("tokenUsd", String(p.usd));
        setPrice({ loading: false, info: { ...p, at: new Date() } });
      })
      .catch((e: unknown) =>
        setPrice({ loading: false, error: e instanceof Error ? e.message : "No se pudo consultar el precio" }),
      );
  }

  function runUpgrades() {
    setBusy(true);
    const key = calcKey;
    window.setTimeout(() => {
      const idx = state.pcs
        .map((_, i) => i)
        .filter((i) => (upTarget === "all" || state.pcs[i].key === upTarget) && state.pcs[i].parts);
      const list = idx.flatMap((i) => upgradesFor(state.pcs, i, cfg, rewards, result));
      list.sort((a, b) => (a.paybackDays ?? Infinity) - (b.paybackDays ?? Infinity));
      setUpgrades({ forKey: key, list: list.slice(0, 12) });
      setBusy(false);
    }, 30);
  }

  const lvl = ISLAND_LEVELS[state.islandLevel - 1];

  return (
    <div className="crh">
      <div className="row between">
        <h1 style={{ margin: 0 }}>Computers RH</h1>
        <span className="muted crh-src">
          Datos de la{" "}
          <a href={DOCS_URL} target="_blank" rel="noopener noreferrer">
            doc oficial
          </a>{" "}
          · economía {CRH_SOURCE.economy}
        </span>
      </div>

      <div className="crh-top">
        <div className="panel">
          <h2>Recompensas</h2>
          <div className="crh-fields">
                <label className="stat">
                  <span className="k">Ganancia estimada por hora (tokens)</span>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={state.hourlyTokens}
                    onChange={(e) => set("hourlyTokens", e.target.value)}
                  />
                </label>
                <label className="stat">
                  <span className="k">Hash de tu isla en el juego (H/s, con bonus)</span>
                  <div className="crh-part-row">
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={state.islandHsGame}
                      onChange={(e) => set("islandHsGame", e.target.value)}
                    />
                    <button
                      type="button"
                      className="tiny"
                      title="Copia el hash de la isla que armaste abajo"
                      disabled={result.islandHs <= 0}
                      onClick={() => set("islandHsGame", String(Number(result.islandHs.toPrecision(4))))}
                    >
                      usar el calculado
                    </button>
                  </div>
                </label>
            <label className="stat">
              <span className="k">Precio del token CRH (USD)</span>
              <div className="crh-part-row">
                <input type="number" min={0} step="any" value={state.tokenUsd} onChange={(e) => set("tokenUsd", e.target.value)} />
                <button
                  type="button"
                  className="tiny"
                  onClick={refreshPrice}
                  disabled={price.loading}
                  title="Consulta el precio en DexScreener (pool de CRH con más liquidez)"
                >
                  {price.loading ? "consultando…" : "precio actual"}
                </button>
              </div>
              {price.info && (
                <span className="muted crh-sub">
                  {usd(price.info.usd, 6)} a las {price.info.at.toLocaleTimeString()} ·{" "}
                  {price.info.url ? (
                    <a href={price.info.url} target="_blank" rel="noopener noreferrer">
                      DexScreener
                    </a>
                  ) : (
                    "DexScreener"
                  )}
                  , pool con {usd(price.info.liquidityUsd, 0)} de liquidez
                </span>
              )}
              {price.error && <span className="crh-sub bad">{price.error}</span>}
            </label>
          </div>
        </div>

        <div className="panel">
          <h2>Isla y cuidado</h2>
          <div className="crh-fields">
            <label className="stat">
              <span className="k">Nivel de isla</span>
              <select value={state.islandLevel} onChange={(e) => set("islandLevel", Number(e.target.value))}>
                {ISLAND_LEVELS.map((l, i) => (
                  <option key={i} value={i + 1}>
                    Nivel {i + 1}
                    {l.bonus ? ` (+${l.bonus}%)` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="stat">
              <span className="k">Mantenimiento</span>
              <select value={state.care} onChange={(e) => set("care", e.target.value as CareMode)}>
                {CARE_MODES.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
            {state.care === "custom" && (
              <div className="crh-ivs">
                {IV_FIELDS.map((f) => (
                  <label className="stat" key={f.key}>
                    <span className="k">{f.label} cada (h)</span>
                    <input
                      type="number"
                      min={0}
                      step="any"
                      placeholder="nunca"
                      value={state.custom[f.key]}
                      onChange={(e) => set("custom", { ...state.custom, [f.key]: e.target.value })}
                    />
                  </label>
                ))}
              </div>
            )}
          </div>
          {(state.care === "custom" || state.islandLevel > 1) && (
            <p className="muted crh-note">
              {state.care === "custom" && `Vacío = nunca. Reparar: mínimo ${MIN_REPAIR_H} h. `}
              {state.islandLevel > 1 && `El +${lvl.bonus}% de nivel requiere 2+ PCs matched.`}
            </p>
          )}
        </div>
      </div>

      <div className="panel">
        <div className="crh-summary">
          <div className="crh-hero">
            <span className="k">Ganancia neta por día</span>
            <span className={`v ${hasRewards ? signed(result.net) : ""}`}>{usd(result.net)}</span>
            <span className="crh-hero-sub">{usd(result.net * 30)} en 30 días</span>
          </div>
          <div className="stat-row crh-stats">
            <div className="stat">
              <span className="k">Ingreso</span>
              <span className="v">{usd(result.income)}</span>
              <span className="muted crh-sub">{fmtTokens(result.tokens)} tokens</span>
            </div>
            <div className="stat">
              <span className="k">Electricidad</span>
              <span className="v">{usd(result.electricity)}</span>
              <span className="muted crh-sub">{fmt(result.watts, 0)} W · {fmt((result.watts * 24) / 1000, 2)} kWh</span>
            </div>
            <div className="stat">
              <span className="k">Mantenimiento</span>
              <span className="v">{usd(result.care)}</span>
            </div>
            <div className="stat">
              <span className="k">Hash de la isla</span>
              <span className="v">{fmt(result.islandHs)} H/s</span>
              <span className="muted crh-sub">
                {fmt(result.healthyHs)} sanos · bonus +{result.bonusPct}%
              </span>
            </div>
            <div className="stat">
              <span className="k">Inversión</span>
              <span className="v">{usd(result.investment)}</span>
              <span className="muted crh-sub">
                PCs {usd(result.pcCost)} + isla {usd(result.infra.cost)}
              </span>
            </div>
            <div className="stat">
              <span className="k">Retorno</span>
              <span className="v">{fmtDays(result.paybackDays)}</span>
            </div>
          </div>
        </div>

        {!hasRewards && (
          <div className="warn-box" style={{ marginTop: 12 }}>
            Completa las recompensas para ver ingresos y el cuidado óptimo.
          </div>
        )}
        {result.warnings.map((w) => (
          <div className="err" key={w} style={{ marginTop: 8 }}>
            {w}
          </div>
        ))}

        <div className="crh-infra">
          <span>
            <b>{result.matched}</b> de {state.pcs.length} PCs matched → combo +{result.comboPct}%, nivel +{result.levelPct}%
          </span>
          <span>
            Necesitas: {result.infra.plots} parcela{result.infra.plots > 1 ? "s" : ""}, isla nivel {result.infra.islandLevel},
            energía nivel {result.infra.powerLevel}
          </span>
          <span>
            Construirlo desde cero: {usd(result.infra.cost)} y {fmtMinutes(result.infra.minutes)} de builder
          </span>
        </div>
      </div>

      <div className="panel">
        <div className="row between" style={{ marginBottom: 10 }}>
          <h2 style={{ margin: 0 }}>
            PCs ({state.pcs.length}/{MAX_DESKS})
          </h2>
          <div className="row">
            <select className="tiny" value={addCard} onChange={(e) => setAddCard(e.target.value)}>
              {CARDS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {usd(c.price, c.price % 1 ? 2 : 0)}
                </option>
              ))}
            </select>
            <button
              className="tiny"
              disabled={state.pcs.length >= MAX_DESKS}
              onClick={() => setPcs((pcs) => [...pcs, specFromCard(CARD.get(addCard)!)])}
            >
              agregar PC
            </button>
          </div>
        </div>

        <div className="crh-pcs">
          {result.pcs.map((r, i) => (
            <PcCard
              key={r.spec.key}
              index={i}
              r={r}
              hasRewards={hasRewards}
              canAdd={state.pcs.length < MAX_DESKS}
              live={state.live[r.spec.key] ?? {}}
              onLive={(k, v) =>
                set("live", { ...state.live, [r.spec.key]: { ...state.live[r.spec.key], [k]: v } })
              }
              onCard={(v) => changeCard(i, v)}
              onPart={(patch) => changePart(i, patch)}
              onDuplicate={() => setPcs((pcs) => [...pcs.slice(0, i + 1), { ...pcs[i], key: newKey() }, ...pcs.slice(i + 1)])}
              onRemove={() => setPcs((pcs) => pcs.filter((_, j) => j !== i))}
            />
          ))}
          {state.pcs.length === 0 && <p className="muted">Agrega una PC para empezar.</p>}
        </div>
      </div>

      <div className="panel">
        <div className="row between" style={{ marginBottom: 10 }}>
          <h2 style={{ margin: 0 }}>Mejoras recomendadas</h2>
          <div className="row">
            <select className="tiny" value={upTarget} onChange={(e) => setUpTarget(e.target.value)}>
              <option value="all">Todas las PCs</option>
              {result.pcs.map((r, i) =>
                r.spec.parts ? (
                  <option key={r.spec.key} value={r.spec.key}>
                    PC {i + 1} · {r.stats.name}
                  </option>
                ) : null,
              )}
            </select>
            <button className="tiny" onClick={runUpgrades} disabled={busy || !hasRewards}>
              {busy ? "calculando…" : "calcular"}
            </button>
          </div>
        </div>
        <p className="muted crh-note" style={{ marginTop: 0 }}>
          Cambios de una pieza, ordenados por retorno.
        </p>
        {!hasRewards ? (
          <p className="muted">Completa las recompensas para calcular mejoras.</p>
        ) : upgrades && upgrades.forKey !== calcKey ? (
          <p className="muted">Cambiaste algo: vuelve a calcular.</p>
        ) : upgrades ? (
          upgrades.list.length ? (
            <div className="crh-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>PC</th>
                    <th>Cambio</th>
                    <th className="num">Costo</th>
                    <th className="num">Δ neto/día</th>
                    <th className="num">Retorno</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {upgrades.list.map((u, n) => (
                    <tr key={n}>
                      <td>PC {u.pcIndex + 1}</td>
                      <td>{u.label}</td>
                      <td className="num">{usd(u.cost)}</td>
                      <td className="num good">{usd(u.deltaNet, 3)}</td>
                      <td className="num">{fmtDays(u.paybackDays)}</td>
                      <td>
                        <button className="tiny" onClick={() => changePart(u.pcIndex, u.parts)}>
                          aplicar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">Ningún cambio de una sola pieza mejora la ganancia neta.</p>
          )
        ) : null}
      </div>
    </div>
  );
}

function PcCard({
  index,
  r,
  hasRewards,
  canAdd,
  live,
  onLive,
  onCard,
  onPart,
  onDuplicate,
  onRemove,
}: {
  index: number;
  r: PcResult;
  hasRewards: boolean;
  canAdd: boolean;
  live: Partial<Record<LiveField, string>>;
  onLive: (k: LiveField, v: string) => void;
  onCard: (v: string) => void;
  onPart: (patch: Partial<Parts>) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const st = r.stats;
  const p = r.spec.parts;
  const iv = r.intervals;
  const hot = r.maxTemp > 70;

  return (
    <section className={`crh-pc${r.valid ? "" : " invalid"}`}>
      <div className="crh-pc-head">
        <b>PC {index + 1}</b>
        <select className="tiny" value={r.spec.cardId ?? "custom"} onChange={(e) => onCard(e.target.value)}>
          {CARDS.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
          <option value="custom" disabled={!p}>
            Armado propio
          </option>
        </select>
        {r.matched && <span className="tag new">matched</span>}
        <span className="spacer" />
        <span className="muted crh-price">{usd(st.price)}</span>
        <button className="tiny" onClick={onDuplicate} disabled={!canAdd}>
          duplicar
        </button>
        <button className="tiny" onClick={onRemove}>
          quitar
        </button>
      </div>

      {p ? (
        <div className="crh-parts">
          {PART_KINDS.map(({ kind, label }) => (
            <PartSelect key={kind} kind={kind} label={label} parts={p} onPart={onPart} />
          ))}
        </div>
      ) : (
        <p className="muted crh-note" style={{ margin: "6px 0" }}>
          Sistema sellado: sus partes no se pueden cambiar.
        </p>
      )}

      {r.stats.errors.map((e) => (
        <div className="err crh-err" key={e}>
          {e}
        </div>
      ))}

      <div className="crh-pc-body">
        <div className="crh-kv">
          <span>H/s sano</span>
          <b>
            {fmt(st.healthyHs, 2)} <span className="muted">(×{fmt(st.mult, 4)})</span>
          </b>
          <span>Consumo</span>
          <b>
            {st.watts} W{!st.sealed && <span className="muted"> · fuente {fmt(st.psuNeed, 1)}/{st.psuCap} W</span>}
          </b>
          <span>Temperatura</span>
          <b className={hot ? "warn" : ""}>
            {fmt(r.freshTemp)} °C nueva · máx {fmt(r.maxTemp)} °C
          </b>
          <span>Pérdida promedio</span>
          <b>
            {fmt(r.loss, 2)}% <span className="muted">(calor {fmt(r.heatLoss, 2)} + desgaste {fmt(r.wearLoss, 2)})</span>
          </b>
          <span>H/s efectivo</span>
          <b>
            {fmt(r.effHs, 2)} <span className="muted">→ {fmt(r.islandHs, 2)} con bonus</span>
          </b>
          <span>Cuidado</span>
          <b className="crh-ivtext">
            pasta CPU {fmtIv(iv.cpuPaste)} · GPU {fmtIv(iv.gpuPaste)} · limpiar {st.fans > 0 ? fmtIv(iv.fan) : "—"} · reparar{" "}
            {fmtIv(iv.repair)}
          </b>
        </div>

        <table className="crh-money">
          <tbody>
            <tr>
              <td>Ingreso</td>
              <td className="num">{usd(r.income, 3)}</td>
            </tr>
            <tr>
              <td>Electricidad</td>
              <td className="num">−{usd(r.electricity, 3)}</td>
            </tr>
            <tr>
              <td>Pasta térmica</td>
              <td className="num">−{usd(r.care.cpuPaste + r.care.gpuPaste, 3)}</td>
            </tr>
            <tr>
              <td>Limpieza de ventiladores</td>
              <td className="num">−{usd(r.care.fanClean, 3)}</td>
            </tr>
            <tr>
              <td>Reparaciones</td>
              <td className="num">−{usd(r.care.repair, 3)}</td>
            </tr>
            <tr className="crh-total">
              <td>Neto por día</td>
              <td className={`num ${hasRewards ? signed(r.net) : ""}`}>{usd(r.net, 3)}</td>
            </tr>
            <tr>
              <td>Retorno de la PC</td>
              <td className="num">{fmtDays(r.net > 0 ? st.price / r.net : null)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {r.valid && <LivePlan r={r} live={live} onLive={onLive} />}
    </section>
  );
}

function fmtHours(h: number): string {
  if (h < 0.05) return "ahora";
  if (h < 1) return `${Math.round(h * 60)} min`;
  const d = Math.floor(h / 24);
  const rest = Math.round(h - d * 24);
  return d ? `${d} d ${rest} h` : `${fmt(h, 0)} h`;
}

function tempClass(t: number): string {
  return t >= HEAT.throttleC ? "hot" : t >= 60 ? "warm" : "cool";
}

const isAutoPaste = (task: CareTask, everyH: number) =>
  (task === "cpuPaste" && Math.abs(everyH - (HEAT.clocks.cpuPaste * HEAT.autoPastePct) / 100) < 0.01) ||
  (task === "gpuPaste" && Math.abs(everyH - (HEAT.clocks.gpuPaste * HEAT.autoPastePct) / 100) < 0.01);

function LivePlan({
  r,
  live,
  onLive,
}: {
  r: PcResult;
  live: Partial<Record<LiveField, string>>;
  onLive: (k: LiveField, v: string) => void;
}) {
  const parsed = parseLive(live);
  const plan = parsed ? carePlan(r.stats, r.intervals, parsed) : null;
  const [open, setOpen] = useState(() => Object.values(live).some((v) => v && v.trim() !== ""));

  return (
    <details className="crh-live" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Estado en el juego → qué hacer</summary>
      <div className="crh-live-inputs">
        {LIVE_FIELDS.map((f) => (
          <label className="crh-part" key={f.key}>
            <span className="k">
              {f.label} ({f.unit})
            </span>
            <input
              type="number"
              min={0}
              max={f.unit === "%" ? 100 : undefined}
              step="any"
              value={live[f.key] ?? ""}
              onChange={(e) => onLive(f.key, e.target.value)}
            />
          </label>
        ))}
      </div>

      {plan && (
        <div className="crh-plan">
          <div className="crh-plan-status">
            <span className={`crh-temp ${tempClass(plan.tempsNow[0])}`}>CPU {fmt(plan.tempsNow[0])} °C</span>
            <span className={`crh-temp ${tempClass(plan.tempsNow[1])}`}>GPU {fmt(plan.tempsNow[1])} °C</span>
            <span className="crh-plan-kv">
              Velocidad <b>{fmt(plan.speedNow, 1)}%</b>
            </span>
            <span className="crh-plan-kv">
              Sin cuidado llega a 70 °C{" "}
              <b>{plan.idle.hoursTo70 === null ? "nunca" : `en ${fmtHours(plan.idle.hoursTo70)}`}</b>
            </span>
          </div>
          {plan.offsets.some((o) => Math.abs(o) > 3) && (
            <div className="warn-box">Las temperaturas no cuadran con esta PC (±3 °C). Revisa los datos.</div>
          )}
          <div className="crh-steps">
            <div className="crh-step crh-step-head">
              <span>Qué hacer</span>
              <span>Cuándo</span>
              <span>Barra del juego</span>
              <span>Efecto</span>
              <span className="num">Costo</span>
            </div>
            {plan.steps.map((s) => (
              <div className="crh-step" key={s.task}>
                <span>
                  <span className={`crh-chip t-${s.task}`}>{TASK_LABEL[s.task]}</span>
                  {isAutoPaste(s.task, s.everyH) && <span className="crh-auto">auto-paste</span>}
                </span>
                <span className={`crh-when${s.inH < 0.05 ? " now" : ""}`}>{fmtHours(s.inH)}</span>
                <span className="crh-barcell">
                  <span className="crh-bar-label">
                    {TASK_BAR[s.task]} <b>{s.atPct}%</b>
                  </span>
                  <span className="crh-bar">
                    <span className={`crh-bar-fill t-${s.task}`} style={{ width: `${s.atPct}%` }} />
                  </span>
                </span>
                <span className="crh-effect">
                  {s.task === "repair" ? (
                    <b className="good">+{fmt(s.before, 1)}% velocidad</b>
                  ) : (
                    <>
                      <span className={tempClass(s.before)}>{fmt(s.before)}</span>
                      <span className="crh-arrow">→</span>
                      <span className="good">{fmt(s.after)} °C</span>
                    </>
                  )}
                </span>
                <span className="num crh-cost">{usd(s.cost)}</span>
              </div>
            ))}
            {plan.skipped.map((t) => (
              <div className="crh-step skipped" key={t}>
                <span>
                  <span className="crh-chip">{TASK_LABEL[t]}</span>
                </span>
                <span className="crh-skip-text">no conviene</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </details>
  );
}

function PartSelect({
  kind,
  label,
  parts,
  onPart,
}: {
  kind: PartKind;
  label: string;
  parts: Parts;
  onPart: (patch: Partial<Parts>) => void;
}) {
  const board = BOARD.get(parts.board)!;
  // Solo lo compatible con la placa, pero sin esconder la pieza actual aunque no lo sea.
  const options = CATALOG[kind].filter((x) => {
    if (x.id === parts[kind]) return true;
    if (kind === "cpu") return CPU.get(x.id)!.socket === board.socket;
    if (kind === "ram") return RAM.get(x.id)!.memory === board.memory;
    if (kind === "cooler") {
      const fam = COOLER.get(x.id)!.family;
      return fam === null || fam === board.socket;
    }
    return true;
  });
  const qtyKey = kind === "ram" ? "ramQty" : kind === "fan" ? "fanQty" : null;

  return (
    <label className="crh-part">
      <span className="k">{label}</span>
      <div className="crh-part-row">
        <select value={parts[kind]} onChange={(e) => onPart({ [kind]: e.target.value } as Partial<Parts>)}>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name} · {usd(o.price)}
            </option>
          ))}
        </select>
        {qtyKey && (
          <input
            type="number"
            min={kind === "ram" ? 1 : 0}
            max={kind === "ram" ? 4 : 9}
            step={1}
            value={parts[qtyKey]}
            title="Cantidad"
            onChange={(e) => onPart({ [qtyKey]: Math.max(0, Math.floor(Number(e.target.value) || 0)) } as Partial<Parts>)}
          />
        )}
      </div>
    </label>
  );
}
