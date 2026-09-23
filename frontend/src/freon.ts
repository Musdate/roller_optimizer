// Máquina de Freon: tablas de módulos y cálculo del bonus (ver RULES.md §10).
// Unidades: bonus en bp (10000 bp = 100%), poder en GH/s.

export type Lvl = 0 | 1 | 2 | 3;

export type ModKey =
  | "hamPlatforms"
  | "hamEfficiency"
  | "dutyTime"
  | "leakAmount"
  | "leakTime"
  | "freonEfficiency";

export const LEVEL_LABELS = ["I", "II", "III", "IV"] as const;

/** RLT que cuesta subir un módulo a cada nivel (el I es gratis). */
export const RLT_COST = [0, 10, 25, 100];

export const HAM_SLOTS = [0, 1, 2, 3];
/** Bonus en bp por cada punto de stat del hámster (1% → 100 bp). */
export const HAM_BP_PER_STAT = [100, 200, 300, 500];
export const DUTY_TIME_H = [6, 12, 18, 24];
/** Merma de freon por ronda, en %. */
export const LEAK_PCT = [9, 7, 5, 3];
export const LEAK_TIME_H = [6, 12, 18, 24];
/** Freon extra al cargar, en %. */
export const FREON_EXTRA_PCT = [0, 2.5, 5, 10];

/** 100 Freon = 1% de bonus. */
export const FREON_PER_PCT = 100;

export const MAX_HAMSTERS = 3;

/** Tras cada turno los hámsters descansan 24 h fijas (ver RULES.md §10.5). */
export const HAM_REST_H = 24;

export interface ModuleDef {
  key: ModKey;
  name: string;
  desc: string;
  branch: "ham" | "freon";
  values: string[];
}

export const MODULES: ModuleDef[] = [
  {
    key: "hamPlatforms",
    name: "Ham Platforms",
    desc: "Hámsters trabajando",
    branch: "ham",
    values: ["—", "1 slot", "2 slots", "3 slots"],
  },
  {
    key: "hamEfficiency",
    name: "Ham Efficiency",
    desc: "Bonus por punto de stat",
    branch: "ham",
    values: ["1%", "2%", "3%", "5%"],
  },
  {
    key: "dutyTime",
    name: "Duty Time",
    desc: "Tiempo de trabajo",
    branch: "ham",
    values: ["6 h", "12 h", "18 h", "24 h"],
  },
  {
    key: "leakAmount",
    name: "Freon Leak Amount",
    desc: "Merma por ronda",
    branch: "freon",
    values: ["-9%", "-7%", "-5%", "-3%"],
  },
  {
    key: "leakTime",
    name: "Freon Leak Time",
    desc: "Duración de la ronda",
    branch: "freon",
    values: ["6 h", "12 h", "18 h", "24 h"],
  },
  {
    key: "freonEfficiency",
    name: "Freon Efficiency",
    desc: "Freon extra al cargar",
    branch: "freon",
    values: ["—", "+2.5%", "+5%", "+10%"],
  },
];

export interface MachineTier {
  label: string;
  upgrades: number;
  freonLimit: number;
}

export const MACHINE_TIERS: MachineTier[] = [
  { label: "Nivel I", upgrades: 0, freonLimit: 5000 },
  { label: "Nivel II", upgrades: 6, freonLimit: 50000 },
  { label: "Nivel III", upgrades: 12, freonLimit: 150000 },
  { label: "Nivel IV", upgrades: 18, freonLimit: 500000 },
];

export type Levels = Record<ModKey, Lvl>;

export const DEFAULT_LEVELS: Levels = {
  hamPlatforms: 0,
  hamEfficiency: 0,
  dutyTime: 0,
  leakAmount: 0,
  leakTime: 0,
  freonEfficiency: 0,
};

export interface FreonResult {
  upgrades: number;
  rltSpent: number;
  tier: MachineTier;
  freonLimit: number;
  slots: number;
  hamBonusBp: number;
  freonEffective: number;
  freonBonusBp: number;
  freonCapped: boolean;
  /** Bonus mientras los hámsters trabajan (el pico). */
  peakBonusBp: number;
  /** Bonus promediado sobre el ciclo turno + descanso (el que rinde a diario). */
  effBonusBp: number;
  hamBonusEffBp: number;
  cycleH: number;
  dutyRatio: number;
  dutyTimeH: number;
  leakPct: number;
  leakTimeH: number;
  freonAfterDuty: number;
}

/** Nivel de máquina según cuántas mejoras de módulo se compraron. */
export function tierFor(upgrades: number): MachineTier {
  let tier = MACHINE_TIERS[0];
  for (const t of MACHINE_TIERS) {
    if (upgrades >= t.upgrades) tier = t;
  }
  return tier;
}

export function computeFreon(
  levels: Levels,
  stats: number[],
  freonLoaded: number,
): FreonResult {
  const upgrades = MODULES.reduce((acc, m) => acc + levels[m.key], 0);
  const rltSpent = MODULES.reduce(
    (acc, m) => acc + RLT_COST.slice(0, levels[m.key] + 1).reduce((a, b) => a + b, 0),
    0,
  );
  const tier = tierFor(upgrades);

  const slots = HAM_SLOTS[levels.hamPlatforms];
  const bpPerStat = HAM_BP_PER_STAT[levels.hamEfficiency];
  const hamBonusBp = stats
    .slice(0, slots)
    .reduce((acc, s) => acc + Math.max(0, Math.floor(s)) * bpPerStat, 0);

  const extra = FREON_EXTRA_PCT[levels.freonEfficiency];
  const loaded = Math.max(0, Math.floor(freonLoaded));
  const withExtra = Math.floor(loaded * (1 + extra / 100));
  const freonEffective = Math.min(withExtra, tier.freonLimit);
  const freonBonusBp = Math.round((freonEffective / FREON_PER_PCT) * 100);

  const leakPct = LEAK_PCT[levels.leakAmount];
  const leakTimeH = LEAK_TIME_H[levels.leakTime];
  const dutyTimeH = DUTY_TIME_H[levels.dutyTime];
  const cycleH = dutyTimeH + HAM_REST_H;
  const dutyRatio = dutyTimeH / cycleH;
  const hamBonusEffBp = Math.round(hamBonusBp * dutyRatio);
  const rounds = Math.floor(dutyTimeH / leakTimeH);
  const freonAfterDuty = Math.floor(freonEffective * (1 - leakPct / 100) ** rounds);

  return {
    upgrades,
    rltSpent,
    tier,
    freonLimit: tier.freonLimit,
    slots,
    hamBonusBp,
    freonEffective,
    freonBonusBp,
    freonCapped: withExtra > tier.freonLimit,
    peakBonusBp: hamBonusBp + freonBonusBp,
    effBonusBp: hamBonusEffBp + freonBonusBp,
    hamBonusEffBp,
    cycleH,
    dutyRatio,
    dutyTimeH,
    leakPct,
    leakTimeH,
    freonAfterDuty,
  };
}
