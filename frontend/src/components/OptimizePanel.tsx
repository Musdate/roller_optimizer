import { useMemo, useState } from "react";
import { optimize } from "../api";
import { useStore, selectInventoryList, roomsToCells, MAX_ROOMS } from "../store";
import { parsePower, formatPower, formatExactGh } from "../power";
import type { OptimizeResponse, TargetUnit } from "../types";
import ResultView from "./ResultView";

const UNITS: TargetUnit[] = ["PH", "EH", "ZH"];
const ROOM_OPTS = Array.from({ length: MAX_ROOMS }, (_, i) => i + 1);

export default function OptimizePanel() {
  const list = useStore(selectInventoryList);
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
  const [err, setErr] = useState<string | null>(null);

  const parsed = useMemo(() => {
    try {
      const v = parsePower(`${targetNum} ${targetUnit}`);
      if (v <= 0n) return { ok: false as const, msg: "El objetivo debe ser mayor a 0" };
      return { ok: true as const, value: v };
    } catch (e) {
      return { ok: false as const, msg: String(e) };
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
        time_limit_s: 8,
        inventory: list,
      });
      setResult(res);
    } catch (e) {
      setErr(String(e));
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
          <span className="k">Poder final objetivo (techo)</span>
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

        <div className="stat">
          <span className="k">Salas ({maxCells} celdas)</span>
          <div className="row">
            {ROOM_OPTS.map((n) => (
              <button
                key={n}
                className={rooms === n ? "primary tiny" : "tiny"}
                onClick={() => setRooms(n)}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      </div>

      {parsed.ok ? (
        <div className="muted" style={{ fontSize: 12 }}>
          = {formatPower(parsed.value)} · {formatExactGh(parsed.value)}
        </div>
      ) : (
        <div className="err">{parsed.msg}</div>
      )}

      <button
        className="primary"
        style={{ marginTop: 12 }}
        onClick={run}
        disabled={running || !parsed.ok || list.length === 0}
      >
        {running ? "optimizando…" : "Optimizar sala"}
      </button>
      {list.length === 0 && (
        <span className="muted" style={{ marginLeft: 8 }}>
          añade mineros al inventario primero
        </span>
      )}

      {err && <div className="err" style={{ marginTop: 10 }}>{err}</div>}
      {result && <ResultView result={result} />}
    </div>
  );
}
