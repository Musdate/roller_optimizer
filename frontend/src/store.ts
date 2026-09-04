import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { CatalogMiner, InventoryItem, RoomImportItem, TargetUnit } from "./types";

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

/** Sala 1 modelada por posición: 1 entrada por celda física (0..95), cada
 *  una con el id del minero que la ocupa o null si está libre. Un minero de
 *  2 celdas ocupa siempre un par alineado a estante (índices 2k y 2k+1) —
 *  así "soltar en la celda X" realmente deja el minero en la celda X, en
 *  vez de reacomodarse siempre al primer hueco (bug de la versión anterior,
 *  que guardaba solo una lista compacta sin huecos). */
export const ROOM1_CELLS = 96; // = roomsToCells(1)

/** Cuenta cuántas copias de cada id hay realmente puestas en `slots`,
 *  agrupando por estante para no contar dos veces un par de 2 celdas. */
function countRoomInstances(
  slots: (string | null)[],
  inv: Record<string, InventoryItem>,
): Record<string, number> {
  const have: Record<string, number> = {};
  for (let shelf = 0; shelf * 2 < slots.length; shelf++) {
    const li = shelf * 2;
    const ri = li + 1;
    const l = slots[li];
    const r = slots[ri];
    if (l && r && l === r && (inv[l]?.width ?? 1) === 2) {
      have[l] = (have[l] ?? 0) + 1;
      continue;
    }
    if (l) have[l] = (have[l] ?? 0) + 1;
    if (r) have[r] = (have[r] ?? 0) + 1;
  }
  return have;
}

/** Primer hueco compatible con `width` (celda suelta, o estante libre
 *  completo si width=2), recorriendo de arriba/izq a abajo/der. */
function findFirstFit(slots: (string | null)[], width: number): number | null {
  if (width >= 2) {
    for (let shelf = 0; shelf * 2 < slots.length; shelf++) {
      const li = shelf * 2;
      if (slots[li] == null && slots[li + 1] == null) return li;
    }
    return null;
  }
  for (let i = 0; i < slots.length; i++) {
    if (slots[i] == null) return i;
  }
  return null;
}

/** Repara `slots` para que coincida con los `inRoom` actuales del
 *  inventario: recorta copias de más (desde el final) y agrega las que
 *  falten en el primer hueco libre. Pura — no muta. */
export function reconcileRoomSlots(
  slots: (string | null)[],
  inv: Record<string, InventoryItem>,
): (string | null)[] {
  const next = slots.slice(0, ROOM1_CELLS);
  while (next.length < ROOM1_CELLS) next.push(null);

  const target: Record<string, number> = {};
  for (const it of Object.values(inv)) {
    const n = it.inRoom ?? 0;
    if (n > 0) target[it.id] = n;
  }

  // ids que ya no existen (o ya no tienen copias en sala) -> fuera
  for (let i = 0; i < next.length; i++) {
    if (next[i] != null && !target[next[i] as string]) next[i] = null;
  }

  // recortar excedentes, de atrás para adelante
  const have = countRoomInstances(next, inv);
  for (const [id, cap] of Object.entries(target)) {
    let excess = (have[id] ?? 0) - cap;
    if (excess <= 0) continue;
    const w = inv[id]?.width ?? 1;
    for (let shelf = Math.floor(next.length / 2) - 1; shelf >= 0 && excess > 0; shelf--) {
      const li = shelf * 2;
      const ri = li + 1;
      if (w === 2 && next[li] === id && next[ri] === id) {
        next[li] = null;
        next[ri] = null;
        excess--;
      } else {
        if (next[ri] === id) {
          next[ri] = null;
          excess--;
          if (excess <= 0) break;
        }
        if (next[li] === id) {
          next[li] = null;
          excess--;
        }
      }
    }
  }

  // agregar las que falten, en el primer hueco compatible
  const have2 = countRoomInstances(next, inv);
  for (const [id, cap] of Object.entries(target)) {
    let missing = cap - (have2[id] ?? 0);
    const w = inv[id]?.width ?? 1;
    while (missing > 0) {
      const spot = findFirstFit(next, w);
      if (spot == null) break; // sala llena
      next[spot] = id;
      if (w === 2) next[spot + 1] = id;
      missing--;
    }
  }

  return next;
}

interface State {
  inventory: Record<string, InventoryItem>;
  invSort: InvSort;
  targetNum: string;
  targetUnit: TargetUnit;
  rooms: number;
  /** Sala 1 por posición: 1 entrada por celda física (0..95). */
  roomSlots: (string | null)[];
  /** userId de RollerCoin para sincronizar la sala real ("recargar sala"). */
  rollercoinUserId: string;

  addFromCatalog: (m: CatalogMiner, qty?: number) => void;
  addPlanned: (m: CatalogMiner, qty?: number) => void;
  addCustom: (m: Omit<InventoryItem, "quantity"> & { quantity: number }) => void;
  setQuantity: (id: string, qty: number) => void;
  setInRoom: (id: string, n: number) => void;
  setPlanned: (id: string, n: number) => void;
  applyRoom: (counts: Record<string, number>) => void;
  /** Reemplaza la sala con lo que la API de RollerCoin dice que está
   *  puesto AHORA en el juego real (ver `importRealRoom`). A diferencia de
   *  `applyRoom` (que arma una sala hipotética con lo que ya tenés
   *  guardado), acá los mineros que estaban puestos y salen de la nueva
   *  lista se van del todo -- no vuelven a "en banco" -- porque este
   *  reemplazo es una foto 1:1 de la sala real, no una reasignación interna
   *  de copias que seguís teniendo. */
  importRoomFromApi: (items: RoomImportItem[], slots: (string | null)[]) => void;
  setRollercoinUserId: (v: string) => void;
  /** Pasa una copia del inventario a la celda dada (drag&drop). Sin celda
   *  (o si está ocupada) cae en el primer hueco compatible. */
  placeInRoomAt: (id: string, atCellIndex?: number) => void;
  /** Saca de la sala lo que ocupa la celda `cellIndex`. */
  unplaceFromRoom: (cellIndex: number) => void;
  /** Mueve dentro de la sala (drag&drop entre celdas). */
  reorderRoomSlot: (fromCellIndex: number, toCellIndex: number) => void;
  mergeParsedInventory: (
    items: Array<Record<string, unknown>>,
    replace: boolean,
  ) => void;
  loadState: (data: { rooms?: unknown; inventory: Array<Record<string, unknown>> }) => void;
  remove: (id: string) => void;
  clearInventory: () => void;
  clearPlanned: () => void;
  /** Refresca nombre/imagen/poder/bonus/width/level de los ítems dados
   *  contra el catálogo actual (quantity/inRoom/planned/order no se tocan). */
  syncWithCatalog: (rows: CatalogMiner[]) => void;

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
      roomSlots: Array(ROOM1_CELLS).fill(null),
      rollercoinUserId: "",

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

      importRoomFromApi: (items, slots) =>
        set((s) => {
          const nextSlots = slots.slice(0, ROOM1_CELLS);
          while (nextSlots.length < ROOM1_CELLS) nextSlots.push(null);

          const inv: Record<string, InventoryItem> = {};
          // arranca solo con lo "en banco" (quantity - inRoom): la parte
          // puesta en sala se descarta entera, la vuelva a mencionar o no
          // la API (si ya no está puesta, se asume que no la tenés más).
          for (const [id, it] of Object.entries(s.inventory)) {
            const bench = Math.max(0, it.quantity - (it.inRoom ?? 0));
            inv[id] = { ...it, quantity: bench, inRoom: 0 };
          }
          let ord = nextOrder(s.inventory) - 1;
          for (const ri of items) {
            const c = Math.max(0, Math.floor(ri.count));
            if (c <= 0) continue;
            const cur = inv[ri.id];
            if (cur) {
              inv[ri.id] = {
                ...cur,
                quantity: cur.quantity + c,
                inRoom: c,
                name: ri.name,
                level: ri.level,
                power: ri.power,
                bonus_bp: ri.bonus_bp,
                width: ri.width,
                image: ri.image,
              };
            } else {
              inv[ri.id] = {
                id: ri.id,
                name: ri.name,
                level: ri.level,
                power: ri.power,
                bonus_bp: ri.bonus_bp,
                width: ri.width,
                quantity: c,
                inRoom: c,
                image: ri.image,
                order: ++ord,
              };
            }
          }
          for (const [id, it] of Object.entries(inv)) {
            if (it.quantity <= 0 && (it.planned ?? 0) <= 0) delete inv[id];
          }
          return { inventory: inv, roomSlots: nextSlots };
        }),

      setRollercoinUserId: (v) => set({ rollercoinUserId: v }),

      placeInRoomAt: (id, atCellIndex) =>
        set((s) => {
          const cur = s.inventory[id];
          if (!cur) return s;
          const inRoomNow = cur.inRoom ?? 0;
          if (inRoomNow >= cur.quantity) return s; // no hay copias libres en inventario
          const slots = reconcileRoomSlots(s.roomSlots, s.inventory);
          const w = cur.width;

          let spot: number | null = null;
          if (atCellIndex != null) {
            if (w >= 2) {
              const shelfStart = atCellIndex - (atCellIndex % 2);
              if (slots[shelfStart] == null && slots[shelfStart + 1] == null) spot = shelfStart;
            } else if (slots[atCellIndex] == null) {
              spot = atCellIndex;
            }
          }
          if (spot == null) spot = findFirstFit(slots, w); // celda pedida ocupada, o sin celda -> primer hueco
          if (spot == null) return s; // sala llena

          const next = [...slots];
          next[spot] = id;
          if (w >= 2) next[spot + 1] = id;
          return {
            inventory: { ...s.inventory, [id]: { ...cur, inRoom: inRoomNow + 1 } },
            roomSlots: next,
          };
        }),

      unplaceFromRoom: (cellIndex) =>
        set((s) => {
          const slots = reconcileRoomSlots(s.roomSlots, s.inventory);
          const id = slots[cellIndex];
          if (id == null) return s;
          const cur = s.inventory[id];
          if (!cur) return s;
          const next = [...slots];
          if (cur.width >= 2) {
            const shelfStart = cellIndex - (cellIndex % 2);
            next[shelfStart] = null;
            next[shelfStart + 1] = null;
          } else {
            next[cellIndex] = null;
          }
          return {
            inventory: {
              ...s.inventory,
              [id]: { ...cur, inRoom: Math.max(0, (cur.inRoom ?? 0) - 1) },
            },
            roomSlots: next,
          };
        }),

      reorderRoomSlot: (fromCellIndex, toCellIndex) =>
        set((s) => {
          const slots = reconcileRoomSlots(s.roomSlots, s.inventory);
          const id = slots[fromCellIndex];
          if (id == null) return s;
          const cur = s.inventory[id];
          if (!cur) return s;
          const w = cur.width;

          const next = [...slots];
          const fromStart = w >= 2 ? fromCellIndex - (fromCellIndex % 2) : fromCellIndex;
          next[fromStart] = null;
          if (w >= 2) next[fromStart + 1] = null;

          let spot: number | null = null;
          if (w >= 2) {
            const shelfStart = toCellIndex - (toCellIndex % 2);
            if (next[shelfStart] == null && next[shelfStart + 1] == null) spot = shelfStart;
          } else if (next[toCellIndex] == null) {
            spot = toCellIndex;
          }
          if (spot == null) spot = findFirstFit(next, w);
          if (spot == null) return s; // no debería pasar: se liberó una celda propia

          next[spot] = id;
          if (w >= 2) next[spot + 1] = id;
          return { roomSlots: next };
        }),

      mergeParsedInventory: (items, replace) =>
        set((s) => {
          const num = (v: unknown, def = 0): number => {
            const n = Math.floor(Number(v));
            return Number.isFinite(n) ? n : def;
          };
          // En RollerCoin, lo que está puesto en la sala NO aparece en el
          // texto que se copia de la página de inventario (son vistas
          // separadas ahí) -> "reemplazar" nunca debe tocarlo. Se arranca
          // la cantidad de cada ítem existente en su `inRoom` (lo puesto,
          // se preserva tal cual) y se resetea solo lo que estaba "en
          // banco" (quantity - inRoom); lo pegado se SUMA desde ahí, así
          // que un id que sigue en lo pegado termina en inRoom + lo nuevo,
          // y uno que no aparece en absoluto se queda solo con lo que
          // tenía en sala (ni se borra ni pierde su lugar), en vez de
          // asumir que ya no lo tenés por no estar en un texto que jamás
          // iba a mencionarlo mientras estuviera puesto.
          const inv: Record<string, InventoryItem> = {};
          for (const [id, it] of Object.entries(s.inventory)) {
            inv[id] = replace ? { ...it, quantity: it.inRoom ?? 0 } : { ...it };
          }
          let ord = nextOrder(s.inventory) - 1;
          for (const p of items) {
            const id = String(p.id ?? "").trim();
            if (!id) continue;
            const qty = Math.max(0, num(p.quantity));
            const cur = inv[id];
            if (cur) {
              const q = cur.quantity + qty;
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

      clearPlanned: () =>
        set((s) => {
          const inv: Record<string, InventoryItem> = {};
          for (const [id, it] of Object.entries(s.inventory)) {
            if (it.quantity <= 0) continue; // sin stock y sin planeo: se cae
            const { planned: _drop, ...rest } = it;
            inv[id] = rest;
          }
          return { inventory: inv };
        }),

      syncWithCatalog: (rows) =>
        set((s) => {
          const inv = { ...s.inventory };
          for (const m of rows) {
            const cur = inv[m.id];
            if (!cur) continue;
            inv[m.id] = {
              ...cur,
              name: m.name,
              level: m.level,
              power: m.power,
              bonus_bp: m.bonus_bp,
              width: m.width,
              image: m.image,
            };
          }
          return { inventory: inv };
        }),

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

/** Celdas de la sala (1 entrada por celda física), reparadas contra los
 *  `inRoom` actuales por si cambiaron desde otro lado (tabla, optimizador). */
export const selectRoomSlots = (s: State): (string | null)[] =>
  reconcileRoomSlots(s.roomSlots, s.inventory);

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
