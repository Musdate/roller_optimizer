import { bpToPct, formatPower, formatExactGh } from "../power";
import { useStore } from "../store";
import MinerSprite from "./MinerSprite";
import LevelBadge from "./LevelBadge";
import type { OptimizeResponse } from "../types";

const STATUS_LABEL: Record<string, string> = {
  optimal: "óptimo",
  feasible: "mejor encontrado (tiempo agotado)",
  infeasible: "sin solución",
  unknown: "desconocido",
};

export default function ResultView({ result: r }: { result: OptimizeResponse }) {
  const inventory = useStore((s) => s.inventory);
  const pct = Math.min(100, r.headroom_pct);
  return (
    <div style={{ marginTop: 16, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
      <div className="row between">
        <h3>Resultado</h3>
        <span className={`pill status-${r.status}`}>
          {STATUS_LABEL[r.status] ?? r.status} · {r.solve_time_s}s
          {r.scale > 1 && ` · escala ${r.scale}`}
        </span>
      </div>

      <div className="stat-row">
        <div className="stat">
          <span className="k">Poder final</span>
          <span className="v" title={formatExactGh(BigInt(r.final_power))}>
            {formatPower(BigInt(r.final_power))}
          </span>
        </div>
        <div className="stat">
          <span className="k">Objetivo</span>
          <span className="v">{formatPower(BigInt(r.target_final_power))}</span>
        </div>
        <div className="stat">
          <span className="k">Falta para el techo</span>
          <span className="v" title={formatExactGh(BigInt(r.headroom))}>
            {formatPower(BigInt(r.headroom))}
          </span>
        </div>
        <div className="stat">
          <span className="k">Bonus usado</span>
          <span className="v">+{bpToPct(r.bonus_bp)}</span>
        </div>
        <div className="stat">
          <span className="k">Poder bruto</span>
          <span className="v">{formatPower(BigInt(r.raw_power))}</span>
        </div>
        <div className="stat">
          <span className="k">Slots / celdas</span>
          <span className="v">
            {r.slots_used} / {r.cells_used}
          </span>
        </div>
      </div>

      <div className="bar" style={{ margin: "6px 0 14px" }}>
        <span style={{ width: `${pct}%` }} />
      </div>

      <table>
        <thead>
          <tr>
            <th>Minero</th>
            <th className="num">Cant.</th>
            <th className="num">Poder c/u</th>
            <th className="num">Poder total</th>
            <th className="num">Bonus</th>
          </tr>
        </thead>
        <tbody>
          {r.picks.map((p) => (
            <tr key={p.id}>
              <td>
                <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                  <MinerSprite
                    url={inventory[p.id]?.image ?? ""}
                    width={p.width}
                    size={28}
                    animate
                  />
                  <span>
                    {p.name || <span className="muted">custom</span>}{" "}
                    {p.level > 0 && <LevelBadge level={p.level} />}
                  </span>
                </div>
              </td>
              <td className="num">{p.count}</td>
              <td className="num">{formatPower(BigInt(p.power))}</td>
              <td className="num">{formatPower(BigInt(p.power) * BigInt(p.count))}</td>
              <td className="num">+{bpToPct(p.bonus_bp)}</td>
            </tr>
          ))}
          {r.picks.length === 0 && (
            <tr>
              <td colSpan={5} className="muted">
                ninguna combinación mejora la sala vacía bajo ese objetivo
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
