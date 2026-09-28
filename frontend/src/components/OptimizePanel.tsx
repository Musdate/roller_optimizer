import { useEffect, useMemo, useRef, useState } from "react";
import { errMsg, fetchLeagues, optimizeStatus, startOptimize, stopOptimize } from "../api";
import { useStore, selectOptimizeList, roomsToCells, MAX_ROOMS } from "../store";
import { formatPower, leagueUnit, parsePower } from "../power";
import type {
  League,
  OptimizeJobStatus,
  OptimizePhase,
  OptimizeRequestBody,
  OptimizeResponse,
  TargetUnit,
} from "../types";
import ResultView from "./ResultView";

const UNITS: TargetUnit[] = ["PH", "EH", "ZH"];
const ROOM_OPTS = Array.from({ length: MAX_ROOMS }, (_, i) => i + 1);
const TIME_LIMIT_S = 300;
const POLL_MS = 1000;
const CUSTOM = "custom";

const PHASE_LABEL: Record<OptimizePhase, string> = {
  raw: "Buscando el mayor poder bruto dentro del margen",
  final: "Desempate: mayor poder final",
  fallback: "Nada llega al margen: buscando el mayor poder final",
  tiebreak: "Desempate: menos bonus",
  miners: "Desempate: menos mineros",
  "": "Preparando…",
};

const fmtClock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** "49.500 y 49.999 EH/s". El tope se trunca: redondeado, el de una liga
 *  (p. ej. 50 EH/s − 1 GH/s) se vería como el mínimo de la siguiente. */
function searchRange(floor: bigint, cap: bigint): string {
  const lo = formatPower(floor);
  const hi = formatPower(cap, 3, true);
  const unit = (s: string) => s.slice(s.indexOf(" "));
  return unit(lo) === unit(hi) ? `${lo.slice(0, lo.indexOf(" "))} y ${hi}` : `${lo} y ${hi}`;
}

/** Liga que contiene `power` (la última cuyo mínimo no lo supera). */
function leagueFor(leagues: League[], power: bigint): League | undefined {
  return leagues.filter((l) => BigInt(l.min_power) <= power).pop();
}

export default function OptimizePanel() {
  const list = useStore(selectOptimizeList);
  const {
    targetNum,
    setTargetNum,
    targetUnit,
    setTargetUnit,
    targetMode,
    setTargetMode,
    leagueLevel,
    setLeagueLevel,
    marginPct,
    setMarginPct,
    rooms,
    setRooms,
  } = useStore();
  const maxCells = roomsToCells(rooms);

  const [leagues, setLeagues] = useState<League[] | null>(null);
  const [result, setResult] = useState<OptimizeResponse | null>(null);
  // pedido que produjo el resultado: "¿cuánto aporta?" lo repite sin un merge
  const [request, setRequest] = useState<OptimizeRequestBody | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<OptimizeJobStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [allowMerges, setAllowMerges] = useState(false);
  const excludedMerges = useStore((s) => s.excludedMerges);
  const includeMerge = useStore((s) => s.includeMerge);
  const running = jobId !== null;

  const custom = useMemo(() => {
    try {
      const v = parsePower(`${targetNum} ${targetUnit}`);
      if (v <= 0n) return { ok: false as const, msg: "El poder tope debe ser mayor a 0." };
      return { ok: true as const, value: v };
    } catch (e) {
      return { ok: false as const, msg: errMsg(e) };
    }
  }, [targetNum, targetUnit]);

  useEffect(() => {
    // Sin servidor (el aviso general ya lo informa) se reintenta hasta que responda.
    let cancelled = false;
    let timer: number | undefined;
    const load = () =>
      fetchLeagues()
        .then((rows) => !cancelled && setLeagues(rows))
        .catch(() => {
          if (!cancelled) timer = window.setTimeout(load, 5000);
        });
    load();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  // Primera vez: se preselecciona la liga que contiene el poder personalizado guardado.
  useEffect(() => {
    if (!leagues?.length || leagueLevel !== null) return;
    const l = (custom.ok && leagueFor(leagues, custom.value)) || leagues[0];
    setLeagueLevel(l.level);
  }, [leagues, leagueLevel, custom, setLeagueLevel]);

  const league = leagues?.find((l) => l.level === leagueLevel);

  const margin = useMemo(() => {
    const n = Number(marginPct.replace(",", "."));
    if (marginPct.trim() === "" || !Number.isFinite(n) || n < 0 || n > 100)
      return { ok: false as const, msg: "El margen debe estar entre 0 y 100 %." };
    return { ok: true as const, bp: Math.round(n * 100) };
  }, [marginPct]);

  // Tope (null = sin tope) o el motivo por el que no se puede optimizar.
  const target = useMemo(():
    | { ok: true; cap: bigint | null }
    | { ok: false; msg: string; pending?: boolean } => {
    if (targetMode === CUSTOM) return custom.ok ? { ok: true, cap: custom.value } : custom;
    if (!league)
      return leagues
        ? { ok: false, msg: "Elige una liga." }
        : { ok: false, msg: "Cargando ligas…", pending: true };
    return { ok: true, cap: league.max_power === null ? null : BigInt(league.max_power) };
  }, [targetMode, custom, league, leagues]);

  // Unidad fija para los valores del resultado (RULES.md §5.9).
  const unit =
    targetMode === CUSTOM ? targetUnit : leagueUnit(league ? BigInt(league.min_power) : 0n);

  const floor =
    target.ok && target.cap !== null && margin.ok
      ? target.cap - (target.cap * BigInt(margin.bp)) / 10000n
      : null;

  // Consulta el trabajo en curso; también le sirve de heartbeat al backend.
  const polling = useRef(false);
  useEffect(() => {
    if (!jobId) return;
    const tick = async () => {
      if (polling.current) return;
      polling.current = true;
      try {
        const st = await optimizeStatus(jobId);
        setStatus(st);
        if (st.state === "done") {
          setResult(st.result);
          setJobId(null);
        } else if (st.state === "error") {
          setErr(st.error);
          setJobId(null);
        }
      } catch (e) {
        setErr(errMsg(e));
        setJobId(null);
      } finally {
        polling.current = false;
      }
    };
    tick();
    const id = window.setInterval(tick, POLL_MS);
    return () => window.clearInterval(id);
  }, [jobId]);

  async function run() {
    if (!target.ok || !margin.ok) return;
    setErr(null);
    setStatus(null);
    try {
      const body: OptimizeRequestBody = {
        target_final_power: target.cap === null ? null : target.cap.toString(),
        margin_bp: margin.bp,
        max_slots: maxCells,
        slot_mode: "cells",
        time_limit_s: TIME_LIMIT_S,
        allow_merges: allowMerges,
        excluded_merges: excludedMerges.map((e) => e.from_id),
        inventory: list,
      };
      const { job_id } = await startOptimize(body);
      setResult(null);
      setRequest(body);
      setJobId(job_id);
    } catch (e) {
      setErr(errMsg(e));
    }
  }

  async function stop() {
    if (!jobId) return;
    try {
      setStatus(await stopOptimize(jobId));
    } catch (e) {
      setErr(errMsg(e));
    }
  }

  const invalid = !target.ok ? target.msg : !margin.ok ? margin.msg : null;

  return (
    <div className="panel">
      <h2>Optimizar</h2>

      <div className="row" style={{ margin: "8px 0", alignItems: "flex-end" }}>
        <label className="stat" style={{ flex: 1, minWidth: 160 }}>
          <span className="k">Liga objetivo</span>
          <div className="row" style={{ flexWrap: "nowrap", gap: 6 }}>
            {targetMode !== CUSTOM && league?.image && (
              <img src={league.image} alt="" width={22} height={22} />
            )}
            <select
              value={targetMode === CUSTOM ? CUSTOM : leagues ? (leagueLevel ?? "") : ""}
              onChange={(e) => {
                if (e.target.value === CUSTOM) {
                  setTargetMode("custom");
                } else {
                  setTargetMode("league");
                  setLeagueLevel(Number(e.target.value));
                }
              }}
              style={{ flex: 1, minWidth: 0 }}
            >
              <option value={CUSTOM}>Personalizado</option>
              {!leagues && <option value="">cargando…</option>}
              {leagues?.map((l) => (
                <option key={l.level} value={l.level}>
                  {l.title}
                </option>
              ))}
            </select>
          </div>
        </label>

        <label className="stat" style={{ width: 90 }}>
          <span className="k">Margen %</span>
          <input
            type="number"
            min={0}
            max={100}
            step="any"
            value={marginPct}
            onChange={(e) => setMarginPct(e.target.value)}
          />
        </label>

        <label className="stat">
          <span className="k">Salas</span>
          <select value={rooms} onChange={(e) => setRooms(Number(e.target.value))}>
            {ROOM_OPTS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>

      {targetMode === CUSTOM && (
        <label className="stat" style={{ margin: "0 0 8px" }}>
          <span className="k">Poder final tope</span>
          <div className="row" style={{ flexWrap: "nowrap" }}>
            <input
              type="number"
              min={0}
              step="any"
              value={targetNum}
              onChange={(e) => setTargetNum(e.target.value)}
              style={{ flex: 1, minWidth: 0 }}
            />
            <select
              value={targetUnit}
              onChange={(e) => setTargetUnit(e.target.value as TargetUnit)}
            >
              {UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}/s
                </option>
              ))}
            </select>
          </div>
        </label>
      )}

      {target.ok && (
        <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
          {target.cap === null ? (
            <>Sin tope: se busca el mayor poder bruto.</>
          ) : (
            floor !== null && <>La búsqueda será entre {searchRange(floor, target.cap)}</>
          )}
        </div>
      )}

      <label className="row" style={{ gap: 6, fontSize: 13, cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={allowMerges}
          onChange={(e) => setAllowMerges(e.target.checked)}
        />
        permitir merges
      </label>
      {allowMerges && excludedMerges.length > 0 && (
        <details style={{ fontSize: 12, marginTop: 4 }}>
          <summary className="muted" style={{ cursor: "pointer" }}>
            Merges descartados ({excludedMerges.length})
          </summary>
          <div className="row" style={{ gap: 6, marginTop: 4 }}>
          {excludedMerges.map((e) => (
            <span key={e.from_id} className="tag merge">
              {e.from_name} nivel {e.from_level} → {e.from_level + 1}
              <button
                className="tiny"
                title="volver a permitir este merge"
                onClick={() => includeMerge(e.from_id)}
                style={{ marginLeft: 4, padding: "0 4px" }}
              >
                ✕
              </button>
            </span>
          ))}
          </div>
        </details>
      )}

      {invalid && (
        <div className={!target.ok && target.pending ? "muted" : "err"}>{invalid}</div>
      )}

      <div className="row" style={{ marginTop: 12 }}>
        <button
          className="primary"
          onClick={run}
          disabled={running || invalid !== null || list.length === 0}
        >
          {running ? "optimizando sala…" : "Optimizar sala"}
        </button>
        {running && (
          <button onClick={stop} disabled={status?.stopping}>
            {status?.stopping ? "deteniendo…" : "Detener"}
          </button>
        )}
        {result && !running && (
          <button className="tiny" style={{ alignSelf: "flex-end" }} onClick={() => setResult(null)}>
            limpiar
          </button>
        )}
      </div>
      {running && <Progress status={status} unit={unit} />}
      {list.length === 0 && (
        <span className="muted" style={{ marginLeft: 8 }}>
          añade mineros al inventario primero
        </span>
      )}

      {err && <div className="err" style={{ marginTop: 10 }}>{err}</div>}
      {result && request && (
        <ResultView
          result={result}
          request={request}
          unit={unit}
          onApplied={() => setResult(null)}
        />
      )}
    </div>
  );
}

/** Qué poder maximiza cada pasada (las de desempate no informan valores). */
const PHASE_POWER: Partial<Record<OptimizePhase, string>> = {
  raw: "de poder bruto",
  final: "de poder final",
  fallback: "de poder final",
};

function Progress({ status, unit }: { status: OptimizeJobStatus | null; unit: string }) {
  const elapsed = status?.elapsed_s ?? 0;
  const limit = status?.time_limit_s ?? TIME_LIMIT_S;
  const best = status?.best ? BigInt(status.best) : null;
  const bound = status?.bound ? BigInt(status.bound) : null;
  const fmt = (v: bigint) => formatPower(v, 3, false, unit);
  // mejor / máximo posible, truncado: 100 % solo cuando ya está demostrado
  const surePct =
    best !== null && bound !== null && bound > 0n
      ? Math.min(100, Number((best * 1000n) / bound) / 10)
      : null;
  return (
    <div style={{ marginTop: 8, fontSize: 12 }}>
      <div className="row between">
        <span>
          {status?.stopping
            ? "Deteniendo: terminando los desempates…"
            : PHASE_LABEL[status?.phase ?? ""]}
        </span>
        <span className="muted">
          {fmtClock(elapsed)} / máx {fmtClock(limit)}
        </span>
      </div>
      <div className="bar" style={{ margin: "4px 0" }}>
        <span style={{ width: `${Math.min(100, (elapsed / limit) * 100)}%` }} />
      </div>
      {best !== null && (
        <div style={{ margin: "6px 0 4px" }}>
          <div>
            Mejor sala encontrada: <b>{fmt(best)}</b> {PHASE_POWER[status?.phase ?? ""] ?? ""}
          </div>
          {bound !== null && surePct !== null && (
            <>
              <div className="muted">
                El máximo posible es {fmt(bound)} o menos · seguro al {surePct.toFixed(1)} %
              </div>
              <div className="bar" style={{ margin: "4px 0" }}>
                <span style={{ width: `${surePct}%` }} />
              </div>
            </>
          )}
        </div>
      )}
      <div className="muted">
        Puedes detener cuando quieras: te quedas con la mejor solución encontrada.
      </div>
    </div>
  );
}
