import { create } from "zustand";
import { useStore } from "./store";
import type { InventoryItem } from "./types";

/** Deshacer de una sola acción destructiva del optimizador (vaciar
 *  inventario, vaciar nueva adquisición, aplicar sala optimizada). Guarda un
 *  snapshot del `inventory` previo. Deliberadamente NO persistido: el ofrecer
 *  "Deshacer" solo tiene sentido dentro de la misma sesión. */
interface UndoState {
  entry: { label: string; inventory: Record<string, InventoryItem> } | null;
  offer: (label: string, inventory: Record<string, InventoryItem>) => void;
  apply: () => void;
  clear: () => void;
}

export const useUndo = create<UndoState>((set, get) => ({
  entry: null,
  offer: (label, inventory) => set({ entry: { label, inventory } }),
  apply: () => {
    const { entry } = get();
    if (!entry) return;
    useStore.setState({ inventory: entry.inventory });
    set({ entry: null });
  },
  clear: () => set({ entry: null }),
}));
