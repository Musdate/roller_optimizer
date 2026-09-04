import { useState } from "react";
import type { DragEvent } from "react";
import { useStore, selectRoomSlots } from "../store";
import { useDragState } from "../dragState";
import MinerSprite from "./MinerSprite";
import { bpToPct, formatPower, formatExactGh } from "../power";
import { totalsFor } from "../calc";
import type { CatalogMiner } from "../types";

// Rack real de RollerCoin: 4 estantes, 2 celdas por estante (8 celdas/rack).
// Sala 1 = 96 celdas -> 12 racks: 8 arriba + 4 abajo.
// La imagen se sirve local (public/racks/rack-1.png) en vez de hotlinkear
// static.rollercoin.com: ese dominio termina bloqueado por ad-blockers y
// listas anti-cryptominer (es literalmente "rollercoin"), y al fallar la
// carga la altura del contenedor (height:auto atada al <img>) colapsaba a 0
// y se llevaba puestos los slots superpuestos -> sala invisible e
// imposible de arrastrar. Con el archivo local + aspect-ratio fijo por CSS
// la geometría no depende de que la imagen llegue a cargar.
const RACK_IMG = "/racks/rack-1.png";
const RACK_IMG_RATIO = "76 / 100"; // dimensiones reales del PNG (recortado 25px por lado), sin deformar
const SHELVES_PER_RACK = 4;
const TOP_RACKS = 8;
const BOTTOM_RACKS = 4;
const ROOM1_RACKS = TOP_RACKS + BOTTOM_RACKS;

interface ShelfInfo {
  li: number;
  ri: number;
  leftId: string | null;
  rightId: string | null;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** `slots` (1 entrada por celda física) -> estantes de 2 celdas -> racks de
 *  4 estantes. Al ser posicional, cada celda ya sabe su lugar: no hace falta
 *  ningún algoritmo de reflujo como antes. */
function buildRacks(slots: (string | null)[]): ShelfInfo[][] {
  const shelves: ShelfInfo[] = [];
  for (let li = 0; li < slots.length; li += 2) {
    shelves.push({ li, ri: li + 1, leftId: slots[li], rightId: slots[li + 1] ?? null });
  }
  return chunk(shelves, SHELVES_PER_RACK);
}

interface DragPayload {
  source: "bench" | "room" | "catalog";
  id?: string;
  index?: number;
  miner?: CatalogMiner;
}
export const ROOM_DND_MIME = "application/x-rc-slot";

export default function RoomRacks() {
  const slots = useStore(selectRoomSlots);
  const inventory = useStore((s) => s.inventory);
  const addFromCatalog = useStore((s) => s.addFromCatalog);
  const placeInRoomAt = useStore((s) => s.placeInRoomAt);
  const unplaceFromRoom = useStore((s) => s.unplaceFromRoom);
  const reorderRoomSlot = useStore((s) => s.reorderRoomSlot);
  const draggingWidth = useDragState((s) => s.width);
  const setDraggingWidth = useDragState((s) => s.setWidth);
  const [overKey, setOverKey] = useState<string | null>(null);
  const [selectedCell, setSelectedCell] = useState<number | null>(null);

  const racks = buildRacks(slots);
  const topRow = racks.slice(0, TOP_RACKS);
  const bottomRow = racks.slice(TOP_RACKS, ROOM1_RACKS);

  const totals = totalsFor(
    Object.values(inventory)
      .filter((it) => (it.inRoom ?? 0) > 0)
      .map((it) => ({ item: it, count: it.inRoom ?? 0 })),
  );

  // Se resuelve contra `slots` en cada render: si la celda seleccionada se
  // vació por otra vía (drag, tabla, etc.) la card de info desaparece sola.
  const selectedId = selectedCell != null ? slots[selectedCell] : null;
  const selectedItem = selectedId ? inventory[selectedId] : null;

  const readPayload = (e: DragEvent): DragPayload | null => {
    try {
      const raw = e.dataTransfer.getData(ROOM_DND_MIME);
      return raw ? (JSON.parse(raw) as DragPayload) : null;
    } catch {
      return null;
    }
  };

  // El destino real (snap a inicio de estante para minero de 2 celdas, o
  // primer hueco si la celda pedida ya no está libre) lo resuelve la store;
  // acá solo pasamos la celda exacta donde se soltó.
  //
  // El resalte de "estoy arrastrando" se limpia ACÁ (no solo en onDragEnd
  // del elemento de origen): si el drop dispara un cambio de estado que
  // hace que React reemplace/desmonte ese elemento de origen (p.ej. una
  // fila del banco que desaparece porque ya no queda ninguna copia suelta),
  // el navegador puede no llegar a disparar "dragend" ahí, y el resalte se
  // queda prendido para siempre. onDrop, en cambio, siempre corre.
  const dropOn = (cellIndex: number) => (e: DragEvent) => {
    e.preventDefault();
    setOverKey(null);
    setDraggingWidth(null);
    const p = readPayload(e);
    if (!p) return;
    if (p.source === "bench" && p.id) {
      placeInRoomAt(p.id, cellIndex);
    } else if (p.source === "room" && p.index != null) {
      reorderRoomSlot(p.index, cellIndex);
    } else if (p.source === "catalog" && p.miner) {
      // arrastrado directo desde el catálogo: se agrega al inventario (o se
      // suma 1 si ya lo tenías) y de una se pone en esta celda.
      addFromCatalog(p.miner, 1);
      placeInRoomAt(p.miner.id, cellIndex);
    }
  };

  const renderCell = (cellIndex: number, id: string | null, width: number) => {
    const key = String(cellIndex);
    const isOver = overKey === key;

    if (id == null) {
      // Resalte de 1 celda: solo mientras se arrastra un minero de 1 celda.
      // El de 2 celdas (estante libre completo) se pinta en el .rack-shelf,
      // para que se vea como una sola celda doble y no dos cuadrados sueltos.
      // El ".drag-over" por celda (hover puntual) también se apaga durante
      // un arrastre de 2 celdas: si no, la mitad bajo el cursor se resalta
      // sola y da la impresión de "puedo soltarlo a la izq. o a la der."
      // como si fueran dos opciones de 1 celda, en vez de una sola de 2.
      const isTarget = draggingWidth === 1;
      const showOver = isOver && draggingWidth !== 2;
      return (
        <div
          key={key}
          className={`rack-slot empty${isTarget ? " drag-target" : ""}${showOver ? " drag-over" : ""}`}
          style={{ flex: 1 }}
          onDragOver={(e) => {
            e.preventDefault();
            setOverKey(key);
          }}
          onDragLeave={() => setOverKey((v) => (v === key ? null : v))}
          onDrop={dropOn(cellIndex)}
        />
      );
    }

    const it = inventory[id];
    const isSelected = selectedCell === cellIndex;
    return (
      <div
        key={key}
        className={`rack-slot filled${isOver ? " drag-over" : ""}${isSelected ? " selected" : ""}`}
        style={{ flex: width }}
        draggable
        title={`${it?.name ?? id} — click para ver info, arrastra fuera de la sala para quitarlo`}
        onDragStart={(e) => {
          e.dataTransfer.setData(
            ROOM_DND_MIME,
            JSON.stringify({ source: "room", index: cellIndex } satisfies DragPayload),
          );
          e.dataTransfer.setData("text/plain", it?.name ?? "");
          e.dataTransfer.effectAllowed = "move";
          setDraggingWidth(width);
        }}
        onDragEnd={() => setDraggingWidth(null)}
        onDragOver={(e) => {
          e.preventDefault();
          setOverKey(key);
        }}
        onDragLeave={() => setOverKey((v) => (v === key ? null : v))}
        onDrop={dropOn(cellIndex)}
        onClick={() => setSelectedCell((v) => (v === cellIndex ? null : cellIndex))}
      >
        {it && <MinerSprite url={it.image ?? ""} width={it.width} size={26} level={it.level} />}
      </div>
    );
  };

  const renderShelf = (shelf: ShelfInfo, key: string) => {
    const { li, ri, leftId, rightId } = shelf;
    const leftWidth = leftId ? inventory[leftId]?.width ?? 1 : 1;
    const isPair = leftId != null && leftId === rightId && leftWidth === 2;
    const shelfIsTarget = draggingWidth === 2 && leftId == null && rightId == null;

    return (
      <div className={`rack-shelf${shelfIsTarget ? " shelf-target" : ""}`} key={key}>
        {isPair ? renderCell(li, leftId, 2) : (
          <>
            {renderCell(li, leftId, 1)}
            {renderCell(ri, rightId, 1)}
          </>
        )}
      </div>
    );
  };

  const renderRack = (rack: ShelfInfo[], ri: number) => (
    <div className="rack" key={ri} style={{ aspectRatio: RACK_IMG_RATIO }}>
      <img className="rack-img" src={RACK_IMG} alt="" draggable={false} />
      <div className="rack-shelves">
        {rack.map((shelf, si) => renderShelf(shelf, `${ri}-${si}`))}
      </div>
    </div>
  );

  return (
    <div>
      <div className="room-racks-grid">
        <div className="room-racks-row">{topRow.map(renderRack)}</div>
        <div className="room-racks-row">{bottomRow.map(renderRack)}</div>
      </div>

      {selectedItem && selectedCell != null && (
        <div className="room-selected">
          <MinerSprite
            url={selectedItem.image ?? ""}
            width={selectedItem.width}
            size={40}
            level={selectedItem.level}
          />
          <div className="room-selected-info">
            <span className="name-row">
              {selectedItem.name || <span className="muted">custom</span>}
            </span>
            <span className="muted" title={formatExactGh(BigInt(selectedItem.power))}>
              {formatPower(BigInt(selectedItem.power))} · +{bpToPct(selectedItem.bonus_bp)} ·{" "}
              {selectedItem.width} celda{selectedItem.width > 1 ? "s" : ""}
            </span>
          </div>
          <div className="col-btns">
            <button
              className="tiny"
              onClick={() => {
                unplaceFromRoom(selectedCell);
                setSelectedCell(null);
              }}
            >
              Quitar de la sala
            </button>
            <button className="tiny" onClick={() => setSelectedCell(null)}>
              Cerrar
            </button>
          </div>
        </div>
      )}

      <div
        className={`room-bench-drop muted${overKey === "bench" ? " drag-over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOverKey("bench");
        }}
        onDragLeave={() => setOverKey((v) => (v === "bench" ? null : v))}
        onDrop={(e) => {
          e.preventDefault();
          setOverKey(null);
          setDraggingWidth(null);
          const p = readPayload(e);
          if (p?.source === "room" && p.index != null) unplaceFromRoom(p.index);
        }}
      >
        Suelta aquí (o sobre “Mi inventario” ↓) un minero de la sala para sacarlo.
      </div>

      <div className="room-summary">
        <div className="stat-hero">
          <span className="k">Poder final</span>
          <span className="v">{formatPower(totals.finalPower)}</span>
        </div>
        <div className="stat-row">
          <div className="stat">
            <span className="k">Mineros</span>
            <span className="v">{formatPower(totals.rawPower)}</span>
          </div>
          <div className="stat">
            <span className="k">Bonus</span>
            <span className="v">+{bpToPct(totals.bonusBp)}</span>
          </div>
        </div>
      </div>

    </div>
  );
}
