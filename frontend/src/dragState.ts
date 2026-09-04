import { create } from "zustand";

/** Ancho (celdas) del minero que se está arrastrando ahora mismo, para que
 *  la sala visual resalte todos los slots vacíos compatibles mientras dura
 *  el drag. Deliberadamente NO persistido: es puro estado de UI efímero,
 *  compartido entre InventoryTable (origen del drag) y RoomRacks (destino). */
interface DragState {
  width: number | null;
  setWidth: (w: number | null) => void;
}

export const useDragState = create<DragState>((set) => ({
  width: null,
  setWidth: (w) => set({ width: w }),
}));
