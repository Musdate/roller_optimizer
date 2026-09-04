import type { DragEvent } from "react";
import { useStore, selectPlannedList, sortInventory } from "../store";
import { bpToPct, formatPower, formatExactGh } from "../power";
import { totalsFor } from "../calc";
import MinerSprite from "./MinerSprite";
import { ROOM_DND_MIME } from "./RoomRacks";
import { useDragState } from "../dragState";
import type { CatalogMiner } from "../types";

export default function PlannedTable() {
  const rawList = useStore(selectPlannedList);
  const invSort = useStore((s) => s.invSort);
  const setPlanned = useStore((s) => s.setPlanned);
  const clearPlanned = useStore((s) => s.clearPlanned);
  const addPlanned = useStore((s) => s.addPlanned);
  const setDraggingWidth = useDragState((s) => s.setWidth);

  const list = sortInventory(rawList, invSort);
  const totals = totalsFor(list.map((it) => ({ item: it, count: it.planned ?? 0 })));

  const acceptCatalogDrop = (e: DragEvent) => {
    e.preventDefault();
    setDraggingWidth(null);
    try {
      const raw = e.dataTransfer.getData(ROOM_DND_MIME);
      if (!raw) return;
      const p = JSON.parse(raw) as { source: string; miner?: CatalogMiner };
      if (p.source === "catalog" && p.miner) addPlanned(p.miner, 1);
    } catch {
      // dato de drag no reconocido, ignorar
    }
  };

  return (
    <div className="panel" onDragOver={(e) => e.preventDefault()} onDrop={acceptCatalogDrop}>
      <div className="row between">
        <h2>Nueva adquisición</h2>
        <div className="row">
          {list.length > 0 && (
            <span className="pill" title="Se suman al inventario al optimizar la sala">
              +{totals.miners} mineros
            </span>
          )}
          <button className="tiny" onClick={clearPlanned} disabled={!list.length}>
            vaciar
          </button>
        </div>
      </div>

      {list.length === 0 ? (
        <div className="muted" style={{ padding: "12px 0" }}>
          Marca mineros que planeas obtener con “planeo” en el catálogo. El
          optimizador los tendrá en cuenta como si ya los tuvieras.
        </div>
      ) : (
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Minero</th>
                <th className="num">Poder</th>
                <th className="num">Bonus</th>
                <th className="num">Planeo</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.map((it) => (
                <tr key={it.id}>
                  <td>
                    <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                      <MinerSprite
                        url={it.image ?? ""}
                        width={it.width}
                        size={28}
                        level={it.level}
                        title={`${it.width} celda${it.width > 1 ? "s" : ""}`}
                      />
                      <span className="name-row">
                        {it.name || <span className="muted">custom</span>}
                      </span>
                    </div>
                  </td>
                  <td className="num" title={formatExactGh(BigInt(it.power))}>
                    {formatPower(BigInt(it.power))}
                  </td>
                  <td className="num">+{bpToPct(it.bonus_bp)}</td>
                  <td className="num">
                    <input
                      type="number"
                      min={0}
                      value={it.planned ?? 0}
                      style={{ width: 56 }}
                      onChange={(e) => setPlanned(it.id, Number(e.target.value))}
                    />
                  </td>
                  <td className="num">
                    <button className="tiny" onClick={() => setPlanned(it.id, 0)}>
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
