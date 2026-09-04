import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { CatalogMiner, InventoryItem, TargetUnit } from "./types";

/** Celdas totales: 1ª sala = 96, cada sala a partir de la 2ª aporta 144.
 *  Un minero ocupa `width` celdas (1 o 2). */
export const roomsToCells = (rooms: number): number => 96 + (Math.max(1, rooms) - 1) * 144;
export const MAX_ROOMS = 4;

export type InvSort = "recent" | "power" | "bonus" | "quantity";
export const INV_SORTS: { value: InvSort; label: string }[] = [
  { value: "recent", label: "Más reciente" },
  { value: "power", label: "Poder" },
  { value: "bonus", label: "Bonus" },
  { value: "quantity", label: "Cantidad" },
];

interface State {
  inventory: Record<string, InventoryItem>;
  invSort: InvSort;
  targetNum: string;
  targetUnit: TargetUnit;
  rooms: number;

  addFromCatalog: (m: CatalogMiner, qty?: number) => void;
  addPlanned: (m: CatalogMiner, qty?: number) => void;
  addCustom: (m: Omit<InventoryItem, "quantity"> & { quantity: number }) => void;
  setQuantity: (id: string, qty: number) => void;
  setInRoom: (id: string, n: number) => void;
  setPlanned: (id: string, n: number) => void;
  applyRoom: (counts: Record<string, number>) => void;
  mergeParsedInventory: (
    items: Array<Record<string, unknown>>,
    replace: boolean,
  ) => void;
  loadState: (data: { rooms?: unknown; inventory: Array<Record<string, unknown>> }) => void;
  remove: (id: string) => void;
  clearInventory: () => void;

  setInvSort: (v: InvSort) => void;
  setTargetNum: (v: string) => void;
  setTargetUnit: (v: TargetUnit) => void;
  setRooms: (v: number) => void;
}

const nextOrder = (inv: Record<string, InventoryItem>): number => {
  const orders = Object.values(inv).map((i) => i.order ?? 0);
  return (orders.length ? Math.max(...orders) : 0) + 1;
};

export const useStore = create<State>()(
  persist(
    (set) => ({
      inventory: {},
      invSort: "recent",
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
                order: nextOrder(s.inventory),
              };
          return { inventory: { ...s.inventory, [m.id]: item } };
        }),

      addPlanned: (m, qty = 1) =>
        set((s) => {
          const cur = s.inventory[m.id];
          const item: InventoryItem = cur
            ? { ...cur, planned: (cur.planned ?? 0) + qty }
            : {
                id: m.id,
                name: m.name,
                level: m.level,
                power: m.power,
                bonus_bp: m.bonus_bp,
                width: m.width,
                quantity: 0,
                planned: qty,
                image: m.image,
                order: nextOrder(s.inventory),
              };
          return { inventory: { ...s.inventory, [m.id]: item } };
        }),

      addCustom: (m) =>
        set((s) => ({
          inventory: {
            ...s.inventory,
            [m.id]: { order: nextOrder(s.inventory), ...m },
          },
        })),

      setQuantity: (id, qty) =>
        set((s) => {
          const cur = s.inventory[id];
          if (!cur) return s;
          const q = Math.max(0, Math.floor(qty) || 0);
          if (q === 0 && (cur.planned ?? 0) === 0) {
            const { [id]: _drop, ...rest } = s.inventory;
            return { inventory: rest };
          }
          return {
            inventory: {
              ...s.inventory,
              [id]: { ...cur, quantity: q, inRoom: Math.min(cur.inRoom ?? 0, q) },
            },
          };
        }),

      setInRoom: (id, n) =>
        set((s) => {
          const cur = s.inventory[id];
          if (!cur) return s;
          const clamped = Math.max(0, Math.min(Math.floor(n) || 0, cur.quantity));
          return { inventory: { ...s.inventory, [id]: { ...cur, inRoom: clamped } } };
        }),

      setPlanned: (id, n) =>
        set((s) => {
          const cur = s.inventory[id];
          if (!cur) return s;
          const p = Math.max(0, Math.floor(n) || 0);
          if (p === 0 && cur.quantity === 0) {
            const { [id]: _drop, ...rest } = s.inventory;
            return { inventory: rest };
          }
          return { inventory: { ...s.inventory, [id]: { ...cur, planned: p } } };
        }),

      applyRoom: (counts) =>
        set((s) => {
          const inv: Record<string, InventoryItem> = {};
          for (const [id, cur] of Object.entries(s.inventory)) {
            const c = Math.max(0, Math.floor(counts[id] ?? 0));
            if (c <= cur.quantity) {
              inv[id] = { ...cur, inRoom: c };
            } else {
              // faltan copias: se "adquieren" las planeadas necesarias
              const need = c - cur.quantity;
              const fromPlanned = Math.min(cur.planned ?? 0, need);
              inv[id] = {
                ...cur,
                quantity: c,
                planned: (cur.planned ?? 0) - fromPlanned,
                inRoom: c,
              };
            }
          }
          return { inventory: inv };
        }),

      mergeParsedInventory: (items, replace) =>
        set((s) => {
          const num = (v: unknown, def = 0): number => {
            const n = Math.floor(Number(v));
            return Number.isFinite(n) ? n : def;
          };
          const inv: Record<string, InventoryItem> = {};
          for (const [id, it] of Object.entries(s.inventory)) {
            inv[id] = replace ? { ...it, quantity: 0, inRoom: 0 } : { ...it };
          }
          let ord = nextOrder(s.inventory) - 1;
          for (const p of items) {
            const id = String(p.id ?? "").trim();
            if (!id) continue;
            const qty = Math.max(0, num(p.quantity));
            const cur = inv[id];
            if (cur) {
              const q = replace ? qty : cur.quantity + qty;
              inv[id] = { ...cur, quantity: q, inRoom: Math.min(cur.inRoom ?? 0, q) };
            } else {
              inv[id] = {
                id,
                name: String(p.name ?? ""),
                level: num(p.level),
                power: String(p.power ?? "0"),
                bonus_bp: num(p.bonus_bp),
                width: Math.max(1, num(p.width, 1)),
                quantity: qty,
                image: p.image ? String(p.image) : undefined,
                order: ++ord,
              };
            }
          }
          for (const [id, it] of Object.entries(inv)) {
            if (it.quantity <= 0 && (it.planned ?? 0) <= 0) delete inv[id];
          }
          return { inventory: inv };
        }),

      loadState: (data) =>
        set((s) => {
          const num = (v: unknown, def = 0): number => {
            const n = Math.floor(Number(v));
            return Number.isFinite(n) ? n : def;
          };
          const inv: Record<string, InventoryItem> = {};
          let ord = 0;
          for (const raw of Array.isArray(data.inventory) ? data.inventory : []) {
            const id = String(raw.id ?? "").trim();
            if (!id) continue;
            const quantity = Math.max(0, num(raw.quantity));
            const planned = Math.max(0, num(raw.planned));
            if (quantity === 0 && planned === 0) continue;
            const width = Math.max(1, num(raw.width, 1));
            const inRoom = Math.min(quantity, Math.max(0, num(raw.inRoom)));
            inv[id] = {
              id,
              name: String(raw.name ?? ""),
              level: num(raw.level),
              power: String(raw.power ?? "0"),
              bonus_bp: num(raw.bonus_bp),
              width,
              quantity,
              inRoom: inRoom || undefined,
              planned: planned || undefined,
              image: raw.image ? String(raw.image) : undefined,
              order: raw.order != null ? num(raw.order) : ++ord,
            };
          }
          const rooms =
            data.rooms != null
              ? Math.min(MAX_ROOMS, Math.max(1, num(data.rooms, 1)))
              : s.rooms;
          return { inventory: inv, rooms };
        }),

      remove: (id) =>
        set((s) => {
          const { [id]: _drop, ...rest } = s.inventory;
          return { inventory: rest };
        }),

      clearInventory: () => set({ inventory: {} }),

      setInvSort: (v) => set({ invSort: v }),
      setTargetNum: (v) => set({ targetNum: v }),
      setTargetUnit: (v) => set({ targetUnit: v }),
      setRooms: (v) => set({ rooms: Math.min(MAX_ROOMS, Math.max(1, Math.floor(v))) }),
    }),
    { name: "roller-optimizer" },
  ),
);

/** Inventario completo tal cual (sin ordenar) — para exportar / snapshots. */
export const selectInventoryList = (s: State): InventoryItem[] =>
  Object.values(s.inventory);

/** Lista para el optimizador: copias efectivas = quantity + planned. */
export const selectOptimizeList = (s: State): InventoryItem[] =>
  Object.values(s.inventory)
    .map((i) => ({ ...i, quantity: i.quantity + (i.planned ?? 0) }))
    .filter((i) => i.quantity > 0);

/** Mineros que tengo puestos en la sala ahora mismo (inRoom > 0). */
export const selectRoomList = (s: State): InventoryItem[] =>
  Object.values(s.inventory).filter((i) => (i.inRoom ?? 0) > 0);

/** Mineros con copias disponibles fuera de la sala (quantity - inRoom > 0). */
export const selectBenchList = (s: State): InventoryItem[] =>
  Object.values(s.inventory).filter((i) => i.quantity - (i.inRoom ?? 0) > 0);

/** Mineros que planeo adquirir (planned > 0). */
export const selectPlannedList = (s: State): InventoryItem[] =>
  Object.values(s.inventory).filter((i) => (i.planned ?? 0) > 0);

const cmpBig = (a: string, b: string): number => {
  const x = BigInt(a);
  const y = BigInt(b);
  return x < y ? -1 : x > y ? 1 : 0;
};

const byName = (a: InventoryItem, b: InventoryItem): number =>
  a.name.localeCompare(b.name) || a.level - b.level;

/** Ordena para mostrar según el criterio elegido (desc, con desempate por nombre). */
export function sortInventory(list: InventoryItem[], mode: InvSort): InventoryItem[] {
  const arr = [...list];
  switch (mode) {
    case "power":
      return arr.sort((a, b) => cmpBig(b.power, a.power) || byName(a, b));
    case "bonus":
      return arr.sort((a, b) => b.bonus_bp - a.bonus_bp || byName(a, b));
    case "quantity":
      return arr.sort((a, b) => b.quantity - a.quantity || byName(a, b));
    default: // "recent": último agregado arriba
      return arr.sort((a, b) => (b.order ?? 0) - (a.order ?? 0) || byName(a, b));
  }
}
