import { useEffect, useMemo, useState } from "react";
import { optimize, errMsg } from "../api";
import { useStore, selectOptimizeList, roomsToCells, MAX_ROOMS } from "../store";
import { parsePower } from "../power";
import type { OptimizeResponse, TargetUnit } from "../types";
import ResultView from "./ResultView";

const UNITS: TargetUnit[] = ["PH", "EH", "ZH"];
const ROOM_OPTS = Array.from({ length: MAX_ROOMS }, (_, i) => i + 1);
const TIME_LIMIT_S = 60;

export default function OptimizePanel() {
  const list = useStore(selectOptimizeList);
  const {
    targetNum,
    setTargetNum,
    targetUnit,
    setTargetUnit,
    rooms,
    setRooms,
  } = useStore();
  const maxCells = roomsToCells(rooms);

  const [result, setResult] = useState<OptimizeResponse | null>(null);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [allowMerges, setAllowMerges] = useState(false);
  const excludedMerges = useStore((s) => s.excludedMerges);
  const includeMerge = useStore((s) => s.includeMerge);

  useEffect(() => {
    if (!running) return;
    setElapsed(0);
    const t0 = Date.now();
    const id = window.setInterval(
      () => setElapsed(Math.min(TIME_LIMIT_S, Math.round((Date.now() - t0) / 1000))),
      250,
    );
    return () => window.clearInterval(id);
  }, [running]);

  const parsed = useMemo(() => {
    try {
      const v = parsePower(`${targetNum} ${targetUnit}`);
      if (v <= 0n) return { ok: false as const, msg: "El objetivo debe ser mayor a 0" };
      return { ok: true as const, value: v };
    } catch (e) {
      return { ok: false as const, msg: errMsg(e) };
    }
  }, [targetNum, targetUnit]);

  async function run() {
    if (!parsed.ok) return;
    setRunning(true);
    setErr(null);
    try {
      const res = await optimize({
        target_final_power: parsed.value.toString(),
        max_slots: maxCells,
        slot_mode: "cells",
        time_limit_s: TIME_LIMIT_S,
        allow_merges: allowMerges,
        excluded_merges: excludedMerges.map((e) => e.from_id),
        inventory: list,
      });
      setResult(res);
    } catch (e) {
      setErr(errMsg(e));
      setResult(null);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="panel">
      <h2>Optimizar</h2>

      <div className="row" style={{ margin: "8px 0", alignItems: "flex-end" }}>
        <label className="stat" style={{ flex: 1, minWidth: 160 }}>
          <span className="k">Poder final objetivo</span>
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

      {!parsed.ok && <div className="err">{parsed.msg}</div>}

      <div className="row" style={{ marginTop: 12 }}>
        <button
          className="primary"
          onClick={run}
          disabled={running || !parsed.ok || list.length === 0}
        >
          {running ? `optimizando sala…  ${elapsed}s / máx ${TIME_LIMIT_S}s` : "Optimizar sala"}
        </button>
        {result && (
          <button className="tiny" style={{ alignSelf: "flex-end" }} onClick={() => setResult(null)}>
            limpiar
          </button>
        )}
      </div>
      {running && (
        <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
          El solver busca la mejor combinación exacta.
        </div>
      )}
      {list.length === 0 && (
        <span className="muted" style={{ marginLeft: 8 }}>
          añade mineros al inventario primero
        </span>
      )}

      {err && <div className="err" style={{ marginTop: 10 }}>{err}</div>}
      {result && <ResultView result={result} onApplied={() => setResult(null)} />}
    </div>
  );
}
