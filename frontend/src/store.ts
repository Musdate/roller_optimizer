import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { CatalogMiner, InventoryItem, TargetUnit } from "./types";

/** Celdas por sala: 1ª sala = 96, cada sala extra +48. Un minero ocupa `width`
 *  celdas (1 o 2). */
export const roomsToCells = (rooms: number): number => 96 + (Math.max(1, rooms) - 1) * 48;
export const MAX_ROOMS = 4;

interface State {
  inventory: Record<string, InventoryItem>;
  targetNum: string;
  targetUnit: TargetUnit;
  rooms: number;

  addFromCatalog: (m: CatalogMiner, qty?: number) => void;
  addCustom: (m: Omit<InventoryItem, "quantity"> & { quantity: number }) => void;
  setQuantity: (id: string, qty: number) => void;
  remove: (id: string) => void;
  clearInventory: () => void;

  setTargetNum: (v: string) => void;
  setTargetUnit: (v: TargetUnit) => void;
  setRooms: (v: number) => void;
}

export const useStore = create<State>()(
  persist(
    (set) => ({
      inventory: {},
      targetNum: "1",
      targetUnit: "PH",
      rooms: 1,

      addFromCatalog: (m, qty = 1) =>
        set((s) => {
          const cur = s.inventory[m.id];
          const item: InventoryItem = cur
            ? { ...cur, quantity: cur.quantity + qty }
            : {
                id: m.id,
                name: m.name,
                level: m.level,
                power: m.power,
                bonus_bp: m.bonus_bp,
                width: m.width,
                quantity: qty,
                image: m.image,
              };
          return { inventory: { ...s.inventory, [m.id]: item } };
        }),

      addCustom: (m) =>
        set((s) => ({ inventory: { ...s.inventory, [m.id]: { ...m } } })),

      setQuantity: (id, qty) =>
        set((s) => {
          if (!s.inventory[id]) return s;
          if (qty <= 0) {
            const { [id]: _drop, ...rest } = s.inventory;
            return { inventory: rest };
          }
          return {
            inventory: {
              ...s.inventory,
              [id]: { ...s.inventory[id], quantity: Math.floor(qty) },
            },
          };
        }),

      remove: (id) =>
        set((s) => {
          const { [id]: _drop, ...rest } = s.inventory;
          return { inventory: rest };
        }),

      clearInventory: () => set({ inventory: {} }),

      setTargetNum: (v) => set({ targetNum: v }),
      setTargetUnit: (v) => set({ targetUnit: v }),
      setRooms: (v) => set({ rooms: Math.min(MAX_ROOMS, Math.max(1, Math.floor(v))) }),
    }),
    { name: "roller-optimizer" },
  ),
);

export const selectInventoryList = (s: State): InventoryItem[] =>
  Object.values(s.inventory).sort(
    (a, b) => a.name.localeCompare(b.name) || a.level - b.level,
  );
