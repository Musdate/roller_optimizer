import type { InventoryItem, Pick } from "./types";

const BP = 10000n;

/** F = P * (10000 + B) / 10000  (división entera, igual que el juego). */
export function finalPower(rawPower: bigint, bonusBp: number): bigint {
  return (rawPower * (BP + BigInt(bonusBp))) / BP;
}

interface Totals {
  rawPower: bigint;
  bonusBp: number;
  finalPower: bigint;
  miners: number;
  cells: number;
}

/** Totales de una lista de (item, cantidad). Bonus contado 1 vez por modelo. */
export function totalsFor(
  entries: { item: Pick | InventoryItem; count: number }[],
): Totals {
  let rawPower = 0n;
  let bonusBp = 0;
  let miners = 0;
  let cells = 0;
  for (const { item, count } of entries) {
    if (count <= 0) continue;
    rawPower += BigInt(item.power) * BigInt(count);
    bonusBp += item.bonus_bp;
    miners += count;
    cells += item.width * count;
  }
  return { rawPower, bonusBp, finalPower: finalPower(rawPower, bonusBp), miners, cells };
}

export function inventoryTotals(list: InventoryItem[]): Totals {
  return totalsFor(list.map((item) => ({ item, count: item.quantity })));
}
