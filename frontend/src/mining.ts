// Calculadora de minado: lógica pura (ver RULES.md §12.3).
// Poder en GH/s; los cálculos son de punto flotante porque el resultado son
// fracciones de moneda, no poderes que haya que comparar exactos.

import type { MiningCurrency, MiningLeague } from "./api";

const DAY_S = 86400;

/** Poder equivalente que publica la Calculadora Freon (§10.4), en GH/s. */
export const FREON_EQ_KEY = "roller-freon-eq";
/** Estado de la Calculadora de minado; la Calculadora Freon lee la moneda marcada (§10.6). */
export const MINING_KEY = "roller-minado";

export interface MiningPrefs {
  /** "auto" o el `level` de la liga elegida a mano. */
  league: string;
  /** Moneda marcada en la tabla. */
  coin: string | null;
}

export function readMiningPrefs(): MiningPrefs {
  try {
    const p = JSON.parse(localStorage.getItem(MINING_KEY) ?? "{}") as Partial<MiningPrefs>;
    return {
      league: typeof p.league === "string" ? p.league : "auto",
      coin: typeof p.coin === "string" ? p.coin : null,
    };
  } catch {
    return { league: "auto", coin: null };
  }
}

/** Monedas por día con todo `power` (GH/s) en esa moneda (RULES.md §12.3). */
export function perDayFor(c: MiningCurrency, power: number): number {
  const share = power > 0 ? power / (Number(c.network_power) + power) : 0;
  return (c.block_reward * share * DAY_S) / c.block_seconds;
}

export interface MiningRow {
  code: string;
  networkPower: number;
  users: number;
  blockReward: number;
  blockSeconds: number;
  price: number | null;
  share: number;
  perBlock: number;
  perDay: number;
  usdDay: number | null;
}

export interface MiningResult {
  rows: MiningRow[];
  /** Código de la moneda que más USD/día da (null si ninguna tiene precio). */
  best: string | null;
}

/** Liga que corresponde a un poder: la última con `min_power ≤ P`. */
export function leagueFor(leagues: MiningLeague[], power: bigint): MiningLeague | undefined {
  return leagues.filter((l) => BigInt(l.min_power) <= power).pop() ?? leagues[0];
}

/** Una moneda con el 100% del poder en ella (RULES.md §12.3). */
function rowFor(c: MiningCurrency, power: number, price: number | null): MiningRow {
  const net = Number(c.network_power);
  const share = power > 0 ? power / (net + power) : 0;
  const perBlock = c.block_reward * share;
  const perDay = perDayFor(c, power);
  return {
    code: c.code,
    networkPower: net,
    users: c.users,
    blockReward: c.block_reward,
    blockSeconds: c.block_seconds,
    price,
    share,
    perBlock,
    perDay,
    usdDay: price === null ? null : perDay * price,
  };
}

export function computeMining(
  league: MiningLeague,
  power: bigint,
  prices: Record<string, number>,
): MiningResult {
  const p = Number(power);
  const rows = league.currencies.map((c) => rowFor(c, p, prices[c.code] ?? null));
  let best: string | null = null;
  let bestUsd = 0;
  for (const r of rows) {
    if (r.usdDay !== null && r.usdDay > bestUsd) {
      bestUsd = r.usdDay;
      best = r.code;
    }
  }
  return { rows, best };
}
