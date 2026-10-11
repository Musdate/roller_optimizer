// Computers RH: H/s, temperatura, cuidado, bonus de isla y ganancia neta.
// Lógica pura, sin React. Fórmulas y supuestos en RULES.md §12.

import {
  BOARDS, CPUS, GPUS, RAMS, SSDS, PSUS, COOLERS, CASES, FANS, CARDS,
  CURVE, RAM_LEGACY_ANCHORS, HEAT, CARE_PRICES, USD_PER_KWH, PSU_RESERVE, HALL1_HS_CAP,
  MAX_DESKS, POWER_LEVELS, POWER_PER_100, PLOTS, PLOT_BASE,
  PLOT_PER_100, ISLAND_LEVELS, COMBO_PCT, MATCH_MIN_HS, MATCH_SHARE,
  type Parts, type Card,
} from "./crh-data";

const byId = <T extends { id: string }>(list: T[]) => new Map(list.map((x) => [x.id, x]));
export const BOARD = byId(BOARDS);
export const CPU = byId(CPUS);
export const GPU = byId(GPUS);
export const RAM = byId(RAMS);
export const SSD = byId(SSDS);
export const PSU = byId(PSUS);
export const COOLER = byId(COOLERS);
export const CASE = byId(CASES);
export const FAN = byId(FANS);
export const CARD = byId(CARDS);

/** Una PC de la isla. `cardId` = tarjeta lista sin modificar; null = armado propio. */
export interface PcSpec {
  key: string;
  cardId: string | null;
  parts: Parts | null;
}

export interface Intervals {
  cpuPaste: number;
  gpuPaste: number;
  fan: number;
  repair: number;
}
export type CareMode = "optimal" | "auto" | "none" | "custom";

export const NEVER = Infinity;
export const AUTO_INTERVALS: Intervals = {
  cpuPaste: (HEAT.clocks.cpuPaste * HEAT.autoPastePct) / 100,
  gpuPaste: (HEAT.clocks.gpuPaste * HEAT.autoPastePct) / 100,
  fan: HEAT.clocks.fan,
  repair: HEAT.clocks.hardware,
};
export const NO_CARE: Intervals = { cpuPaste: NEVER, gpuPaste: NEVER, fan: NEVER, repair: NEVER };
/** Desde 5% de desgaste una parte cuenta como gastada (§12.5). */
export const MIN_REPAIR_H = (HEAT.clocks.hardware * HEAT.wornPct) / HEAT.wearMaxPct;

const CPU_OPTS = [NEVER, 72, 57.6, 48, 36, 24];
const GPU_OPTS = [NEVER, 96, 76.8, 72, 48, 36, 24];
const FAN_OPTS = [NEVER, 96, 72, 48, 36, 24, 12];
const REPAIR_OPTS = [NEVER, 336, 240, 168, 112];
/** Múltiplo de todos los intervalos de la grilla (57.6 y 76.8 incluidos). */
const HORIZON_H = 1152;

// ---------------------------------------------------------------- PC

interface Thermal {
  sealed: boolean;
  /** Modular: (calor_pc + calor_chip ÷ cooler) por chip; sellado: temperatura de partida. */
  cpu: number;
  gpu: number;
  airflow: number;
  target: number;
  /** Σ fuerza × (mm/120)² con ventiladores limpios. */
  flow: number;
}

export interface CareCosts {
  cpuPaste: number;
  gpuPaste: number;
  fanClean: number;
  repair: number;
}

export interface PcStats {
  name: string;
  sealed: boolean;
  price: number;
  partsHs: number;
  mult: number;
  healthyHs: number;
  watts: number;
  psuNeed: number;
  psuCap: number;
  fans: number;
  minIsland: number;
  errors: string[];
  thermal: Thermal;
  care: CareCosts;
}

export function cardParts(card: Card): Parts | null {
  return card.parts ? { ...card.parts } : null;
}

export function multiplier(partsHs: number, watts: number): number {
  const value = CURVE.k * partsHs - CURVE.lam * watts;
  const pts = CURVE.points;
  if (value <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    const [v1, m1] = pts[i];
    if (value <= v1) {
      const [v0, m0] = pts[i - 1];
      const t = Math.log(value / v0) / Math.log(v1 / v0);
      return Math.exp(Math.log(m0) + t * Math.log(m1 / m0));
    }
  }
  return CURVE.top;
}

function ramHs(memory: string, gb: number, speed: number): number {
  if (gb <= 0) return 0;
  if (memory === "DDR5") return (10 + 6 * Math.log2(gb / 8)) * (speed / 4800);
  const a = RAM_LEGACY_ANCHORS;
  let base: number;
  if (gb <= a[0][0]) base = (a[0][1] * gb) / a[0][0];
  else if (gb >= a[a.length - 1][0]) base = a[a.length - 1][1];
  else {
    let i = 1;
    while (gb > a[i][0]) i++;
    const [g0, h0] = a[i - 1];
    const [g1, h1] = a[i];
    base = h0 + ((h1 - h0) * Math.log2(gb / g0)) / Math.log2(g1 / g0);
  }
  return base * (speed / 1600);
}

/** Factor (mm/120)² de cada ventilador, llenando primero los montajes grandes. */
function fanSizeFactors(mounts: number, sizes: number[], n: number): number[] {
  const sorted = [...sizes].sort((a, b) => b - a);
  const slots: number[] = [];
  if (sorted.length === 1) for (let i = 0; i < mounts; i++) slots.push(sorted[0]);
  else {
    for (let i = 0; i < mounts - 1; i++) slots.push(sorted[0]);
    slots.push(sorted[sorted.length - 1]);
  }
  return slots.slice(0, n).map((mm) => (mm / 120) ** 2);
}

const ceilMicro = (x: number) => Math.ceil(x * 1e6 - 1e-6) / 1e6;
const pasteCost = (price: number) => Math.max(CARE_PRICES.pasteMin, (price * CARE_PRICES.pastePct) / 100);
const repairCost = (price: number) => Math.max(CARE_PRICES.repairMin, (price * CARE_PRICES.repairPct) / 100);
function fanCleanTotal(pcValue: number, fans: number): number {
  if (fans <= 0) return 0;
  const each = ceilMicro(Math.max(CARE_PRICES.fanMin, (pcValue * CARE_PRICES.fanPcPct) / 100 / fans));
  return each * fans;
}

export function partsPrice(p: Parts): number {
  const g = (m: Map<string, { price: number }>, id: string) => m.get(id)?.price ?? 0;
  return (
    g(BOARD, p.board) + g(CPU, p.cpu) + g(GPU, p.gpu) + g(RAM, p.ram) * p.ramQty + g(SSD, p.ssd) +
    g(COOLER, p.cooler) + g(CASE, p.case) + g(PSU, p.psu) + g(FAN, p.fan) * p.fanQty
  );
}

export function pcName(spec: PcSpec): string {
  if (spec.cardId) return CARD.get(spec.cardId)?.name ?? spec.cardId;
  return "Armado propio";
}

export function pcStats(spec: PcSpec): PcStats {
  const card = spec.cardId ? CARD.get(spec.cardId) : undefined;
  if (card?.sealed) {
    const s = card.sealed;
    const partsHs = s.hs;
    const mult = multiplier(partsHs, s.w);
    const healthyHs = partsHs * mult;
    return {
      name: card.name,
      sealed: true,
      price: card.price,
      partsHs,
      mult,
      healthyHs,
      watts: s.w,
      psuNeed: 0,
      psuCap: 0,
      fans: 1,
      minIsland: Math.max(card.minIslandLevel, healthyHs > HALL1_HS_CAP ? 2 : 1),
      errors: [],
      thermal: { sealed: true, cpu: s.temps[0], gpu: s.temps[1], airflow: 0, target: 0, flow: 0 },
      care: s.care ?? {
        cpuPaste: pasteCost(card.price),
        gpuPaste: pasteCost(card.price),
        fanClean: fanCleanTotal(card.price, 1),
        repair: repairCost(card.price),
      },
    };
  }

  const p = spec.parts!;
  const errors: string[] = [];
  const board = BOARD.get(p.board);
  const cpu = CPU.get(p.cpu);
  const gpu = GPU.get(p.gpu);
  const ram = RAM.get(p.ram);
  const ssd = SSD.get(p.ssd);
  const cooler = COOLER.get(p.cooler);
  const cs = CASE.get(p.case);
  const psu = PSU.get(p.psu);
  const fan = FAN.get(p.fan);
  if (!board || !cpu || !gpu || !ram || !ssd || !cooler || !cs || !psu || !fan) {
    throw new Error("Parte desconocida en el armado");
  }
  const ramQty = Math.max(0, Math.floor(p.ramQty));
  const fanQty = Math.max(0, Math.floor(p.fanQty));

  if (cpu.socket !== board.socket) errors.push(`El CPU es ${cpu.socket} y la placa ${board.socket}.`);
  if (ram.memory !== board.memory) errors.push(`La RAM es ${ram.memory} y la placa usa ${board.memory}.`);
  if (ramQty < 1) errors.push("Falta la RAM.");
  const modules = ram.modules * ramQty;
  const gb = ram.gb * ramQty;
  if (modules > board.slots) errors.push(`${modules} módulos de RAM y la placa tiene ${board.slots} ranuras.`);
  if (gb > board.maxGb) errors.push(`${gb} GB de RAM y la placa acepta hasta ${board.maxGb} GB.`);
  if (ram.gb / ram.modules > board.maxModuleGb) {
    errors.push(`Módulos de ${ram.gb / ram.modules} GB y la placa acepta hasta ${board.maxModuleGb} GB por módulo.`);
  }
  if (fanQty > cs.mounts) errors.push(`${fanQty} ventiladores y el gabinete tiene ${cs.mounts} montajes.`);
  if (cooler.family && cooler.family !== board.socket) {
    errors.push(`El cooler solo entra en placas ${cooler.family}.`);
  }

  const speed = Math.min(board.speed, ram.speed);
  const partsHs = cpu.hs + gpu.hs + ssd.hs + ramHs(board.memory, gb, speed);
  const fanW = fan.w * fanQty;
  const watts = board.baseW + cpu.w + gpu.w + ssd.w + ram.w * ramQty + cooler.w + fanW;
  const psuNeed = watts * PSU_RESERVE;
  if (psuNeed > psu.capacity + 1e-9) {
    errors.push(`La fuente de ${psu.capacity} W no alcanza: necesitas ${psuNeed.toFixed(1)} W con la reserva del 15%.`);
  }
  const mult = multiplier(partsHs, watts);
  const healthyHs = partsHs * mult;

  const pcHeat = HEAT.pcCPerW * (watts - fanW - cooler.w);
  const cpuHeat = (HEAT.cpuC * cpu.w) / HEAT.cpuRefW / cooler.rating;
  const gpuHeat = (HEAT.gpuC * gpu.w) / HEAT.gpuRefW / gpu.cooler;
  const flow = fanSizeFactors(cs.mounts, cs.sizes, fanQty).reduce((s, f) => s + fan.strength * f, 0);

  const isCard = card?.parts !== undefined;
  const price = isCard ? card!.price : partsPrice(p);
  const repair =
    repairCost(board.price) + repairCost(cpu.price) + repairCost(gpu.price) + repairCost(ram.price) * ramQty +
    repairCost(ssd.price) + repairCost(cooler.price) + repairCost(psu.price) + repairCost(fan.price) * fanQty;

  return {
    name: card?.name ?? "Armado propio",
    sealed: false,
    price,
    partsHs,
    mult,
    healthyHs,
    watts,
    psuNeed,
    psuCap: psu.capacity,
    fans: fanQty,
    minIsland: Math.max(card?.minIslandLevel ?? 1, healthyHs > HALL1_HS_CAP ? 2 : 1),
    errors,
    thermal: {
      sealed: false,
      cpu: pcHeat + cpuHeat,
      gpu: pcHeat + gpuHeat,
      airflow: cs.airflow / 100,
      target: cs.target,
      flow,
    },
    care: {
      cpuPaste: pasteCost(cpu.price),
      gpuPaste: pasteCost(gpu.price),
      fanClean: fanCleanTotal(price, fanQty),
      repair,
    },
  };
}

// ---------------------------------------------------------------- temperatura

const clean = (dustH: number) => 1 - (1 - HEAT.dustyFlow) * Math.min(dustH / HEAT.clocks.fan, 1);
const pasteRise = (h: number, life: number) => HEAT.pasteRiseC * Math.min(h / life, 1);

export function heatLossPct(tempC: number): number {
  if (tempC <= HEAT.throttleC) return 0;
  return Math.min(HEAT.maxLossPct, HEAT.lossPerC * (tempC - HEAT.throttleC));
}

/** Temperatura de CPU y GPU según las horas desde la última pasta y limpieza. */
export function chipTemps(t: Thermal, cpuH: number, gpuH: number, dustH: number): [number, number] {
  const cpuRise = pasteRise(cpuH, HEAT.clocks.cpuPaste);
  const gpuRise = pasteRise(gpuH, HEAT.clocks.gpuPaste);
  if (t.sealed) {
    const dust = HEAT.sealedDustRiseC * Math.min(dustH / HEAT.clocks.fan, 1);
    return [t.cpu + cpuRise + dust, t.gpu + gpuRise + dust];
  }
  const f = t.flow * clean(dustH);
  const air = t.airflow * (HEAT.fanBase + (HEAT.fanGain * f) / (f + t.target));
  return [HEAT.baseC + t.cpu / air + cpuRise, HEAT.baseC + t.gpu / air + gpuRise];
}

const ageAt = (tMid: number, interval: number) => (interval === NEVER ? 1e9 : tMid % interval);

interface HeatRun {
  avgLoss: number;
  maxTemp: number;
}

/** Pérdida por calor promedio en régimen permanente (§12.6). */
export function heatRun(t: Thermal, iv: Pick<Intervals, "cpuPaste" | "gpuPaste" | "fan">): HeatRun {
  let sum = 0;
  let maxTemp = 0;
  for (let h = 0; h < HORIZON_H; h++) {
    const m = h + 0.5;
    const [c, g] = chipTemps(t, ageAt(m, iv.cpuPaste), ageAt(m, iv.gpuPaste), ageAt(m, iv.fan));
    const temp = Math.max(c, g);
    if (temp > maxTemp) maxTemp = temp;
    sum += heatLossPct(temp);
  }
  return { avgLoss: sum / HORIZON_H, maxTemp };
}

export function wearAvgPct(repairH: number): number {
  const full = HEAT.clocks.hardware;
  const max = HEAT.wearMaxPct;
  if (repairH === NEVER) return max;
  if (repairH <= full) return (max * repairH) / (2 * full);
  return (max * (full / 2 + (repairH - full))) / repairH;
}

const perDay = (cost: number, intervalH: number) => (intervalH === NEVER || cost <= 0 ? 0 : (cost * 24) / intervalH);

export function careCostPerDay(c: CareCosts, iv: Intervals): CareCosts {
  return {
    cpuPaste: perDay(c.cpuPaste, iv.cpuPaste),
    gpuPaste: perDay(c.gpuPaste, iv.gpuPaste),
    fanClean: perDay(c.fanClean, iv.fan),
    repair: perDay(c.repair, iv.repair),
  };
}

/** Tabla de pérdida promedio para toda la grilla de pasta/limpieza (no depende del valor del H/s). */
interface HeatTable {
  combos: { cpu: number; gpu: number; fan: number; loss: number }[];
}

const heatCache = new Map<string, HeatTable>();

function heatTable(t: Thermal, hasFans: boolean): HeatTable {
  const key = `${t.sealed}|${t.cpu}|${t.gpu}|${t.airflow}|${t.target}|${t.flow}|${hasFans}`;
  const hit = heatCache.get(key);
  if (hit) return hit;

  const fanOpts = hasFans ? FAN_OPTS : [NEVER];
  const cpuRise = CPU_OPTS.map((iv) => {
    const a = new Float64Array(HORIZON_H);
    for (let h = 0; h < HORIZON_H; h++) a[h] = pasteRise(ageAt(h + 0.5, iv), HEAT.clocks.cpuPaste);
    return a;
  });
  const gpuRise = GPU_OPTS.map((iv) => {
    const a = new Float64Array(HORIZON_H);
    for (let h = 0; h < HORIZON_H; h++) a[h] = pasteRise(ageAt(h + 0.5, iv), HEAT.clocks.gpuPaste);
    return a;
  });

  const combos: HeatTable["combos"] = [];
  for (const fanIv of fanOpts) {
    // temperatura sin pasta seca, por hora
    const cpuBase = new Float64Array(HORIZON_H);
    const gpuBase = new Float64Array(HORIZON_H);
    for (let h = 0; h < HORIZON_H; h++) {
      const [c, g] = chipTemps(t, 0, 0, ageAt(h + 0.5, fanIv));
      cpuBase[h] = c;
      gpuBase[h] = g;
    }
    CPU_OPTS.forEach((cpuIv, ci) => {
      const cr = cpuRise[ci];
      GPU_OPTS.forEach((gpuIv, gi) => {
        const gr = gpuRise[gi];
        let sum = 0;
        for (let h = 0; h < HORIZON_H; h++) {
          const c = cpuBase[h] + cr[h];
          const g = gpuBase[h] + gr[h];
          sum += heatLossPct(c > g ? c : g);
        }
        combos.push({ cpu: cpuIv, gpu: gpuIv, fan: fanIv, loss: sum / HORIZON_H });
      });
    });
  }
  const table = { combos };
  if (heatCache.size > 4000) heatCache.clear();
  heatCache.set(key, table);
  return table;
}

/** Intervalos que maximizan `valorHs × hs − costos` (§12.6). `valuePerHs`: USD/día por H/s sano. */
export function optimalIntervals(st: PcStats, valuePerHs: number): Intervals {
  const lossValue = (valuePerHs * st.healthyHs) / 100; // USD/día por cada punto de pérdida
  let best = { cpu: NEVER, gpu: NEVER, fan: NEVER };
  let bestScore = -Infinity;
  for (const c of heatTable(st.thermal, st.fans > 0).combos) {
    const cost =
      perDay(st.care.cpuPaste, c.cpu) + perDay(st.care.gpuPaste, c.gpu) + perDay(st.care.fanClean, c.fan);
    const score = -lossValue * c.loss - cost;
    if (score > bestScore + 1e-12) {
      bestScore = score;
      best = c;
    }
  }
  let repair = NEVER;
  let bestRep = -Infinity;
  for (const r of REPAIR_OPTS) {
    const score = -lossValue * wearAvgPct(r) - perDay(st.care.repair, r);
    if (score > bestRep + 1e-12) {
      bestRep = score;
      repair = r;
    }
  }
  return { cpuPaste: best.cpu, gpuPaste: best.gpu, fan: best.fan, repair };
}

// ---------------------------------------------------------------- plan desde el estado del juego

/** Lo que muestra el panel Care del juego (§12.11). Temperaturas opcionales. */
export interface LiveCare {
  cpuPastePct: number;
  gpuPastePct: number;
  fanPct: number;
  hardwarePct: number;
  cpuC: number | null;
  gpuC: number | null;
}

export type CareTask = "cpuPaste" | "gpuPaste" | "fan" | "repair";

export interface PlanStep {
  task: CareTask;
  inH: number;
  /** % que mostrará la barra al momento de hacerlo. */
  atPct: number;
  /** Chip más caliente antes/después (reparar: desgaste % antes/después). */
  before: number;
  after: number;
  cost: number;
  everyH: number;
}

export interface CarePlan {
  ages: Record<CareTask, number>;
  offsets: [number, number];
  tempsNow: [number, number];
  heatLossNow: number;
  wearLossNow: number;
  speedNow: number;
  idle: { hoursTo70: number | null; maxTemp: number; maxLoss: number };
  steps: PlanStep[];
  skipped: CareTask[];
}

const LIFE: Record<CareTask, number> = {
  cpuPaste: HEAT.clocks.cpuPaste,
  gpuPaste: HEAT.clocks.gpuPaste,
  fan: HEAT.clocks.fan,
  repair: HEAT.clocks.hardware,
};
const COST_KEY: Record<CareTask, keyof CareCosts> = {
  cpuPaste: "cpuPaste",
  gpuPaste: "gpuPaste",
  fan: "fanClean",
  repair: "repair",
};
const wearPct = (h: number) => HEAT.wearMaxPct * Math.min(h / HEAT.clocks.hardware, 1);
// el juego redondea las barras hacia abajo: se toma el medio del intervalo
const ageFromPct = (pct: number, life: number) => (1 - Math.min(100, Math.max(0, pct) + 0.5) / 100) * life;

export function carePlan(st: PcStats, iv: Intervals, live: LiveCare): CarePlan {
  const ages: Record<CareTask, number> = {
    cpuPaste: ageFromPct(live.cpuPastePct, LIFE.cpuPaste),
    gpuPaste: ageFromPct(live.gpuPastePct, LIFE.gpuPaste),
    fan: ageFromPct(live.fanPct, LIFE.fan),
    repair: ageFromPct(live.hardwarePct, LIFE.repair),
  };
  const model = chipTemps(st.thermal, ages.cpuPaste, ages.gpuPaste, ages.fan);
  const offsets: [number, number] = [
    live.cpuC === null ? 0 : live.cpuC - model[0],
    live.gpuC === null ? 0 : live.gpuC - model[1],
  ];
  const hottest = (a: Record<CareTask, number>) => {
    const [c, g] = chipTemps(st.thermal, a.cpuPaste, a.gpuPaste, a.fan);
    return Math.max(c + offsets[0], g + offsets[1]);
  };
  const tempsNow: [number, number] = [model[0] + offsets[0], model[1] + offsets[1]];
  const heatLossNow = heatLossPct(Math.max(...tempsNow));
  const wearLossNow = wearPct(ages.repair);

  const STEP = 0.1;
  let hoursTo70: number | null = null;
  let maxTemp = 0;
  for (let t = 0; t <= LIFE.repair; t += STEP) {
    const temp = hottest({
      cpuPaste: ages.cpuPaste + t,
      gpuPaste: ages.gpuPaste + t,
      fan: ages.fan + t,
      repair: 0,
    });
    if (hoursTo70 === null && temp >= HEAT.throttleC) hoursTo70 = t;
    if (temp > maxTemp) maxTemp = temp;
  }

  const ivs: Record<CareTask, number> = {
    cpuPaste: iv.cpuPaste,
    gpuPaste: iv.gpuPaste,
    fan: st.fans > 0 ? iv.fan : NEVER,
    repair: iv.repair,
  };
  const tasks = (Object.keys(ivs) as CareTask[]).filter((k) => ivs[k] !== NEVER);
  const skipped = (Object.keys(ivs) as CareTask[]).filter((k) => ivs[k] === NEVER);
  const cur = { ...ages };
  const steps: PlanStep[] = [];
  const horizon = Math.max(0, ...tasks.map((k) => ivs[k] - ages[k])) + STEP;
  for (let t = 0; t <= horizon && steps.length < tasks.length; t += STEP) {
    for (const k of tasks) {
      if (cur[k] < ivs[k] - 1e-9 || steps.some((s) => s.task === k)) continue;
      const before = k === "repair" ? wearPct(cur.repair) : hottest(cur);
      cur[k] = 0;
      steps.push({
        task: k,
        inH: t,
        atPct: Math.max(0, Math.floor(100 * (1 - ivs[k] / LIFE[k]))),
        before,
        after: k === "repair" ? 0 : hottest(cur),
        cost: st.care[COST_KEY[k]],
        everyH: ivs[k],
      });
    }
    for (const k of Object.keys(cur) as CareTask[]) cur[k] += STEP;
  }
  steps.sort((a, b) => a.inH - b.inH);

  return {
    ages,
    offsets,
    tempsNow,
    heatLossNow,
    wearLossNow,
    speedNow: 100 - Math.min(HEAT.floorPct, heatLossNow + wearLossNow),
    idle: { hoursTo70, maxTemp, maxLoss: heatLossPct(maxTemp) },
    steps,
    skipped,
  };
}

// ---------------------------------------------------------------- isla

export interface RewardsCfg {
  /** Tokens por cada 100 H/s de isla por día (§12.8). */
  tokensPer100: number;
  /** USD por token. */
  tokenUsd: number;
}

export interface IslandCfg {
  islandLevel: number;
  care: CareMode;
  custom: Intervals;
}

export interface PcResult {
  spec: PcSpec;
  stats: PcStats;
  valid: boolean;
  matched: boolean;
  intervals: Intervals;
  freshTemp: number;
  maxTemp: number;
  heatLoss: number;
  wearLoss: number;
  loss: number;
  effHs: number;
  islandHs: number;
  tokens: number;
  income: number;
  electricity: number;
  care: CareCosts;
  careTotal: number;
  net: number;
}

export interface Infra {
  plots: number;
  islandLevel: number;
  powerLevel: number;
  powerOk: boolean;
  cost: number;
  minutes: number;
}

export interface IslandResult {
  pcs: PcResult[];
  matched: number;
  comboPct: number;
  levelPct: number;
  bonusPct: number;
  healthyHs: number;
  islandHs: number;
  watts: number;
  tokens: number;
  income: number;
  electricity: number;
  care: number;
  net: number;
  pcCost: number;
  infra: Infra;
  investment: number;
  paybackDays: number | null;
  warnings: string[];
}

export function tokensPerDay(islandHs: number, r: RewardsCfg): number {
  if (islandHs <= 0) return 0;
  return (islandHs / 100) * Math.max(0, r.tokensPer100);
}

const ceilCent = (x: number) => Math.ceil(x * 100 - 1e-6) / 100;

export function infraFor(nPcs: number, chosenLevel: number, needLevel: number, watts: number, record: number): Infra {
  let level = Math.max(1, chosenLevel, needLevel);
  let plots = Math.max(1, Math.min(MAX_DESKS, nPcs));
  for (;;) {
    const plotLevel = Math.max(...PLOTS.slice(0, plots).map((p) => p.needIsland));
    const nextLevel = Math.max(level, plotLevel);
    const nextPlots = Math.max(plots, ISLAND_LEVELS[nextLevel - 1].needPlots);
    if (nextLevel === level && nextPlots === plots) break;
    level = nextLevel;
    plots = nextPlots;
  }
  let powerLevel = POWER_LEVELS.findIndex((p) => p.cap >= watts);
  const powerOk = powerLevel >= 0;
  if (!powerOk) powerLevel = POWER_LEVELS.length - 1;

  const r100 = record / 100;
  let cost = 0;
  let minutes = 0;
  for (let i = 1; i < plots; i++) {
    cost += ceilCent(PLOT_BASE + PLOT_PER_100 * r100);
    minutes += PLOTS[i].min;
  }
  for (let l = 2; l <= level; l++) {
    const L = ISLAND_LEVELS[l - 1];
    cost += ceilCent(L.base + L.per100 * r100);
    minutes += L.min;
  }
  for (let p = 1; p <= powerLevel; p++) {
    cost += ceilCent(POWER_LEVELS[p].base + POWER_PER_100 * r100);
    minutes += POWER_LEVELS[p].min;
  }
  return { plots, islandLevel: level, powerLevel, powerOk, cost, minutes };
}

function intervalsFor(cfg: IslandCfg, st: PcStats, valuePerHs: number): Intervals {
  if (cfg.care === "none") return NO_CARE;
  if (cfg.care === "auto") return AUTO_INTERVALS;
  if (cfg.care === "custom") {
    const r = cfg.custom.repair;
    return { ...cfg.custom, repair: r === NEVER ? NEVER : Math.max(MIN_REPAIR_H, r) };
  }
  return optimalIntervals(st, valuePerHs);
}

export function evaluateIsland(specs: PcSpec[], cfg: IslandCfg, rewards: RewardsCfg): IslandResult {
  const stats = specs.map(pcStats);
  const warnings: string[] = [];

  const counts = new Map<string, number>();
  for (const s of specs) if (s.cardId) counts.set(s.cardId, (counts.get(s.cardId) ?? 0) + 1);
  for (const [id, n] of counts) {
    const lim = CARD.get(id)?.limit;
    if (lim && n > lim) warnings.push(`Solo puedes tener ${lim} ${CARD.get(id)!.name} por isla.`);
  }
  if (specs.length > MAX_DESKS) warnings.push(`La isla tiene ${MAX_DESKS} escritorios como máximo.`);

  const valid = stats.map((s) => s.errors.length === 0);
  const strongest = Math.max(0, ...stats.filter((_, i) => valid[i]).map((s) => s.healthyHs));
  const matchedArr = stats.map(
    (s, i) => valid[i] && s.healthyHs >= MATCH_MIN_HS && s.healthyHs >= MATCH_SHARE * strongest,
  );
  const matched = matchedArr.filter(Boolean).length;
  const comboPct = COMBO_PCT[Math.min(matched, COMBO_PCT.length - 1)];
  const level = Math.min(Math.max(1, cfg.islandLevel), ISLAND_LEVELS.length);
  const levelPct = matched >= 2 ? ISLAND_LEVELS[level - 1].bonus : 0;
  const bonusPct = comboPct + levelPct;
  const k = 1 + bonusPct / 100;

  const healthyHs = stats.reduce((s, st, i) => s + (valid[i] ? st.healthyHs : 0), 0);
  const watts = stats.reduce((s, st, i) => s + (valid[i] ? st.watts : 0), 0);

  // valor de 1 H/s sano: se itera porque depende de las pérdidas (§12.8)
  let islandHs = healthyHs * k;
  let intervals: Intervals[] = [];
  let runs: { heat: number; wear: number; maxTemp: number }[] = [];
  for (let pass = 0; pass < 2; pass++) {
    const usd = tokensPerDay(islandHs, rewards) * rewards.tokenUsd;
    const valuePerHs = islandHs > 0 ? (usd / islandHs) * k : 0;
    intervals = stats.map((st) => intervalsFor(cfg, st, valuePerHs));
    runs = stats.map((st, i) => {
      const iv = intervals[i];
      const ivFans = st.fans > 0 ? iv : { ...iv, fan: NEVER };
      const hr = heatRun(st.thermal, ivFans);
      return { heat: hr.avgLoss, wear: wearAvgPct(iv.repair), maxTemp: hr.maxTemp };
    });
    islandHs = stats.reduce(
      (s, st, i) => s + (valid[i] ? st.healthyHs * (1 - Math.min(HEAT.floorPct, runs[i].heat + runs[i].wear) / 100) * k : 0),
      0,
    );
    if (cfg.care !== "optimal") break;
  }

  const tokens = tokensPerDay(islandHs, rewards);
  const income = tokens * rewards.tokenUsd;

  const pcs: PcResult[] = specs.map((spec, i) => {
    const st = stats[i];
    const run = runs[i];
    const loss = Math.min(HEAT.floorPct, run.heat + run.wear);
    const effHs = valid[i] ? st.healthyHs * (1 - loss / 100) : 0;
    const pcIsland = effHs * k;
    const shareOf = islandHs > 0 ? pcIsland / islandHs : 0;
    const iv = st.fans > 0 ? intervals[i] : { ...intervals[i], fan: NEVER };
    const care = valid[i] ? careCostPerDay(st.care, iv) : { cpuPaste: 0, gpuPaste: 0, fanClean: 0, repair: 0 };
    const careTotal = care.cpuPaste + care.gpuPaste + care.fanClean + care.repair;
    const electricity = valid[i] ? (st.watts * 24 * USD_PER_KWH) / 1000 : 0;
    const pcIncome = income * shareOf;
    return {
      spec,
      stats: st,
      valid: valid[i],
      matched: matchedArr[i],
      intervals: iv,
      freshTemp: Math.max(...chipTemps(st.thermal, 0, 0, 0)),
      maxTemp: run.maxTemp,
      heatLoss: run.heat,
      wearLoss: run.wear,
      loss,
      effHs,
      islandHs: pcIsland,
      tokens: tokens * shareOf,
      income: pcIncome,
      electricity,
      care,
      careTotal,
      net: pcIncome - electricity - careTotal,
    };
  });

  const electricity = pcs.reduce((s, p) => s + p.electricity, 0);
  const care = pcs.reduce((s, p) => s + p.careTotal, 0);
  const net = income - electricity - care;
  const pcCost = stats.reduce((s, st) => s + st.price, 0);
  const needLevel = Math.max(1, ...stats.map((s) => s.minIsland));
  const infra = infraFor(specs.length, level, needLevel, watts, healthyHs);
  if (!infra.powerOk) warnings.push(`Las PCs suman ${watts} W y el máximo de la isla es ${POWER_LEVELS[POWER_LEVELS.length - 1].cap} W.`);
  if (needLevel > level) warnings.push(`Alguna PC necesita isla nivel ${needLevel} (más de ${HALL1_HS_CAP} H/s o tarjeta que lo exige).`);
  if (infra.islandLevel > level) {
    warnings.push(`Con ${specs.length} PCs necesitas isla nivel ${infra.islandLevel}: el bonus se calcula con el nivel ${level} que elegiste.`);
  }
  const investment = pcCost + infra.cost;

  return {
    pcs,
    matched,
    comboPct,
    levelPct,
    bonusPct,
    healthyHs,
    islandHs,
    watts,
    tokens,
    income,
    electricity,
    care,
    net,
    pcCost,
    infra,
    investment,
    paybackDays: net > 0 ? investment / net : null,
    warnings,
  };
}

// ---------------------------------------------------------------- precio del token

export interface DexPair {
  chainId?: string;
  url?: string;
  baseToken?: { address?: string };
  priceUsd?: string;
  liquidity?: { usd?: number };
}

export interface TokenPrice {
  usd: number;
  liquidityUsd: number;
  url: string | null;
}

/** Pool de mayor liquidez donde CRH es el token base (RULES.md §12.8). */
export function pickTokenPrice(pairs: DexPair[], address: string, chainId: string): TokenPrice | null {
  let best: TokenPrice | null = null;
  for (const p of pairs) {
    const usd = Number(p.priceUsd);
    const liq = p.liquidity?.usd ?? 0;
    if (p.chainId !== chainId || p.baseToken?.address?.toLowerCase() !== address.toLowerCase()) continue;
    if (!Number.isFinite(usd) || usd <= 0) continue;
    if (!best || liq > best.liquidityUsd) best = { usd, liquidityUsd: liq, url: p.url ?? null };
  }
  return best;
}

// ---------------------------------------------------------------- herramientas

let keySeq = 0;
export const newKey = () => `pc${Date.now().toString(36)}${(keySeq++).toString(36)}`;

export function specFromCard(card: Card): PcSpec {
  return { key: newKey(), cardId: card.id, parts: cardParts(card) };
}

export type PartKind = keyof Pick<Parts, "board" | "cpu" | "gpu" | "ram" | "ssd" | "cooler" | "case" | "psu" | "fan">;

export const PART_KINDS: { kind: PartKind; label: string }[] = [
  { kind: "board", label: "Placa" },
  { kind: "cpu", label: "CPU" },
  { kind: "gpu", label: "GPU" },
  { kind: "ram", label: "RAM" },
  { kind: "ssd", label: "SSD" },
  { kind: "cooler", label: "Cooler" },
  { kind: "case", label: "Gabinete" },
  { kind: "psu", label: "Fuente" },
  { kind: "fan", label: "Ventiladores" },
];

export const CATALOG: Record<PartKind, { id: string; name: string; price: number }[]> = {
  board: BOARDS, cpu: CPUS, gpu: GPUS, ram: RAMS, ssd: SSDS, cooler: COOLERS, case: CASES, psu: PSUS, fan: FANS,
};

export interface Upgrade {
  pcIndex: number;
  label: string;
  cost: number;
  deltaNet: number;
  paybackDays: number | null;
  parts: Parts;
}

/** Cambios de una sola pieza (o una unidad más de RAM/ventilador) para la PC `i` (§12.10). */
export function upgradesFor(specs: PcSpec[], i: number, cfg: IslandCfg, rewards: RewardsCfg, base: IslandResult): Upgrade[] {
  const p = specs[i].parts;
  if (!p) return [];
  const candidates: { label: string; cost: number; parts: Parts }[] = [];
  for (const { kind, label } of PART_KINDS) {
    for (const item of CATALOG[kind]) {
      if (item.id === p[kind]) continue;
      const qty = kind === "ram" ? p.ramQty : kind === "fan" ? Math.max(1, p.fanQty) : 1;
      const parts = { ...p, [kind]: item.id } as Parts;
      if (kind === "fan" && p.fanQty === 0) parts.fanQty = 1;
      candidates.push({ label: `${label}: ${item.name}${qty > 1 ? ` ×${qty}` : ""}`, cost: item.price * qty, parts });
    }
  }
  candidates.push({ label: `+1 ${RAM.get(p.ram)!.name}`, cost: RAM.get(p.ram)!.price, parts: { ...p, ramQty: p.ramQty + 1 } });
  candidates.push({ label: `+1 ${FAN.get(p.fan)!.name}`, cost: FAN.get(p.fan)!.price, parts: { ...p, fanQty: p.fanQty + 1 } });

  const out: Upgrade[] = [];
  for (const c of candidates) {
    const spec: PcSpec = { key: specs[i].key, cardId: null, parts: c.parts };
    if (pcStats(spec).errors.length) continue;
    const next = specs.map((s, j) => (j === i ? spec : s));
    const r = evaluateIsland(next, cfg, rewards);
    const deltaNet = r.net - base.net;
    if (deltaNet <= 1e-6) continue;
    out.push({ pcIndex: i, label: c.label, cost: c.cost, deltaNet, paybackDays: c.cost / deltaNet, parts: c.parts });
  }
  return out.sort((a, b) => (a.paybackDays ?? Infinity) - (b.paybackDays ?? Infinity));
}
