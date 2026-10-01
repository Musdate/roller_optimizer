import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { errMsg, fetchDigging, type DiggingState } from "../api";
import { CELLS, CRAB, SAND, SIZE, type Problem } from "../excavacion";
import type { WorkerRequest, WorkerResponse } from "../excavacion.worker";
import { useCooldown } from "../useCooldown";
import "../excavacion.css";

const STORE_KEY = "sfl-excavacion";
const REFRESH_COOLDOWN_MS = 10_000;

interface Saved {
  landId: string;
  target: string;
  day: string;
  /** celda → lo marcado a mano; null = "sin excavar" aunque el API diga otra cosa */
  manual: Record<number, string | null>;
  data: DiggingState | null;
  showHints: boolean;
}

const utcDay = () => new Date().toISOString().slice(0, 10);

function load(): Saved {
  const empty: Saved = { landId: "", target: "", day: utcDay(), manual: {}, data: null, showHints: true };
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return empty;
    const s = { ...empty, ...(JSON.parse(raw) as Partial<Saved>) };
    // el tablero se reinicia a las 00:00 UTC: lo de ayer ya no sirve
    return s.day === utcDay() ? s : { ...empty, landId: s.landId, target: s.target, showHints: s.showHints };
  } catch {
    return empty;
  }
}

const PALETTE = ["#4f9dff", "#f2c14e", "#b07cff", "#3fbf7f", "#ff8a5b", "#5fd4e0", "#ff5fa8", "#c9d36a", "#8f9bff", "#e08fd0"];

/** Abreviatura corta para la celda; si dos ítems del día chocan ("Clam Shell" y
 *  "Cockle Shell"), se alarga hasta distinguirlos. */
function abbreviations(items: string[]): Record<string, string> {
  const cands = (name: string): string[] => {
    const w = name.split(/\s+/).filter(Boolean);
    const out = w.length > 1 ? [w[0][0] + w[1][0], w[0].slice(0, 2) + w[1][0]] : [];
    return [...out, name.slice(0, 2), name.slice(0, 3)].map((a) => a.toUpperCase());
  };
  const out: Record<string, string> = {};
  const taken = new Set<string>();
  for (const it of items) {
    const a = cands(it).find((c) => !taken.has(c) && !items.some((o) => o !== it && cands(o)[0] === c)) ?? it.slice(0, 4);
    out[it] = a;
    taken.add(a);
  }
  return out;
}

function pct(p: number): string {
  if (p < 0.01) return "";
  return String(Math.round(p * 100));
}

/** Compara lo que llegó del API con lo que ya había, campo por campo, y
 *  conserva la referencia de lo que no cambió: refrescar sin excavaciones
 *  nuevas no re-renderiza ni recalcula nada. No se decide por fecha ni por
 *  `updated_at`: a las 00:00 UTC los hoyos de ayer caducan sin que la granja
 *  se guarde de nuevo. */
function reuseUnchanged(prev: DiggingState, next: DiggingState): DiggingState {
  if (JSON.stringify(prev) === JSON.stringify(next)) return prev;
  const out = { ...next } as Record<keyof DiggingState, unknown>;
  for (const k of Object.keys(next) as (keyof DiggingState)[])
    if (JSON.stringify(prev[k]) === JSON.stringify(next[k])) out[k] = prev[k];
  return out as unknown as DiggingState;
}

const LETTERS = "ABCDEFGHIJ";

/** Posición como se lee en la grilla: fila (número) + columna (letra), p. ej. "8B". */
const coord = (c: number) => `${Math.floor(c / SIZE) + 1}${LETTERS[c % SIZE]}`;

/** Icono oficial del juego; si no carga, la abreviatura. */
function ItemIcon({ src, name, text, size }: { src?: string; name: string; text: string; size: number }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) return <>{text}</>;
  return (
    <img
      className="exc-icon"
      src={src}
      alt={name}
      width={size}
      height={size}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setBroken(true)}
    />
  );
}

export default function Excavacion() {
  const [saved, setSaved] = useState<Saved>(load);
  const [landInput, setLandInput] = useState(saved.landId);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<WorkerResponse | null>(null);
  const [computing, setComputing] = useState(false);
  const [mode, setMode] = useState<"target" | "any">("target");
  const [showDrill, setShowDrill] = useState(false);
  const [picker, setPicker] = useState<number | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const reqId = useRef(0);
  const lastPosted = useRef("");
  const cooldown = useCooldown(REFRESH_COOLDOWN_MS);

  const { data, manual } = saved;

  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(saved));
    } catch {
      // sin localStorage: no se recuerda entre visitas, nada más
    }
  }, [saved]);

  useEffect(() => {
    const w = new Worker(new URL("../excavacion.worker.ts", import.meta.url), { type: "module" });
    w.addEventListener("message", (e: MessageEvent<WorkerResponse>) => {
      if (e.data.id !== reqId.current) return;
      setResult(e.data);
      setComputing(false);
    });
    workerRef.current = w;
    // worker nuevo (p. ej. StrictMode lo recrea): lo pedido al anterior se perdió
    lastPosted.current = "";
    return () => w.terminate();
  }, []);

  async function refresh(id = landInput.trim()) {
    if (!/^\d{1,20}$/.test(id)) {
      setError("Ingresa el ID numérico de tu granja.");
      return;
    }
    setLoading(true);
    setError("");
    cooldown.trigger();
    try {
      const d = await fetchDigging(id);
      setSaved((s) => {
        const prev = s.landId === id ? s.data : null;
        const data = prev ? reuseUnchanged(prev, d) : d;
        return {
          ...s,
          landId: id,
          day: utcDay(),
          data,
          // otra granja u otro tablero (cambió el día o los patrones): lo
          // marcado a mano ya no corresponde
          manual: prev && s.day === utcDay() && data.patterns === prev.patterns ? s.manual : {},
        };
      });
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (saved.landId) refresh(saved.landId);
    // solo al abrir la vista
  }, []);

  useEffect(() => {
    if (picker === null) return;
    const close = () => setPicker(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [picker]);

  const apiObserved = useMemo(() => {
    const out: Record<number, string> = {};
    for (const h of data?.holes ?? []) out[h.y * SIZE + h.x] = h.item;
    return out;
  }, [data?.holes]);

  const observed = useMemo(() => {
    const out = { ...apiObserved };
    for (const [k, v] of Object.entries(manual)) {
      if (v === null) delete out[Number(k)];
      else out[Number(k)] = v;
    }
    return out;
  }, [apiObserved, manual]);

  const items = useMemo(() => {
    const out: string[] = [];
    for (const p of data?.patterns ?? [])
      for (const f of data?.formations[p] ?? []) if (!out.includes(f.item)) out.push(f.item);
    return out;
  }, [data]);

  const abbr = useMemo(() => abbreviations(items), [items]);
  const icons = data?.icons ?? {};
  const color = (item: string) => PALETTE[items.indexOf(item) % PALETTE.length];

  const target = data ? (items.includes(saved.target) ? saved.target : data.artefact) : "";

  const problem: Problem | null = useMemo(
    () => (data && data.patterns.length ? { patterns: data.patterns, formations: data.formations, observed } : null),
    [data, observed],
  );

  useEffect(() => {
    if (!problem || !workerRef.current) return;
    const budget = data?.budget ?? 0;
    const key = JSON.stringify([problem, target, budget]);
    if (key === lastPosted.current) return;
    lastPosted.current = key;
    const id = ++reqId.current;
    setComputing(true);
    const req: WorkerRequest = { id, problem, target, budget };
    workerRef.current.postMessage(req);
  }, [problem, target, data?.budget]);

  const counts = useMemo(() => {
    const out: Record<string, { found: number; total: number }> = {};
    for (const it of items) out[it] = { found: 0, total: 0 };
    for (const p of data?.patterns ?? []) for (const f of data?.formations[p] ?? []) out[f.item].total++;
    for (const v of Object.values(observed)) if (out[v]) out[v].found++;
    return out;
  }, [items, data, observed]);

  function setManual(c: number, v: string | null | undefined) {
    setSaved((s) => {
      const m = { ...s.manual };
      if (v === undefined) delete m[c];
      else m[c] = v;
      return { ...s, manual: m };
    });
    setPicker(null);
  }

  const an = result?.analysis;
  const adv = result?.advice;
  const heat = an && adv ? (mode === "target" ? adv.prob : an.anyTreasure) : null;
  let heatMax = 0;
  if (heat) for (let c = 0; c < CELLS; c++) if (!(c in observed)) heatMax = Math.max(heatMax, heat[c]);
  const drillCells = new Set<number>();
  if (showDrill && adv?.drill) {
    const { x, y } = adv.drill;
    [0, 1, SIZE, SIZE + 1].forEach((d) => drillCells.add(y * SIZE + x + d));
  }
  const manualCount = Object.keys(manual).length;

  return (
    <div className="exc">
      <div className="panel">
        <div className="row between">
          <div>
            <h2 style={{ margin: 0 }}>Excavación — Sunflower Land</h2>
            <span className="muted" style={{ fontSize: 12 }}>
              Dónde excavar para encontrar el tesoro que buscas en el desierto de Digby.
            </span>
          </div>
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              refresh();
            }}
          >
            <input
              className="exc-land"
              placeholder="ID de tu granja"
              inputMode="numeric"
              value={landInput}
              onChange={(e) => setLandInput(e.target.value.replace(/\D/g, ""))}
            />
            <div className="cooldown-wrap">
              <button
                className="primary"
                type="submit"
                disabled={loading || cooldown.active}
                title={cooldown.active ? `Espera ${cooldown.secondsLeft}s antes de volver a refrescar` : undefined}
              >
                {loading ? "Consultando…" : "Refrescar"}
              </button>
              {cooldown.active && (
                <div
                  className="cooldown-bar"
                  key={cooldown.key}
                  style={{ animation: `cooldown-bar-drain ${REFRESH_COOLDOWN_MS}ms linear forwards` }}
                />
              )}
            </div>
          </form>
        </div>
        {error && <div className="err" style={{ marginTop: 8 }}>{error}</div>}
        {data && (
          <div className="exc-tiles">
            <div className="exc-tile">
              <span className="k">Excavaciones usadas</span>
              <span className="n">
                {data.digs.used}
                <small> / {data.digs.max + data.digs.extra}</small>
              </span>
            </div>
            <div
              className={`exc-tile${data.shovels < data.digs.left ? " exc-tile-warn" : ""}`}
              title={
                data.shovels < data.digs.left
                  ? `Tienes menos palas que excavaciones restantes: hoy solo puedes excavar ${data.budget}`
                  : undefined
              }
            >
              <span className="k">Palas restantes</span>
              <span className="n">{data.shovels}</span>
            </div>
            <div className="exc-tile">
              <span className="k">Taladros</span>
              <span className="n">{data.drills}</span>
            </div>
          </div>
        )}
      </div>

      {data?.stale && (
        <div className="warn-box">
          No hay excavaciones de hoy en tu granja: los patrones pueden ser los de ayer. Entra al minijuego una vez
          y vuelve a refrescar.
        </div>
      )}

      {data && !data.patterns.length && (
        <div className="warn-box">Tu granja no tiene patrones de excavación. Entra al minijuego y vuelve a refrescar.</div>
      )}

      {data && data.patterns.length > 0 && (
        <div className="exc-main">
          <div className="panel exc-board-panel">
            <div className="row between" style={{ marginBottom: 10 }}>
              <div className="row" style={{ gap: 4 }}>
                <button className={`tiny${mode === "target" ? " exc-on" : ""}`} onClick={() => setMode("target")}>
                  {target}
                </button>
                <button className={`tiny${mode === "any" ? " exc-on" : ""}`} onClick={() => setMode("any")}>
                  Cualquier tesoro
                </button>
              </div>
              <label className="tiny row" style={{ gap: 4 }}>
                <input type="checkbox" checked={showDrill} onChange={(e) => setShowDrill(e.target.checked)} />
                Mostrar taladro 2×2
              </label>
              <label className="tiny row" style={{ gap: 4 }} title="Ítems que seguro están en una casilla, aunque no la hayas excavado">
                <input
                  type="checkbox"
                  checked={saved.showHints}
                  onChange={(e) => setSaved((s) => ({ ...s, showHints: e.target.checked }))}
                />
                Mostrar pistas
              </label>
            </div>

            <div className="exc-grid-wrap">
              <div className="exc-grid">
                <span />
                {LETTERS.split("").map((l) => (
                  <span key={l} className="exc-axis">
                    {l}
                  </span>
                ))}
                {Array.from({ length: CELLS }, (_, c) => {
                  const seen = observed[c];
                  const isManual = c in manual;
                  const best = !!adv?.tied.includes(c);
                  const p = heat?.[c] ?? 0;
                  const style: CSSProperties = {};
                  const voidCell = seen === undefined && !!an?.consistent && an.impossible[c];
                  const hint = seen === undefined && saved.showHints ? an?.certain[c] ?? null : null;
                  if (hint) style.background = `color-mix(in srgb, ${color(hint)} 22%, var(--panel-2))`;
                  else if (seen === undefined && !voidCell && heat && heatMax > 0)
                    style.background = `color-mix(in srgb, var(--good) ${Math.round((p / heatMax) * 75)}%, var(--panel-2))`;
                  if (seen && seen !== SAND && seen !== CRAB)
                    style.background = `color-mix(in srgb, ${color(seen)} 40%, var(--panel-2))`;
                  const cell = (
                    <button
                      key={c}
                      className={[
                        "exc-cell",
                        c % SIZE >= 7 && "exc-right",
                        seen === SAND && "exc-sand",
                        seen === CRAB && "exc-crab",
                        seen && seen !== SAND && seen !== CRAB && "exc-item",
                        best && "exc-best",
                        drillCells.has(c) && "exc-drill",
                        isManual && "exc-manual",
                        voidCell && "exc-void",
                        hint && "exc-clue",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      style={style}
                      title={`${coord(c)}${
                        seen
                          ? ` — ${seen}`
                          : hint
                            ? ` — pista: aquí hay ${hint} (seguro)`
                            : voidCell
                              ? " — seguro que no hay tesoro"
                              : heat
                                ? ` — ${(p * 100).toFixed(1)}%`
                                : ""
                      }${isManual ? " (marcado a mano)" : ""}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setPicker(picker === c ? null : c);
                      }}
                    >
                      {seen ? (
                        <ItemIcon
                          src={icons[seen]}
                          name={seen}
                          text={seen === SAND ? "" : seen === CRAB ? "🦀" : abbr[seen] ?? seen.slice(0, 2)}
                          size={30}
                        />
                      ) : hint ? (
                        <ItemIcon src={icons[hint]} name={hint} text={abbr[hint] ?? hint.slice(0, 2)} size={30} />
                      ) : voidCell ? (
                        ""
                      ) : heat ? (
                        pct(p)
                      ) : (
                        ""
                      )}
                      {picker === c && (
                        <div className="exc-picker" onClick={(e) => e.stopPropagation()}>
                          <div className="muted" style={{ fontSize: 11 }}>{coord(c)}</div>
                          {items.map((it) => (
                            <span key={it} role="button" onClick={() => setManual(c, it)}>
                              <ItemIcon src={icons[it]} name={it} text="" size={18} />
                              {it}
                            </span>
                          ))}
                          <span role="button" onClick={() => setManual(c, CRAB)}>
                            <ItemIcon src={icons[CRAB]} name={CRAB} text="🦀" size={18} />
                            Cangrejo
                          </span>
                          <span role="button" onClick={() => setManual(c, SAND)}>
                            <ItemIcon src={icons[SAND]} name={SAND} text="" size={18} />
                            Arena
                          </span>
                          <span role="button" onClick={() => setManual(c, null)}>Sin excavar</span>
                          {isManual && (
                            <span role="button" onClick={() => setManual(c, undefined)}>
                              Usar lo del juego
                            </span>
                          )}
                        </div>
                      )}
                    </button>
                  );
                  return c % SIZE === 0 ? (
                    [
                      <span key={`r${c}`} className="exc-axis">
                        {c / SIZE + 1}
                      </span>,
                      cell,
                    ]
                  ) : (
                    cell
                  );
                })}
              </div>
            </div>
            {manualCount > 0 && (
              <div className="exc-hint">
                <button className="tiny" onClick={() => setSaved((s) => ({ ...s, manual: {} }))}>
                  Borrar {manualCount} marca{manualCount === 1 ? "" : "s"} manual{manualCount === 1 ? "" : "es"}
                </button>
              </div>
            )}
          </div>

          <div className="stack exc-side">
            <div className="panel">
              <h3>Tesoro buscado</h3>
              <div className="exc-items">
                {items.map((it) => (
                  <button
                    key={it}
                    className={`tiny${it === target ? " exc-on" : ""}`}
                    onClick={() => {
                      setSaved((s) => ({ ...s, target: it }));
                      setMode("target");
                    }}
                  >
                    <ItemIcon src={icons[it]} name={it} text="" size={18} />
                    {it} <span className="muted">{counts[it]?.found}/{counts[it]?.total}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="panel">
              <h3>Recomendación</h3>
              {!an || computing ? (
                <div className="muted">Calculando probabilidades y simulando partidas…</div>
              ) : !an.consistent ? (
                <div className="err">
                  Lo excavado no calza con los patrones del día. Revisa las casillas marcadas a mano o refresca (los
                  patrones podrían ser de ayer).
                </div>
              ) : adv && adv.found >= adv.total ? (
                <div>Ya encontraste {adv.total === 1 ? "el" : `los ${adv.total}`} {target}. Elige otro tesoro.</div>
              ) : adv && adv.best !== null ? (
                <>
                  <div className="exc-reco">
                    Excava en{" "}
                    {adv.tied.length > 1 ? (
                      <>
                        {adv.tied.slice(0, 4).map((c, i, list) => (
                          <span key={c}>
                            <b>{coord(c)}</b>
                            {i < list.length - 1 ? (i === list.length - 2 && adv.tied.length <= 4 ? " o " : ", ") : ""}
                          </span>
                        ))}
                        {adv.tied.length > 4 && ` y ${adv.tied.length - 4} más`}
                        <span className="exc-tie"> empatadas</span>
                      </>
                    ) : (
                      <b>{coord(adv.best)}</b>
                    )}
                  </div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {adv.tied.length > 1
                      ? `Todas tienen ~${(adv.prob[adv.best] * 100).toFixed(1)}% de ${target}; la diferencia entre ellas es menor que el margen de error, así que da igual cuál elijas.`
                      : `${(adv.prob[adv.best] * 100).toFixed(1)}% de que haya ${target} ahí`}
                    {adv.tied.length > 1
                      ? ""
                      : adv.method === "rollout"
                      ? ". No es la más probable, pero con tus palas te deja más opciones de encontrar todos."
                      : adv.method === "timeout"
                        ? ": es la más probable (este dispositivo no alcanzó a simular el resto de la partida)."
                        : ": es la casilla más probable."}
                  </div>
                  {adv.success !== null && (
                    <div className="exc-success">
                      Con {adv.budget} excavaci{adv.budget === 1 ? "ón" : "ones"}:{" "}
                      <b>{Math.round(adv.success * 100)}%</b> de encontrar{" "}
                      {adv.total - adv.found === 1 ? `el ${target} que falta` : `los ${adv.total - adv.found} ${target} que faltan`}.
                    </div>
                  )}
                  {adv.budget === 0 && (
                    <div className="warn-box" style={{ marginTop: 8, marginBottom: 0 }}>
                      No te quedan excavaciones (o palas) hoy.
                    </div>
                  )}
                </>
              ) : null}
              {an?.consistent && (
                <div className="muted exc-mode">
                  {an.mode === "exact"
                    ? `Cálculo exacto: ${an.samples.toLocaleString()} ubicaciones posibles.`
                    : `Muestreo: ${an.samples.toLocaleString()} ubicaciones${
                        adv?.precision != null ? `, precisión ±${(adv.precision * 100).toFixed(1)} pp` : ""
                      }.`}
                  {result && ` ${Math.round(result.ms)} ms.`}
                </div>
              )}
            </div>

            <div className="panel">
              <h3>Patrones de hoy</h3>
              <div className="exc-patterns">
                {data.patterns.map((name, i) => {
                  const f = data.formations[name] ?? [];
                  const xs = f.map((c) => c.x);
                  const ys = f.map((c) => c.y);
                  const x0 = Math.min(...xs);
                  const y0 = Math.min(...ys);
                  const w = Math.max(...xs) - x0 + 1;
                  const h = Math.max(...ys) - y0 + 1;
                  const status = an?.consistent ? an.patternStatus[i] : "none";
                  return (
                    <div
                      key={`${name}-${i}`}
                      className={`exc-mini exc-mini-${status}`}
                      title={
                        status === "located"
                          ? `${name}: ubicado (posición segura)`
                          : status === "partial"
                            ? `${name}: parcialmente descubierto`
                            : name
                      }
                      style={{ gridTemplateColumns: `repeat(${w}, 22px)`, gridTemplateRows: `repeat(${h}, 22px)` }}
                    >
                      {f.map((c, k) => (
                        <i
                          key={k}
                          title={c.item}
                          style={{
                            gridColumn: c.x - x0 + 1,
                            gridRow: c.y - y0 + 1,
                            background: `color-mix(in srgb, ${color(c.item)} 35%, var(--panel-2))`,
                          }}
                        >
                          <ItemIcon src={icons[c.item]} name={c.item} text="" size={18} />
                        </i>
                      ))}
                    </div>
                  );
                })}
              </div>
              <div className="muted exc-legend">
                <span className="exc-dot exc-dot-located" /> ubicado <span className="exc-dot exc-dot-partial" /> parcialmente
                descubierto
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
