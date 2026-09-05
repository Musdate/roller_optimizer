import { useState } from "react";
import { bpToPct, formatPower, formatExactGh } from "../power";
import { useStore } from "../store";
import { totalsFor } from "../calc";
import MinerSprite from "./MinerSprite";
import type { OptimizeResponse } from "../types";

const STATUS_LABEL: Record<string, string> = {
  optimal: "óptimo demostrado",
  feasible: "válida · óptimo no demostrado",
  infeasible: "sin solución",
  unknown: "desconocido",
};

export default function ResultView({ result: r }: { result: OptimizeResponse }) {
  const inventory = useStore((s) => s.inventory);
  const applyRoom = useStore((s) => s.applyRoom);
  const [selId, setSelId] = useState<string | null>(null);

  const pct = Math.min(100, r.headroom_pct);

  // Estado de la sala actual (antes de aplicar este resultado).
  const roomNow: Record<string, number> = {};
  for (const it of Object.values(inventory)) {
    if ((it.inRoom ?? 0) > 0) roomNow[it.id] = it.inRoom ?? 0;
  }
  const pickCounts: Record<string, number> = {};
  for (const p of r.picks) pickCounts[p.id] = p.count;

  // Mineros que estaban en la sala y ya no aparecen en la optimización.
  const removed = Object.values(inventory).filter(
    (it) => (it.inRoom ?? 0) > 0 && !pickCounts[it.id],
  );

  // La combinación propuesta puede usar mineros distintos a los que ya
  // tenías puestos y aun así no mejorar nada (mismo poder final, mismo
  // bonus) -- comparar solo por id/cantidad (como antes) no detecta eso.
  // Se compara contra el resultado real de la sala actual (mismo criterio
  // que usa el propio solver: más poder final gana, y a igualdad de poder,
  // menos bonus usado) para no ofrecer "cambios" que no cambian nada.
  const roomTotals = totalsFor(
    Object.values(inventory)
      .filter((it) => (it.inRoom ?? 0) > 0)
      .map((it) => ({ item: it, count: it.inRoom ?? 0 })),
  );
  const noPicks = r.picks.length === 0;
  const improved =
    !noPicks &&
    (BigInt(r.final_power) > roomTotals.finalPower ||
      (BigInt(r.final_power) === roomTotals.finalPower && r.bonus_bp < roomTotals.bonusBp));

  function useAsRoom() {
    applyRoom(pickCounts);
  }

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
          <span className="k">Mineros</span>
          <span className="v">{formatPower(BigInt(r.raw_power))}</span>
        </div>
        <div className="stat">
          <span className="k">Bonus</span>
          <span className="v">+{bpToPct(r.bonus_bp)}</span>
        </div>
      </div>

      <div className="bar" style={{ margin: "6px 0 14px" }}>
        <span style={{ width: `${pct}%` }} />
      </div>

      {!improved ? (
        <div className="muted" style={{ padding: "6px 0" }}>
          {noPicks
            ? "Ninguna combinación mejora la sala vacía bajo ese objetivo."
            : "Tu sala actual ya está optimizada — no se encontró ninguna combinación mejor."}
        </div>
      ) : (
        <>
          <div className="row between" style={{ marginBottom: 6 }}>
            <h3 style={{ margin: 0 }}>Sala optimizada</h3>
            <button className="tiny" onClick={useAsRoom}>
              usar como sala
            </button>
          </div>

          <table>
            <thead>
              <tr>
                <th>Minero</th>
                <th className="num">Cantidad</th>
                <th className="num">Poder c/u</th>
                <th className="num">Poder total</th>
                <th className="num">Bonus</th>
              </tr>
            </thead>
            <tbody>
              {r.picks.map((p) => {
                const isNew = !roomNow[p.id];
                const owned = inventory[p.id]?.quantity ?? 0;
                const toBuy = Math.max(0, p.count - owned);
                return (
                  <tr
                    key={p.id}
                    className={selId === p.id ? "row-sel" : undefined}
                    onClick={() => setSelId((cur) => (cur === p.id ? null : p.id))}
                    style={{ cursor: "pointer" }}
                  >
                    <td>
                      <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                        <MinerSprite
                          url={inventory[p.id]?.image ?? ""}
                          width={p.width}
                          size={28}
                          level={p.level}
                        />
                        <span className="name-row">
                          {p.name || <span className="muted">custom</span>}
                          {isNew && <span className="tag new">Nuevo</span>}
                          {toBuy > 0 && <span className="tag buy">comprar {toBuy}</span>}
                        </span>
                      </div>
                    </td>
                    <td className="num">{p.count}</td>
                    <td className="num">{formatPower(BigInt(p.power))}</td>
                    <td className="num">{formatPower(BigInt(p.power) * BigInt(p.count))}</td>
                    <td className="num">+{bpToPct(p.bonus_bp)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {removed.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <h3 style={{ marginBottom: 6 }}>Sale de la sala</h3>
              <table>
                <tbody>
                  {removed.map((it) => (
                    <tr key={it.id}>
                      <td>
                        <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                          <MinerSprite url={it.image ?? ""} width={it.width} size={28} level={it.level} />
                          <span className="name-row">
                            {it.name || <span className="muted">custom</span>}
                            <span className="tag remove">Quitar de sala</span>
                          </span>
                        </div>
                      </td>
                      <td className="num">{it.inRoom ?? 0} en sala</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
