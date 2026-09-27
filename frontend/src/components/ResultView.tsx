import { useState } from "react";
import { bpToPct, formatPower, formatExactGh } from "../power";
import { useStore } from "../store";
import { useUndo } from "../undoState";
import { totalsFor } from "../calc";
import { errMsg, runOptimizeJob } from "../api";
import MinerSprite from "./MinerSprite";
import type { Merge, OptimizeRequestBody, OptimizeResponse } from "../types";

/** Tope del cálculo de "¿cuánto aporta?" (RULES.md §5.9). */
const MERGE_VALUE_LIMIT_S = 60;

type MergeValue =
  | { state: "loading" }
  | { state: "done"; raw: bigint; final: bigint; exact: boolean }
  | { state: "error"; msg: string };

const STATUS_LABEL: Record<string, string> = {
  optimal: "óptimo demostrado",
  optimal_primary: "óptimo demostrado · desempate sin demostrar",
  feasible: "válida · óptimo no demostrado",
  infeasible: "sin solución",
  unknown: "desconocido",
};

export default function ResultView({
  result: r,
  request,
  unit,
  onApplied,
}: {
  result: OptimizeResponse;
  request: OptimizeRequestBody;
  /** Unidad de la liga para "¿cuánto aporta?" (RULES.md §5.9). */
  unit: string;
  onApplied: () => void;
}) {
  const inventory = useStore((s) => s.inventory);
  const applyRoom = useStore((s) => s.applyRoom);
  const offerUndo = useUndo((s) => s.offer);
  const excludedMerges = useStore((s) => s.excludedMerges);
  const excludeMerge = useStore((s) => s.excludeMerge);
  const includeMerge = useStore((s) => s.includeMerge);
  const isExcluded = (id: string) => excludedMerges.some((e) => e.from_id === id);
  const pendingDiscards = r.merges.some((mg) => isExcluded(mg.from_id));

  const discardButton = (mg: Merge) =>
    isExcluded(mg.from_id) ? (
      <button className="tiny" onClick={() => includeMerge(mg.from_id)}>
        deshacer
      </button>
    ) : (
      <button
        className="tiny"
        title="no proponer este merge en las próximas optimizaciones"
        onClick={() =>
          excludeMerge({ from_id: mg.from_id, from_name: mg.from_name, from_level: mg.from_level })
        }
      >
        descartar
      </button>
    );
  const [selId, setSelId] = useState<string | null>(null);

  const pct = Math.min(100, r.headroom_pct);

  // Estado de la sala actual (antes de aplicar este resultado).
  const roomNow: Record<string, number> = {};
  for (const it of Object.values(inventory)) {
    if ((it.inRoom ?? 0) > 0) roomNow[it.id] = it.inRoom ?? 0;
  }
  const pickCounts: Record<string, number> = {};
  for (const p of r.picks) pickCounts[p.id] = p.count;
  // copias que ganan (+) o pierden (−) los modelos por los merges propuestos
  const mergeDelta: Record<string, number> = {};
  for (const mg of r.merges) {
    mergeDelta[mg.from_id] = (mergeDelta[mg.from_id] ?? 0) - 2 * mg.count;
    mergeDelta[mg.to.id] = (mergeDelta[mg.to.id] ?? 0) + mg.count;
  }

  // Mineros que estaban en la sala y salen (todas o algunas de sus copias).
  // Las que consume un merge no se "quitan": van al merge (RULES.md §5.7).
  const removed = Object.values(inventory)
    .map((it) => {
      const out = (it.inRoom ?? 0) - (pickCounts[it.id] ?? 0);
      const toMerge = Math.min(Math.max(out, 0), Math.max(0, -(mergeDelta[it.id] ?? 0)));
      return { it, out, toMerge, toRemove: out - toMerge };
    })
    .filter(({ out }) => out > 0);

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

  // Merges agrupados por minero: una fila por cadena, con el nivel final
  // (los niveles intermedios no quedan en la sala). "Descartar" y "¿cuánto
  // aporta?" actúan sobre el paso final.
  const mergeGroups = Object.values(
    r.merges.reduce<Record<string, Merge[]>>((acc, mg) => {
      (acc[mg.from_name] ??= []).push(mg);
      return acc;
    }, {}),
  ).map((steps) => {
    steps.sort((x, y) => y.from_level - x.from_level);
    return {
      name: steps[0].from_name,
      steps,
      merges: steps.reduce((n, mg) => n + mg.count, 0),
    };
  });

  // "¿cuánto aporta?" (RULES.md §5.9): el mismo pedido sin ese merge, solo la
  // pasada principal. Aporte = bruto que pierde la sala sin él.
  const [values, setValues] = useState<Record<string, MergeValue>>({});
  async function evaluateMerge(fromId: string) {
    setValues((v) => ({ ...v, [fromId]: { state: "loading" } }));
    try {
      const alt = await runOptimizeJob({
        ...request,
        excluded_merges: [...request.excluded_merges, fromId],
        primary_only: true,
        time_limit_s: MERGE_VALUE_LIMIT_S,
      });
      setValues((v) => ({
        ...v,
        [fromId]: {
          state: "done",
          raw: BigInt(r.raw_power) - BigInt(alt.raw_power),
          final: BigInt(r.final_power) - BigInt(alt.final_power),
          exact: alt.status === "optimal",
        },
      }));
    } catch (e) {
      setValues((v) => ({ ...v, [fromId]: { state: "error", msg: errMsg(e) } }));
    }
  }
  const [queue, setQueue] = useState<string[]>([]);
  const [queueTotal, setQueueTotal] = useState(0);
  const evaluating = queue.length > 0;
  const tops = mergeGroups.map((g) => g.steps[0].from_id);
  const pendingTops = tops.filter((id) => values[id]?.state !== "done");
  async function evaluateAll() {
    const ids = pendingTops;
    setQueue(ids);
    setQueueTotal(ids.length);
    for (const id of ids) {
      await evaluateMerge(id);
      setQueue((q) => q.filter((x) => x !== id));
    }
  }

  const noPicks = r.picks.length === 0;
  // Comparación de RULES.md §5.7: primero dónde cae cada sala respecto a la
  // ventana, después en cascada (el primer criterio que difiere decide). Los
  // poderes se comparan COMO SE MUESTRAN: si las dos salas se ven como
  // "49.999 EH/s", una diferencia de ~0.0001 EH no es una mejora real.
  const resultFinal = BigInt(r.final_power);
  const resultRaw = BigInt(r.raw_power);
  const cap = r.target_final_power === null ? null : BigInt(r.target_final_power);
  const floor = BigInt(r.floor_power);
  const roomOverCap = cap !== null && roomTotals.finalPower > cap;
  const roomInWindow = !roomOverCap && roomTotals.finalPower >= floor;
  // en la unidad de la liga, igual que la tabla comparativa (RULES.md §5.7)
  const fmt = (v: bigint) => formatPower(v, 3, false, unit);
  const shownGreater = (a: bigint, b: bigint) => fmt(a) !== fmt(b) && a > b;
  const shownDiffers = (a: bigint, b: bigint) => fmt(a) !== fmt(b);
  const pickMiners = r.picks.reduce((n, p) => n + p.count, 0);
  const fewerMiners = pickMiners < roomTotals.miners;
  const improved =
    !noPicks &&
    (roomOverCap
      ? true
      : r.in_window !== roomInWindow
        ? r.in_window
        : r.in_window
          ? shownDiffers(resultRaw, roomTotals.rawPower)
            ? shownGreater(resultRaw, roomTotals.rawPower)
            : shownDiffers(resultFinal, roomTotals.finalPower)
              ? shownGreater(resultFinal, roomTotals.finalPower)
              : fewerMiners
          : shownDiffers(resultFinal, roomTotals.finalPower)
            ? shownGreater(resultFinal, roomTotals.finalPower)
            : r.bonus_bp !== roomTotals.bonusBp
              ? r.bonus_bp < roomTotals.bonusBp
              : resultRaw !== roomTotals.rawPower
                ? resultRaw > roomTotals.rawPower
                : fewerMiners);

  function useAsRoom() {
    offerUndo("Sala optimizada aplicada.", inventory);
    applyRoom(pickCounts, r.merges);
    onApplied();
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

      {cap !== null && (
        <div className="bar" style={{ marginTop: 6 }}>
          <span style={{ width: `${pct}%` }} />
        </div>
      )}
      <div className="muted" style={{ fontSize: 12, margin: "4px 0 14px" }}>
        {cap !== null && (
          <>
            {r.headroom_pct.toFixed(1)}% del tope
            {r.headroom !== null && BigInt(r.headroom) > 0n && (
              <> · faltan {formatPower(BigInt(r.headroom))}</>
            )}
            {" · "}
          </>
        )}
        {r.in_window
          ? "dentro del margen: se priorizó el poder bruto"
          : "ninguna combinación llega al margen: se priorizó el poder final"}
      </div>

      {improved && (
        <div className="opt-compare">
        <table>
          <thead>
            <tr>
              <th></th>
              <th className="num">Actual</th>
              <th className="num">Optimizada</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Poder final</td>
              <td className="num">{fmt(roomTotals.finalPower)}</td>
              <td className="num">
                {fmt(resultFinal)}
                {resultFinal !== roomTotals.finalPower && (
                  <span className={`opt-delta ${resultFinal > roomTotals.finalPower ? "up" : "down"}`}>
                    {resultFinal > roomTotals.finalPower ? "+" : ""}
                    {fmt(resultFinal - roomTotals.finalPower)}
                  </span>
                )}
              </td>
            </tr>
            <tr>
              <td>Poder mineros</td>
              <td className="num">{fmt(roomTotals.rawPower)}</td>
              <td className="num">
                {fmt(resultRaw)}
                {resultRaw !== roomTotals.rawPower && (
                  <span className={`opt-delta ${resultRaw > roomTotals.rawPower ? "up" : "down"}`}>
                    {resultRaw > roomTotals.rawPower ? "+" : "−"}
                    {fmt(
                      resultRaw > roomTotals.rawPower
                        ? resultRaw - roomTotals.rawPower
                        : roomTotals.rawPower - resultRaw,
                    )}
                  </span>
                )}
              </td>
            </tr>
            <tr>
              <td>Bonus</td>
              <td className="num">+{bpToPct(roomTotals.bonusBp)}</td>
              <td className="num">
                +{bpToPct(r.bonus_bp)}
                {r.bonus_bp !== roomTotals.bonusBp && (
                  <span className={`opt-delta ${r.bonus_bp < roomTotals.bonusBp ? "up" : ""}`}>
                    {r.bonus_bp > roomTotals.bonusBp ? "+" : "−"}
                    {bpToPct(Math.abs(r.bonus_bp - roomTotals.bonusBp))}
                  </span>
                )}
              </td>
            </tr>
            {pickMiners !== roomTotals.miners && (
              <tr>
                <td>Mineros</td>
                <td className="num">{roomTotals.miners}</td>
                <td className="num">
                  {pickMiners}
                  <span className={`opt-delta ${fewerMiners ? "up" : ""}`}>
                    {pickMiners > roomTotals.miners ? "+" : "−"}
                    {Math.abs(pickMiners - roomTotals.miners)}
                  </span>
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      )}

      {!improved ? (
        noPicks ? (
          <div className="muted" style={{ padding: "6px 0" }}>
            Ninguna combinación mejora la sala vacía bajo ese tope.
          </div>
        ) : (
          <div className="opt-done">
            <span className="opt-done-check">✓</span>
            <div className="opt-done-text">
              <b>Tu sala ya está optimizada</b>
              <span>No hay ninguna combinación mejor para ese tope.</span>
            </div>
          </div>
        )
      ) : (
        <>
          {r.merges.length > 0 && (
            <div className="merge-box">
              <div className="row between">
                <h3 style={{ margin: 0 }}>Merges a hacer</h3>
                {(evaluating || pendingTops.length > 0) && (
                  <button
                    className="tiny"
                    disabled={evaluating}
                    title="vuelve a optimizar sin cada merge para ver cuánto poder de mineros pierde la sala"
                    onClick={evaluateAll}
                  >
                    {evaluating
                      ? `calculando… ${queueTotal - queue.length + 1}/${queueTotal}`
                      : "¿cuánto aportan?"}
                  </button>
                )}
              </div>
              <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
                Paso previo: hazlos antes de armar la sala.
              </div>
              <table>
                <tbody>
                  {mergeGroups.map((g) => {
                    const top = g.steps[0];
                    return (
                        <tr key={g.name} style={isExcluded(top.from_id) ? { opacity: 0.45 } : undefined}>
                          <td>
                            <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                              <MinerSprite url={top.to.image} width={top.to.width} size={28} level={top.to.level} />
                              <span className="name-row">
                                {g.name}
                                <span className="tag merge">{g.merges} merge</span>
                              </span>
                            </div>
                          </td>
                          <td className="num">
                            <MergeValueCell
                              unit={unit}
                              value={values[top.from_id]}
                              queued={queue.includes(top.from_id)}
                              disabled={evaluating}
                              onEvaluate={() => evaluateMerge(top.from_id)}
                            />
                          </td>
                          <td className="num">{discardButton(top)}</td>
                        </tr>
                    );
                  })}
                </tbody>
              </table>
              {pendingDiscards && (
                <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                  Optimiza de nuevo para aplicar los descartes.
                </div>
              )}
            </div>
          )}

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
                const inRoomBefore = roomNow[p.id] ?? 0;
                const addedToRoom = p.count - inRoomBefore;
                const fromMerge = (mergeDelta[p.id] ?? 0) > 0;
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
                          url={inventory[p.id]?.image || p.image || ""}
                          width={p.width}
                          size={28}
                          level={p.level}
                        />
                        <span className="name-row">
                          {p.name || <span className="muted">Personalizado</span>}
                          {inRoomBefore === 0 && (
                            <span className="tag new">
                              {p.count > 1 ? `+${p.count} Nuevos` : "Nuevo"}
                            </span>
                          )}
                          {inRoomBefore > 0 && addedToRoom > 0 && (
                            <span className="tag new">
                              +{addedToRoom} nuevo{addedToRoom > 1 ? "s" : ""}
                            </span>
                          )}
                          {addedToRoom < 0 && (
                            <span className="tag remove">
                              −{-addedToRoom} sale{addedToRoom < -1 ? "n" : ""}
                            </span>
                          )}
                          {fromMerge && <span className="tag merge">merge</span>}
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
                  {removed.map(({ it, toMerge, toRemove }) => (
                    <tr key={it.id}>
                      <td>
                        <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                          <MinerSprite url={it.image ?? ""} width={it.width} size={28} level={it.level} />
                          <span className="name-row">
                            {it.name || <span className="muted">Personalizado</span>}
                            {toMerge > 0 && (
                              <span className="tag merge">Usar {toMerge} en el merge</span>
                            )}
                            {toRemove > 0 && (
                              <span className="tag remove">Quitar {toRemove} de sala</span>
                            )}
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

function MergeValueCell({
  unit,
  value,
  queued,
  disabled,
  onEvaluate,
}: {
  unit: string;
  value: MergeValue | undefined;
  queued: boolean;
  disabled: boolean;
  onEvaluate: () => void;
}) {
  if (!value) return queued ? <span className="muted">en espera</span> : null;
  if (value.state === "loading") return <span className="muted">calculando…</span>;
  if (value.state === "error")
    return (
      <span className="err" title={value.msg}>
        No se pudo calcular ·{" "}
        <button className="tiny" disabled={disabled} onClick={onEvaluate}>
          reintentar
        </button>
      </span>
    );
  const fin = value.final;
  return (
    <span
      title={
        "Poder de mineros que pierde la sala si no haces este merge" +
        ` (poder final: ${fin >= 0n ? "+" : "−"}${formatPower(fin >= 0n ? fin : -fin, 3, false, unit)})` +
        (value.exact ? "" : ". Aproximado: la optimización sin el merge no se demostró óptima.")
      }
    >
      {!value.exact && <span className="muted">≈ </span>}
      <Gain value={value.raw} unit={unit} />
    </span>
  );
}

function Gain({ value, unit }: { value: bigint; unit?: string }) {
  return (
    <span className={`opt-delta ${value >= 0n ? "up" : "down"}`}>
      {value >= 0n ? "+" : "−"}
      {formatPower(value >= 0n ? value : -value, 3, false, unit)}
    </span>
  );
}
