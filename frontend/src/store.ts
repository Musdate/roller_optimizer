import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  CatalogMiner,
  ExcludedMerge,
  InventoryItem,
  Merge,
  RoomImportItem,
  TargetMode,
  TargetUnit,
} from "./types";

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

/** Minero bloqueado en la sala (RULES.md §5.11): celda inicial + id, así un
 *  bloqueo viejo nunca se "pega" a otro minero que caiga en esa celda. */
export interface RoomLock {
  cell: number;
  id: string;
}

/** Celda inicial del minero que ocupa `cell` (el par alineado si es de 2). */
function minerStart(
  slots: (string | null)[],
  cell: number,
  inv: Record<string, InventoryItem>,
): number | null {
  const id = slots[cell];
  if (id == null) return null;
  if ((inv[id]?.width ?? 1) < 2) return cell;
  const start = cell - (cell % 2);
  return slots[start] === id && slots[start + 1] === id ? start : cell;
}

/** Bloqueos que siguen apuntando a su minero en `slots`. */
export function pruneLocks(
  slots: (string | null)[],
  locks: RoomLock[],
  inv: Record<string, InventoryItem>,
): RoomLock[] {
  return locks.filter((l) => slots[l.cell] === l.id && minerStart(slots, l.cell, inv) === l.cell);
}

/** Todas las celdas físicas ocupadas por mineros bloqueados. */
export function lockedCellSet(
  slots: (string | null)[],
  locks: RoomLock[],
  inv: Record<string, InventoryItem>,
): Set<number> {
  const out = new Set<number>();
  for (const l of pruneLocks(slots, locks, inv)) {
    out.add(l.cell);
    if ((inv[l.id]?.width ?? 1) >= 2) out.add(l.cell + 1);
  }
  return out;
}

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

/** Copia de `slots` con la celda `cellIndex` (y su par de estante si el
 *  minero ocupa 2 celdas) vaciada. */
function clearRoomCell(
  slots: (string | null)[],
  cellIndex: number,
  width: number,
): (string | null)[] {
  const next = [...slots];
  if (width >= 2) {
    const shelfStart = cellIndex - (cellIndex % 2);
    next[shelfStart] = null;
    next[shelfStart + 1] = null;
  } else {
    next[cellIndex] = null;
  }
  return next;
}

/** Celda donde poner un minero de `width`: la pedida si está libre (su
 *  estante completo si ocupa 2), si no el primer hueco compatible. */
function pickSpot(
  slots: (string | null)[],
  width: number,
  atCellIndex?: number,
): number | null {
  if (atCellIndex != null) {
    if (width >= 2) {
      const shelfStart = atCellIndex - (atCellIndex % 2);
      if (slots[shelfStart] == null && slots[shelfStart + 1] == null) return shelfStart;
    } else if (slots[atCellIndex] == null) {
      return atCellIndex;
    }
  }
  return findFirstFit(slots, width);
}

/** Fija `quantity` (acotando `simUsed`); borra el modelo si queda vacío. */
function withQuantity(
  inventory: Record<string, InventoryItem>,
  id: string,
  qty: (cur: InventoryItem) => number,
): { inventory: Record<string, InventoryItem> } {
  const cur = inventory[id];
  if (!cur) return { inventory };
  const q = Math.max(0, Math.floor(qty(cur)) || 0);
  const next = { ...cur, quantity: q, simUsed: Math.min(cur.simUsed ?? 0, q) };
  if (isEmpty(next)) {
    const { [id]: _drop, ...rest } = inventory;
    return { inventory: rest };
  }
  return { inventory: { ...inventory, [id]: next } };
}

/** Un modelo sin inventario, sin sala y sin planeado ya no tiene nada que mostrar. */
const isEmpty = (it: InventoryItem): boolean =>
  it.quantity <= 0 && (it.inRoom ?? 0) <= 0 && (it.planned ?? 0) <= 0;

/** Repara `slots` para que coincida con los `inRoom` actuales del
 *  inventario: recorta copias de más (desde el final, las bloqueadas solo si
 *  no alcanza con el resto) y agrega las que falten en el primer hueco
 *  libre. Pura — no muta. */
export function reconcileRoomSlots(
  slots: (string | null)[],
  inv: Record<string, InventoryItem>,
  locks: RoomLock[] = [],
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
  const locked = lockedCellSet(next, locks, inv);
  const have = countRoomInstances(next, inv);
  for (const [id, cap] of Object.entries(target)) {
    let excess = (have[id] ?? 0) - cap;
    if (excess <= 0) continue;
    const w = inv[id]?.width ?? 1;
    for (const allowLocked of [false, true]) {
      const free = (c: number) => allowLocked || !locked.has(c);
      for (let shelf = Math.floor(next.length / 2) - 1; shelf >= 0 && excess > 0; shelf--) {
        const li = shelf * 2;
        const ri = li + 1;
        if (w === 2 && next[li] === id && next[ri] === id) {
          if (!free(li)) continue;
          next[li] = null;
          next[ri] = null;
          excess--;
        } else {
          if (next[ri] === id && free(ri)) {
            next[ri] = null;
            excess--;
            if (excess <= 0) break;
          }
          if (next[li] === id && free(li)) {
            next[li] = null;
            excess--;
          }
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
  /** Liga objetivo o poder personalizado (RULES.md §5.4). */
  targetMode: TargetMode;
  /** `level` de la liga elegida; null = sin elegir todavía. */
  leagueLevel: number | null;
  /** Margen bajo el tope, en % (RULES.md §5.2). */
  marginPct: string;
  rooms: number;
  /** Sala 1 por posición: 1 entrada por celda física (0..95). */
  roomSlots: (string | null)[];
  /** Mineros bloqueados en la sala (RULES.md §5.11). */
  roomLocks: RoomLock[];
  /** userId de RollerCoin para sincronizar la sala real ("recargar sala"). */
  rollercoinUserId: string;
  /** Merges descartados a mano: el optimizador no los propone (RULES.md §5.9). */
  excludedMerges: ExcludedMerge[];

  addFromCatalog: (m: CatalogMiner, qty?: number) => void;
  addPlanned: (m: CatalogMiner, qty?: number) => void;
  addCustom: (m: Omit<InventoryItem, "quantity"> & { quantity: number }) => void;
  setQuantity: (id: string, qty: number) => void;
  /** X de "Mi inventario": elimina `n` copias del inventario (RULES.md §5.5). */
  removeFromInventory: (id: string, n: number) => void;
  setPlanned: (id: string, n: number) => void;
  /** Arma la sala con el resultado sin tocar "Mi inventario": las copias
   *  del inventario y los merges se simulan con `simUsed` (RULES.md §5.7). */
  applyRoom: (counts: Record<string, number>, merges?: Merge[]) => void;
  /** Reemplaza la sala con lo que la API de RollerCoin dice que está
   *  puesto AHORA en el juego real (ver `importRealRoom`). A diferencia de
   *  `applyRoom` (que arma una sala hipotética con lo que ya tenés
   *  guardado), acá los mineros que estaban puestos y salen de la nueva
   *  lista se van del todo -- no vuelven a "en banco" -- porque este
   *  reemplazo es una foto 1:1 de la sala real, no una reasignación interna
   *  de copias que seguís teniendo. */
  importRoomFromApi: (items: RoomImportItem[], slots: (string | null)[]) => void;
  setRollercoinUserId: (v: string) => void;
  /** Pone en la celda dada una copia de "Mi inventario" sin descontarla
   *  del inventario (`simUsed += 1`). Sin celda (o si está ocupada) cae en
   *  el primer hueco compatible. */
  placeInRoomAt: (id: string, atCellIndex?: number) => void;
  /** Pone en la sala un minero arrastrado desde el catálogo (no toca el
   *  inventario). */
  addToRoom: (m: CatalogMiner, atCellIndex?: number) => void;
  /** Saca de la sala lo que ocupa la celda `cellIndex`. Nunca pasa a "Mi
   *  inventario" (RULES.md §5.5). */
  removeFromRoom: (cellIndex: number) => void;
  /** Mueve dentro de la sala (drag&drop entre celdas). */
  reorderRoomSlot: (fromCellIndex: number, toCellIndex: number) => void;
  /** Bloquea / desbloquea el minero de la celda dada (RULES.md §5.11). */
  toggleLock: (cellIndex: number) => void;
  /** Vacía la sala por completo (no toca el inventario). */
  clearRoom: () => void;
  mergeParsedInventory: (
    items: Array<Record<string, unknown>>,
    replace: boolean,
  ) => void;
  loadState: (data: {
    version?: unknown;
    rooms?: unknown;
    inventory: Array<Record<string, unknown>>;
  }) => void;
  remove: (id: string) => void;
  clearInventory: () => void;
  clearPlanned: () => void;
  /** Refresca nombre/imagen/poder/bonus/width/level de los ítems dados
   *  contra el catálogo actual (quantity/inRoom/planned/order no se tocan). */
  syncWithCatalog: (rows: CatalogMiner[]) => void;

  setInvSort: (v: InvSort) => void;
  setTargetNum: (v: string) => void;
  setTargetUnit: (v: TargetUnit) => void;
  setTargetMode: (v: TargetMode) => void;
  setLeagueLevel: (v: number | null) => void;
  setMarginPct: (v: string) => void;
  setRooms: (v: number) => void;
  excludeMerge: (m: ExcludedMerge) => void;
  includeMerge: (fromId: string) => void;
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
      targetMode: "league",
      leagueLevel: null,
      marginPct: "1",
      rooms: 1,
      roomSlots: Array(ROOM1_CELLS).fill(null),
      roomLocks: [],
      rollercoinUserId: "",
      excludedMerges: [],

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

      setQuantity: (id, qty) => set((s) => withQuantity(s.inventory, id, () => qty)),

      removeFromInventory: (id, n) =>
        set((s) => withQuantity(s.inventory, id, (cur) => cur.quantity - n)),

      setPlanned: (id, n) =>
        set((s) => {
          const cur = s.inventory[id];
          if (!cur) return s;
          const planned = Math.max(0, Math.floor(n) || 0);
          const next = { ...cur, planned, plannedUsed: Math.min(cur.plannedUsed ?? 0, planned) };
          if (isEmpty(next)) {
            const { [id]: _drop, ...rest } = s.inventory;
            return { inventory: rest };
          }
          return { inventory: { ...s.inventory, [id]: next } };
        }),

      applyRoom: (counts, merges = []) =>
        set((s) => {
          const inv: Record<string, InventoryItem> = { ...s.inventory };
          const consumed: Record<string, number> = {};
          const produced: Record<string, number> = {};
          for (const mg of merges) {
            consumed[mg.from_id] = (consumed[mg.from_id] ?? 0) + 2 * mg.count;
            produced[mg.to.id] = (produced[mg.to.id] ?? 0) + mg.count;
            if (!inv[mg.to.id]) inv[mg.to.id] = { ...mg.to, quantity: 0, order: nextOrder(inv) };
          }

          // Simula sin tocar `quantity` ni `planned` (RULES.md §5.7): las
          // copias que usa la sala o un merge se cuentan en `simUsed` (del
          // inventario) y `plannedUsed` (de lo planeado).
          for (const [id, cur] of Object.entries(inv)) {
            const q = cur.quantity;
            const room = cur.inRoom ?? 0;
            const planned = cur.planned ?? 0;
            let used = cur.simUsed ?? 0;
            let pUsed = cur.plannedUsed ?? 0;
            const c = Math.max(0, Math.floor(counts[id] ?? 0));
            const take = (n: number) => {
              const fromInv = Math.min(n, q - used);
              used += fromInv;
              pUsed += Math.min(n - fromInv, planned - pUsed);
            };

            // 1) las que salen: primero al merge; del resto, se liberan las
            //    que venían del inventario, luego las de lo planeado, y las
            //    demás se eliminan
            const out = Math.max(0, room - c);
            const toMerge = Math.min(out, consumed[id] ?? 0);
            const freeInv = Math.min(out - toMerge, used);
            used -= freeInv;
            pUsed -= Math.min(out - toMerge - freeInv, pUsed);
            // 2) lo que el merge consume y no salió de la sala
            take((consumed[id] ?? 0) - toMerge);
            // 3) las que entran: de los merges, del inventario, de lo planeado
            const inn = Math.max(0, c - room);
            take(Math.max(0, inn - (produced[id] ?? 0)));

            inv[id] = { ...cur, inRoom: c, simUsed: used, plannedUsed: pUsed || undefined };
            if (isEmpty(inv[id])) delete inv[id];
          }
          return { inventory: inv };
        }),

      importRoomFromApi: (items, slots) =>
        set((s) => {
          const nextSlots = slots.slice(0, ROOM1_CELLS);
          while (nextSlots.length < ROOM1_CELLS) nextSlots.push(null);

          // La sala pasa a ser la real: se reemplaza entera y la simulación
          // se descarta (`simUsed = 0`). "Mi inventario" no se toca.
          const inv: Record<string, InventoryItem> = {};
          for (const [id, it] of Object.entries(s.inventory)) {
            inv[id] = { ...it, inRoom: 0, simUsed: 0, plannedUsed: 0 };
          }
          let ord = nextOrder(s.inventory) - 1;
          for (const ri of items) {
            const c = Math.max(0, Math.floor(ri.count));
            if (c <= 0) continue;
            const cur = inv[ri.id];
            if (cur) {
              inv[ri.id] = {
                ...cur,
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
                quantity: 0,
                inRoom: c,
                image: ri.image,
                order: ++ord,
              };
            }
          }
          for (const [id, it] of Object.entries(inv)) {
            if (isEmpty(it)) delete inv[id];
          }

          // Los bloqueados que siguen puestos en el juego se mantienen
          // (RULES.md §5.11): en su misma celda si ahí está, si no en otra
          // copia suya sin bloquear.
          const oldLocks = pruneLocks(
            reconcileRoomSlots(s.roomSlots, s.inventory, s.roomLocks),
            s.roomLocks,
            s.inventory,
          );
          const isStart = (cell: number, id: string) =>
            nextSlots[cell] === id && minerStart(nextSlots, cell, inv) === cell;
          const kept = oldLocks.filter((l) => isStart(l.cell, l.id));
          const taken = new Set(kept.map((l) => l.cell));
          for (const l of oldLocks) {
            if (taken.has(l.cell) && nextSlots[l.cell] === l.id) continue;
            const cell = nextSlots.findIndex((_, c) => !taken.has(c) && isStart(c, l.id));
            if (cell < 0) continue;
            kept.push({ cell, id: l.id });
            taken.add(cell);
          }
          return { inventory: inv, roomSlots: nextSlots, roomLocks: kept };
        }),

      setRollercoinUserId: (v) => set({ rollercoinUserId: v }),

      placeInRoomAt: (id, atCellIndex) =>
        set((s) => {
          const cur = s.inventory[id];
          if (!cur) return s;
          const used = cur.simUsed ?? 0;
          if (used >= cur.quantity) return s; // no quedan copias sin usar en el inventario
          const slots = reconcileRoomSlots(s.roomSlots, s.inventory, s.roomLocks);
          const spot = pickSpot(slots, cur.width, atCellIndex);
          if (spot == null) return s; // sala llena

          const next = [...slots];
          next[spot] = id;
          if (cur.width >= 2) next[spot + 1] = id;
          return {
            inventory: {
              ...s.inventory,
              [id]: { ...cur, inRoom: (cur.inRoom ?? 0) + 1, simUsed: used + 1 },
            },
            roomSlots: next,
          };
        }),

      addToRoom: (m, atCellIndex) =>
        set((s) => {
          const slots = reconcileRoomSlots(s.roomSlots, s.inventory, s.roomLocks);
          const spot = pickSpot(slots, m.width, atCellIndex);
          if (spot == null) return s; // sala llena
          const cur = s.inventory[m.id];
          const item: InventoryItem = cur
            ? { ...cur, inRoom: (cur.inRoom ?? 0) + 1 }
            : {
                id: m.id,
                name: m.name,
                level: m.level,
                power: m.power,
                bonus_bp: m.bonus_bp,
                width: m.width,
                quantity: 0,
                inRoom: 1,
                image: m.image,
                order: nextOrder(s.inventory),
              };
          const next = [...slots];
          next[spot] = m.id;
          if (m.width >= 2) next[spot + 1] = m.id;
          return { inventory: { ...s.inventory, [m.id]: item }, roomSlots: next };
        }),

      removeFromRoom: (cellIndex) =>
        set((s) => {
          const slots = reconcileRoomSlots(s.roomSlots, s.inventory, s.roomLocks);
          const id = slots[cellIndex];
          if (id == null) return s;
          const cur = s.inventory[id];
          if (!cur) return s;
          const next = clearRoomCell(slots, cellIndex, cur.width);
          // Si venía del inventario (o de lo planeado), esa copia deja de
          // estar usada; si no, se elimina. Nunca pasa a "Mi inventario"
          // (RULES.md §5.5).
          const fromInv = (cur.simUsed ?? 0) > 0;
          const item = {
            ...cur,
            inRoom: Math.max(0, (cur.inRoom ?? 0) - 1),
            simUsed: Math.max(0, (cur.simUsed ?? 0) - (fromInv ? 1 : 0)),
            plannedUsed: Math.max(0, (cur.plannedUsed ?? 0) - (fromInv ? 0 : 1)),
          };
          const inv = { ...s.inventory };
          if (isEmpty(item)) delete inv[id];
          else inv[id] = item;
          return { inventory: inv, roomSlots: next, roomLocks: pruneLocks(next, s.roomLocks, inv) };
        }),

      reorderRoomSlot: (fromCellIndex, toCellIndex) =>
        set((s) => {
          const slots = reconcileRoomSlots(s.roomSlots, s.inventory, s.roomLocks);
          const id = slots[fromCellIndex];
          if (id == null) return s;
          const cur = s.inventory[id];
          if (!cur) return s;
          const w = cur.width;
          const other = slots[toCellIndex];
          const otherW = other != null ? s.inventory[other]?.width ?? 1 : 1;
          // el bloqueo viaja con el minero (RULES.md §5.11)
          const locks = pruneLocks(slots, s.roomLocks, s.inventory);
          const moveLocks = (to: (cell: number) => number) =>
            locks.map((l) => ({ ...l, cell: to(l.cell) }));

          // soltado sobre otro minero: se intercambian de lugar
          if (other != null) {
            const swapped = [...slots];
            if (w < 2 && otherW < 2) {
              if (fromCellIndex === toCellIndex) return s;
              swapped[fromCellIndex] = other;
              swapped[toCellIndex] = id;
              return {
                roomSlots: swapped,
                roomLocks: moveLocks((c) =>
                  c === fromCellIndex ? toCellIndex : c === toCellIndex ? fromCellIndex : c,
                ),
              };
            } else {
              // uno ocupa 2 celdas: se cambian los estantes completos (un
              // minero de 1 celda que compartía estante viaja con él)
              const fromShelf = fromCellIndex - (fromCellIndex % 2);
              const toShelf = toCellIndex - (toCellIndex % 2);
              if (fromShelf === toShelf) return s;
              for (const d of [0, 1]) {
                swapped[fromShelf + d] = slots[toShelf + d];
                swapped[toShelf + d] = slots[fromShelf + d];
              }
              const shelfOf = (c: number) => c - (c % 2);
              return {
                roomSlots: swapped,
                roomLocks: moveLocks((c) =>
                  shelfOf(c) === fromShelf
                    ? toShelf + (c % 2)
                    : shelfOf(c) === toShelf
                      ? fromShelf + (c % 2)
                      : c,
                ),
              };
            }
          }

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
          const target = spot;
          return { roomSlots: next, roomLocks: moveLocks((c) => (c === fromStart ? target : c)) };
        }),

      toggleLock: (cellIndex) =>
        set((s) => {
          const slots = reconcileRoomSlots(s.roomSlots, s.inventory, s.roomLocks);
          const start = minerStart(slots, cellIndex, s.inventory);
          if (start == null) return s;
          const locks = pruneLocks(slots, s.roomLocks, s.inventory);
          const has = locks.some((l) => l.cell === start);
          return {
            roomSlots: slots,
            roomLocks: has
              ? locks.filter((l) => l.cell !== start)
              : [...locks, { cell: start, id: slots[start] as string }],
          };
        }),

      clearRoom: () =>
        set((s) => {
          const inv: Record<string, InventoryItem> = {};
          for (const [id, it] of Object.entries(s.inventory)) {
            const next = { ...it, inRoom: 0, simUsed: 0, plannedUsed: 0 };
            if (!isEmpty(next)) inv[id] = next;
          }
          return { inventory: inv, roomSlots: Array(ROOM1_CELLS).fill(null), roomLocks: [] };
        }),

      mergeParsedInventory: (items, replace) =>
        set((s) => {
          const num = (v: unknown, def = 0): number => {
            const n = Math.floor(Number(v));
            return Number.isFinite(n) ? n : def;
          };
          // El texto del juego es solo el inventario (lo puesto en la sala no
          // aparece ahí): se reemplaza o suma `quantity` y nada más.
          const inv: Record<string, InventoryItem> = {};
          for (const [id, it] of Object.entries(s.inventory)) {
            inv[id] = replace ? { ...it, quantity: 0 } : { ...it };
          }
          let ord = nextOrder(s.inventory) - 1;
          for (const p of items) {
            const id = String(p.id ?? "").trim();
            if (!id) continue;
            const qty = Math.max(0, num(p.quantity));
            const cur = inv[id];
            if (cur) {
              inv[id] = { ...cur, quantity: cur.quantity + qty };
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
            inv[id] = { ...it, simUsed: Math.min(it.simUsed ?? 0, it.quantity) };
            if (isEmpty(inv[id])) delete inv[id];
          }
          return { inventory: inv };
        }),

      loadState: (data) =>
        set((s) => {
          const num = (v: unknown, def = 0): number => {
            const n = Math.floor(Number(v));
            return Number.isFinite(n) ? n : def;
          };
          // version < 2: `quantity` incluía lo puesto en la sala (RULES.md §5.5)
          const legacy = num(data.version, 1) < 2;
          const inv: Record<string, InventoryItem> = {};
          let ord = 0;
          for (const raw of Array.isArray(data.inventory) ? data.inventory : []) {
            const id = String(raw.id ?? "").trim();
            if (!id) continue;
            const inRoom = Math.max(0, num(raw.inRoom));
            const quantity = Math.max(0, num(raw.quantity) - (legacy ? inRoom : 0));
            const planned = Math.max(0, num(raw.planned));
            if (quantity === 0 && inRoom === 0 && planned === 0) continue;
            const width = Math.max(1, num(raw.width, 1));
            const simUsed = legacy ? 0 : Math.min(quantity, Math.max(0, num(raw.simUsed)));
            const plannedUsed = Math.min(planned, Math.max(0, num(raw.plannedUsed)));
            inv[id] = {
              id,
              name: String(raw.name ?? ""),
              level: num(raw.level),
              power: String(raw.power ?? "0"),
              bonus_bp: num(raw.bonus_bp),
              width,
              quantity,
              inRoom: inRoom || undefined,
              simUsed: simUsed || undefined,
              planned: planned || undefined,
              plannedUsed: plannedUsed || undefined,
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

      // "vaciar" en Mi inventario: solo el inventario. La sala y lo planeado
      // en Nueva adquisición no se tocan (tienen su propio "vaciar").
      clearInventory: () =>
        set((s) => {
          const inv: Record<string, InventoryItem> = {};
          for (const [id, it] of Object.entries(s.inventory)) {
            const next = { ...it, quantity: 0, simUsed: 0 };
            if (!isEmpty(next)) inv[id] = next;
          }
          return { inventory: inv };
        }),

      clearPlanned: () =>
        set((s) => {
          const inv: Record<string, InventoryItem> = {};
          for (const [id, it] of Object.entries(s.inventory)) {
            const { planned: _drop, plannedUsed: _dropUsed, ...rest } = it;
            if (!isEmpty(rest)) inv[id] = rest;
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
      setTargetMode: (v) => set({ targetMode: v }),
      setLeagueLevel: (v) => set({ leagueLevel: v }),
      setMarginPct: (v) => set({ marginPct: v }),
      setRooms: (v) => set({ rooms: Math.min(MAX_ROOMS, Math.max(1, Math.floor(v))) }),
      excludeMerge: (m) =>
        set((s) =>
          s.excludedMerges.some((e) => e.from_id === m.from_id)
            ? s
            : { excludedMerges: [...s.excludedMerges, m] },
        ),
      includeMerge: (fromId) =>
        set((s) => ({ excludedMerges: s.excludedMerges.filter((e) => e.from_id !== fromId) })),
    }),
    {
      name: "roller-optimizer",
      version: 2,
      // v1: `quantity` incluía lo puesto en la sala; desde v2 "Mi inventario"
      // y la sala son independientes (RULES.md §5.5).
      migrate: (persisted, version) => {
        const st = persisted as { inventory?: Record<string, InventoryItem> };
        if (version < 2 && st?.inventory) {
          for (const [id, it] of Object.entries(st.inventory)) {
            st.inventory[id] = {
              ...it,
              quantity: Math.max(0, it.quantity - (it.inRoom ?? 0)),
              simUsed: 0,
            };
          }
        }
        return st as State;
      },
    },
  ),
);

/** Inventario completo tal cual (sin ordenar) — para exportar / snapshots. */
export const selectInventoryList = (s: State): InventoryItem[] =>
  Object.values(s.inventory);

/** Copias bloqueadas por modelo (RULES.md §5.11). */
export const selectLockedCounts = (s: State): Record<string, number> => {
  const slots = reconcileRoomSlots(s.roomSlots, s.inventory, s.roomLocks);
  const out: Record<string, number> = {};
  for (const l of pruneLocks(slots, s.roomLocks, s.inventory)) out[l.id] = (out[l.id] ?? 0) + 1;
  return out;
};

/** Lista para el optimizador: copias efectivas = inventario sin usar + sala +
 *  planeado (RULES.md §5.5), con las bloqueadas en `locked` (§5.11). */
export const selectOptimizeList = (s: State): InventoryItem[] => {
  const locked = selectLockedCounts(s);
  return Object.values(s.inventory)
    .map((i) => ({
      ...i,
      quantity:
        i.quantity - (i.simUsed ?? 0) + (i.inRoom ?? 0) + (i.planned ?? 0) - (i.plannedUsed ?? 0),
      locked: locked[i.id] || undefined,
    }))
    .filter((i) => i.quantity > 0);
};

/** Mineros que tengo puestos en la sala ahora mismo (inRoom > 0). */
export const selectRoomList = (s: State): InventoryItem[] =>
  Object.values(s.inventory).filter((i) => (i.inRoom ?? 0) > 0);

/** Celdas de la sala (1 entrada por celda física), reparadas contra los
 *  `inRoom` actuales por si cambiaron desde otro lado (tabla, optimizador). */
export const selectRoomSlots = (s: State): (string | null)[] =>
  reconcileRoomSlots(s.roomSlots, s.inventory, s.roomLocks);

/** Mineros de "Mi inventario" (quantity > 0). */
export const selectBenchList = (s: State): InventoryItem[] =>
  Object.values(s.inventory).filter((i) => i.quantity > 0);

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
