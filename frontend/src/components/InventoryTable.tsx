import { useState } from "react";
import type { DragEvent } from "react";
import {
  useStore,
  selectInventoryList,
  selectBenchList,
  sortInventory,
  INV_SORTS,
} from "../store";
import type { InvSort } from "../store";
import { bpToPct, formatPower, formatExactGh } from "../power";
import { inventoryTotals } from "../calc";
import MinerSprite from "./MinerSprite";
import { ROOM_DND_MIME } from "./RoomRacks";
import { useDragState } from "../dragState";
import type { CatalogMiner } from "../types";

export default function InventoryTable() {
  const fullList = useStore(selectInventoryList);
  const benchRaw = useStore(selectBenchList);
  const invSort = useStore((s) => s.invSort);
  const setInvSort = useStore((s) => s.setInvSort);
  const addFromCatalog = useStore((s) => s.addFromCatalog);
  const placeInRoomAt = useStore((s) => s.placeInRoomAt);
  const unplaceFromRoom = useStore((s) => s.unplaceFromRoom);
  const remove = useStore((s) => s.remove);
  const clear = useStore((s) => s.clearInventory);
  const setDraggingWidth = useDragState((s) => s.setWidth);
  const [term, setTerm] = useState("");

  const sorted = sortInventory(benchRaw, invSort);
  const list = term.trim()
    ? sorted.filter((it) => it.name.toLowerCase().includes(term.trim().toLowerCase()))
    : sorted;
  const totals = inventoryTotals(fullList);

  const acceptRoomDrop = (e: DragEvent) => {
    e.preventDefault();
    setDraggingWidth(null);
    try {
      const raw = e.dataTransfer.getData(ROOM_DND_MIME);
      if (!raw) return;
      const p = JSON.parse(raw) as { source: string; index?: number; miner?: CatalogMiner };
      if (p.source === "room" && p.index != null) unplaceFromRoom(p.index);
      else if (p.source === "catalog" && p.miner) addFromCatalog(p.miner, 1);
    } catch {
      // dato de drag no reconocido, ignorar
    }
  };

  return (
    <div
      className="panel"
      style={{ height: 596, display: "flex", flexDirection: "column" }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={acceptRoomDrop}
    >
      <div className="row between">
        <h2>Mi inventario</h2>
        <div className="row">
          <select
            className="tiny"
            value={invSort}
            onChange={(e) => setInvSort(e.target.value as InvSort)}
            title="Ordenar por"
          >
            {INV_SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <button className="tiny" onClick={clear} disabled={!fullList.length}>
            vaciar
          </button>
        </div>
      </div>

      {fullList.length > 0 && (
        <input
          style={{ width: "100%", margin: "8px 0" }}
          placeholder="Buscar por nombre…"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
        />
      )}

      {fullList.length === 0 ? (
        <div className="muted" style={{ padding: "12px 0" }}>
          Añade mineros desde el catálogo →
        </div>
      ) : list.length === 0 ? (
        <div className="muted" style={{ padding: "12px 0" }}>
          {term.trim() ? "Ningún minero coincide con la búsqueda." : "Todos tus mineros están en la sala."}
        </div>
      ) : (
        <div className="scroll" style={{ flex: 1, minHeight: 0, maxHeight: "none" }}>
          <table>
            <thead>
              <tr>
                <th>Minero</th>
                <th className="num">Poder</th>
                <th className="num">Bonus</th>
                <th className="num">Tengo</th>
                <th className="num">Sala</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.map((it) => (
                <tr key={it.id}>
                  <td>
                    <div
                      className="row"
                      style={{ gap: 6, flexWrap: "nowrap", cursor: "grab" }}
                      draggable
                      title="Arrastra a la sala (o haz clic) para ponerlo"
                      onDragStart={(e) => {
                        e.dataTransfer.setData(
                          ROOM_DND_MIME,
                          JSON.stringify({ source: "bench", id: it.id }),
                        );
                        e.dataTransfer.setData("text/plain", it.name ?? "");
                        e.dataTransfer.effectAllowed = "copy";
                        setDraggingWidth(it.width);
                      }}
                      onDragEnd={() => setDraggingWidth(null)}
                      onClick={() => placeInRoomAt(it.id)}
                    >
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
                  <td className="num">{it.quantity}</td>
                  <td className="num">{it.inRoom ?? 0}</td>
                  <td className="num">
                    <button className="tiny" onClick={() => remove(it.id)}>
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {fullList.length > 0 && (
        <div className="stat-row" style={{ marginTop: 10 }}>
          <div className="stat">
            <span className="k">Poder final</span>
            <span className="v">{formatPower(totals.finalPower)}</span>
          </div>
          <div className="stat">
            <span className="k">Mineros</span>
            <span className="v">{formatPower(totals.rawPower)}</span>
          </div>
          <div className="stat">
            <span className="k">Bonus</span>
            <span className="v">+{bpToPct(totals.bonusBp)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
