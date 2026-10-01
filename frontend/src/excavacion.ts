// Solver del minijuego de excavación de Sunflower Land (RULES.md §11).
// Lógica pura: sin React ni DOM, corre dentro de `excavacion.worker.ts`.

export const SIZE = 10;
export const CELLS = SIZE * SIZE;
export const SAND = "Sand";
export const CRAB = "Crab";

export interface FormCell {
  x: number;
  y: number;
  item: string;
}

export interface Problem {
  patterns: string[];
  formations: Record<string, FormCell[]>;
  /** celda (y*10+x) → lo que salió al excavar: un ítem, "Sand" o "Crab" */
  observed: Record<number, string>;
}

export interface Analysis {
  /** "exact": todas las configuraciones; "sampled": MCMC (§11.4) */
  mode: "exact" | "sampled";
  consistent: boolean;
  samples: number;
  items: string[];
  /** ítem → probabilidad por celda */
  perItem: Record<string, number[]>;
  anyTreasure: number[];
  /** seguro que no hay tesoro: ningún patrón puede cubrirla (o, en modo exacto,
   *  ninguna configuración la cubre) */
  impossible: boolean[];
  /** ítem seguro en la celda (solo modo exacto; en muestreo "todas las muestras"
   *  no es prueba) */
  certain: (string | null)[];
  /** por patrón del día (mismo orden): "located" = posición segura (solo modo
   *  exacto); "partial" = seguro que ya se excavó parte de él */
  patternStatus: ("located" | "partial" | "none")[];
}

export interface Advice {
  target: string;
  total: number;
  found: number;
  prob: number[];
  best: number | null;
  /** casillas empatadas con `best` (la incluye; ordenadas de mayor a menor probabilidad) */
  tied: number[];
  /** ± puntos de probabilidad de `best` (2 errores estándar); null en modo exacto */
  precision: number | null;
  /** "rollout": la simulación eligió otra casilla que la más probable, con ventaja clara;
   *  "timeout": el dispositivo no alcanzó a simular y quedó la más probable (§11.5) */
  method: "greedy" | "rollout" | "timeout";
  /** excavaciones de 1 casilla disponibles */
  budget: number;
  /** P(encontrar todas las que faltan con `budget` excavaciones) siguiendo la recomendación; null sin presupuesto */
  success: number | null;
  drill: { x: number; y: number; expected: number } | null;
}

const NEIGHBORS: number[][] = Array.from({ length: CELLS }, (_, c) => {
  const x = c % SIZE;
  const y = Math.floor(c / SIZE);
  const out: number[] = [];
  if (x > 0) out.push(c - 1);
  if (x < SIZE - 1) out.push(c + 1);
  if (y > 0) out.push(c - SIZE);
  if (y < SIZE - 1) out.push(c + SIZE);
  return out;
});

// ---- máscaras de 100 bits en 4 palabras ---------------------------------------

type Mask = Uint32Array;
const W = 4;

function maskOf(cells: number[]): Mask {
  const m = new Uint32Array(W);
  for (const c of cells) m[c >>> 5] |= 1 << (c & 31);
  return m;
}

// ---- modelo -------------------------------------------------------------------

interface Placement {
  cells: number[];
  codes: number[];
  mask: Mask;
}

interface Model {
  items: string[]; // código k → items[k - 1]
  inst: Placement[][]; // placements válidos (filtro estático) por instancia
  treasureCells: number[]; // excavadas con tesoro: deben quedar cubiertas
  treasureMask: Mask;
  crabs: number[];
  crabNeighbor: Mask[];
  dug: boolean[];
}

function buildModel(p: Problem): Model | null {
  const items: string[] = [];
  const code = new Map<string, number>();
  for (const name of p.patterns)
    for (const f of p.formations[name] ?? [])
      if (!code.has(f.item)) {
        items.push(f.item);
        code.set(f.item, items.length);
      }

  const dug = Array<boolean>(CELLS).fill(false);
  const treasureCells: number[] = [];
  const crabs: number[] = [];
  const sandNear = Array<boolean>(CELLS).fill(false);
  for (const [k, v] of Object.entries(p.observed)) {
    const c = Number(k);
    dug[c] = true;
    if (v === CRAB) crabs.push(c);
    else if (v === SAND) for (const n of NEIGHBORS[c]) sandNear[n] = true;
    else if (code.has(v)) treasureCells.push(c);
    else return null; // salió un ítem que ningún patrón del día tiene
  }

  const inst: Placement[][] = p.patterns.map((name) => {
    const form = p.formations[name] ?? [];
    const xs = form.map((f) => f.x);
    const ys = form.map((f) => f.y);
    const out: Placement[] = [];
    for (let oy = -Math.min(...ys); oy + Math.max(...ys) < SIZE; oy++)
      for (let ox = -Math.min(...xs); ox + Math.max(...xs) < SIZE; ox++) {
        const cells: number[] = [];
        const codes: number[] = [];
        let ok = true;
        for (const f of form) {
          const c = (f.y + oy) * SIZE + f.x + ox;
          const seen = p.observed[c];
          if ((seen !== undefined && seen !== f.item) || sandNear[c]) {
            ok = false;
            break;
          }
          cells.push(c);
          codes.push(code.get(f.item)!);
        }
        if (ok) out.push({ cells, codes, mask: maskOf(cells) });
      }
    return out;
  });

  return {
    items,
    inst,
    treasureCells,
    treasureMask: maskOf(treasureCells),
    crabs,
    crabNeighbor: crabs.map((c) => maskOf(NEIGHBORS[c])),
    dug,
  };
}

// ---- estado de una configuración --------------------------------------------------

class State {
  occ = new Uint32Array(W);
  cover = new Uint8Array(CELLS);
  choice: number[];
  constructor(private m: Model) {
    this.choice = m.inst.map(() => -1);
  }
  fits(pl: Placement): boolean {
    const a = pl.mask;
    const o = this.occ;
    return !((a[0] & o[0]) | (a[1] & o[1]) | (a[2] & o[2]) | (a[3] & o[3]));
  }
  place(i: number, k: number) {
    const pl = this.m.inst[i][k];
    for (let w = 0; w < W; w++) this.occ[w] |= pl.mask[w];
    for (let t = 0; t < pl.cells.length; t++) this.cover[pl.cells[t]] = pl.codes[t];
    this.choice[i] = k;
  }
  remove(i: number) {
    const pl = this.m.inst[i][this.choice[i]];
    for (let w = 0; w < W; w++) this.occ[w] &= ~pl.mask[w];
    for (const c of pl.cells) this.cover[c] = 0;
    this.choice[i] = -1;
  }
  crabOk(j: number): boolean {
    const n = this.m.crabNeighbor[j];
    const o = this.occ;
    return ((n[0] & o[0]) | (n[1] & o[1]) | (n[2] & o[2]) | (n[3] & o[3])) !== 0;
  }
}

// `&` devuelve int32 con signo y Uint32Array guarda sin signo: sin `>>> 0`,
// el bit 31 (celdas 31, 63, 95) nunca compara igual.
function covers(mask: Mask, need: Mask): boolean {
  return (
    (mask[0] & need[0]) >>> 0 === need[0] &&
    (mask[1] & need[1]) >>> 0 === need[1] &&
    (mask[2] & need[2]) >>> 0 === need[2] &&
    (mask[3] & need[3]) >>> 0 === need[3]
  );
}

function touches(mask: Mask, n: Mask): boolean {
  return ((mask[0] & n[0]) | (mask[1] & n[1]) | (mask[2] & n[2]) | (mask[3] & n[3])) !== 0;
}

// ---- búsqueda exacta ----------------------------------------------------------

type Rng = () => number;

/**
 * Recorre todas las configuraciones válidas (o, con `rng`, se detiene en la
 * primera en orden aleatorio). Cada configuración se visita una sola vez:
 * primero se decide qué patrón cubre cada tesoro ya excavado (como en un
 * exact cover: cada celda la cubre exactamente uno), después se ubican los
 * patrones restantes en orden fijo.
 * Devuelve null si se pasó del presupuesto de trabajo (con `rng`, siempre
 * devuelve el resultado y `outOfBudget` dice si la búsqueda quedó incompleta).
 */
function enumerate(
  m: Model,
  budget: number,
  maxLeaves: number,
  rng?: Rng,
): { leaves: Uint8Array[]; choices: number[][]; outOfBudget: boolean } | null {
  const s = new State(m);
  const leaves: Uint8Array[] = [];
  const choices: number[][] = [];
  const n = m.inst.length;
  let work = 0;
  let abort = false;
  let outOfBudget = false;
  const firstOnly = rng !== undefined;

  const shuffled = <T,>(a: T[]): T[] => {
    if (!rng) return a;
    const b = a.slice();
    for (let i = b.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [b[i], b[j]] = [b[j], b[i]];
    }
    return b;
  };

  const crabsFeasible = (): boolean => {
    for (let j = 0; j < m.crabs.length; j++) {
      if (s.crabOk(j)) continue;
      let can = false;
      for (let i = 0; i < n && !can; i++) {
        if (s.choice[i] !== -1) continue;
        for (const pl of m.inst[i]) {
          work++;
          if (touches(pl.mask, m.crabNeighbor[j]) && s.fits(pl)) {
            can = true;
            break;
          }
        }
      }
      if (!can) return false;
    }
    return true;
  };

  const rec = (): void => {
    if (abort) return;
    if (work > budget) {
      abort = true;
      outOfBudget = true;
      return;
    }
    let bestOpts: [number, number][] | null = null;
    for (const c of m.treasureCells) {
      if (s.cover[c]) continue;
      const opts: [number, number][] = [];
      for (let i = 0; i < n; i++) {
        if (s.choice[i] !== -1) continue;
        const list = m.inst[i];
        for (let k = 0; k < list.length; k++) {
          work++;
          if (list[k].cells.includes(c) && s.fits(list[k])) opts.push([i, k]);
        }
      }
      if (!opts.length) return;
      if (!bestOpts || opts.length < bestOpts.length) bestOpts = opts;
      if (bestOpts.length === 1) break;
    }
    if (bestOpts) {
      for (const [i, k] of shuffled(bestOpts)) {
        s.place(i, k);
        rec();
        s.remove(i);
        if (abort) return;
      }
      return;
    }
    if (!crabsFeasible()) return;
    const i = s.choice.indexOf(-1);
    if (i === -1) {
      leaves.push(s.cover.slice());
      choices.push(s.choice.slice());
      if (firstOnly || leaves.length > maxLeaves) abort = true;
      return;
    }
    const list = m.inst[i];
    const order = shuffled(list.map((_, k) => k));
    for (const k of order) {
      work++;
      if (!s.fits(list[k])) continue;
      s.place(i, k);
      rec();
      s.remove(i);
      if (abort) return;
    }
  };

  rec();
  if (firstOnly) return { leaves, choices, outOfBudget };
  if (abort) return null;
  return { leaves, choices, outOfBudget };
}

// ---- demostraciones (modo muestreo, §11.5) -------------------------------------------

const PROOF_BUDGET = 3_000_000;
const PROOF_TIME_MS = 1500;

/** ¿Existe alguna configuración válida? null = no se pudo decidir dentro del presupuesto. */
function feasible(m: Model): boolean | null {
  if (m.inst.some((l) => !l.length)) return false;
  const r = enumerate(m, PROOF_BUDGET, 1, mulberry32(1))!;
  if (r.leaves.length) return true;
  return r.outOfBudget ? null : false;
}

// ---- MCMC (Gibbs de 1 y 2 patrones) -------------------------------------------------

function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Lo que falta cubrir con los patrones que se acaban de sacar: tesoros
 *  descubiertos y cangrejos sin vecina cubierta. */
function pending(m: Model, s: State): { need: Mask; crabs: Mask[] } {
  const need = new Uint32Array(W);
  for (const c of m.treasureCells) if (!s.cover[c]) need[c >>> 5] |= 1 << (c & 31);
  const crabs: Mask[] = [];
  for (let j = 0; j < m.crabs.length; j++) if (!s.crabOk(j)) crabs.push(m.crabNeighbor[j]);
  return { need, crabs };
}

function gibbsSingle(m: Model, s: State, i: number, rng: Rng) {
  s.remove(i);
  const { need, crabs } = pending(m, s);
  const cands: number[] = [];
  const list = m.inst[i];
  for (let k = 0; k < list.length; k++) {
    const pl = list[k];
    if (!s.fits(pl) || !covers(pl.mask, need)) continue;
    if (crabs.every((n) => touches(pl.mask, n))) cands.push(k);
  }
  s.place(i, cands[Math.floor(rng() * cands.length)]);
}

function gibbsPair(m: Model, s: State, i: number, j: number, rng: Rng) {
  s.remove(i);
  s.remove(j);
  const { need, crabs } = pending(m, s);
  const a = m.inst[i].map((_, k) => k).filter((k) => s.fits(m.inst[i][k]));
  const b = m.inst[j].map((_, k) => k).filter((k) => s.fits(m.inst[j][k]));
  const u = new Uint32Array(W);
  const pairs: number[] = [];
  for (const ka of a) {
    const ma = m.inst[i][ka].mask;
    for (const kb of b) {
      const mb = m.inst[j][kb].mask;
      if ((ma[0] & mb[0]) | (ma[1] & mb[1]) | (ma[2] & mb[2]) | (ma[3] & mb[3])) continue;
      for (let w = 0; w < W; w++) u[w] = ma[w] | mb[w];
      if (!covers(u, need) || !crabs.every((n) => touches(u, n))) continue;
      pairs.push(ka, kb);
    }
  }
  const p = Math.floor(rng() * (pairs.length / 2)) * 2;
  s.place(i, pairs[p]);
  s.place(j, pairs[p + 1]);
}

const CHAINS = 4;
const BURN_IN = 300;
const SWEEPS = 12_000;
/** lotes por cadena para estimar el error estándar (batch means, §11.4) */
const BATCHES_PER_CHAIN = 5;
/** batch means subestima ~20 % la variación real entre corridas (medido, §11.4) */
const SE_CALIBRATION = 1.3;

function sample(m: Model, seed: number): { chains: Uint8Array[][]; choices: number[][] } | null {
  const chains: Uint8Array[][] = [];
  const choices: number[][] = [];
  const n = m.inst.length;
  for (let ch = 0; ch < CHAINS; ch++) {
    const rng = mulberry32(seed + ch * 7919);
    let init: number[] | null = null;
    for (let attempt = 0; attempt < 20 && !init; attempt++) {
      const r = enumerate(m, 2_000_000, 1, rng);
      if (r && r.choices.length) init = r.choices[0];
    }
    if (!init) return null;
    const s = new State(m);
    init.forEach((k, i) => s.place(i, k));
    const out: Uint8Array[] = [];
    for (let sw = 0; sw < BURN_IN + SWEEPS; sw++) {
      for (let i = 0; i < n; i++) gibbsSingle(m, s, i, rng);
      if (n > 1) {
        const i = Math.floor(rng() * n);
        let j = Math.floor(rng() * (n - 1));
        if (j >= i) j++;
        gibbsPair(m, s, i, j, rng);
      }
      if (sw >= BURN_IN) {
        out.push(s.cover.slice());
        choices.push(s.choice.slice());
      }
    }
    chains.push(out);
  }
  return { chains, choices };
}

// ---- análisis -----------------------------------------------------------------

const EXACT_BUDGET = 20_000_000;
const EXACT_MAX_LEAVES = 150_000;

export interface Computed {
  analysis: Analysis;
  /** configuraciones (cobertura por celda, códigos 1..items.length) */
  configs: Uint8Array[];
  dug: boolean[];
  /** resultado de excavar cada celda en cada configuración (se arma al primer uso) */
  outcomes?: Uint8Array;
  /** lotes contiguos de igual tamaño para el error estándar (0 = modo exacto) */
  batches: number;
}

function marginals(configs: Uint8Array[], k: number): number[] {
  const out = Array<number>(CELLS).fill(0);
  for (const cfg of configs) for (let c = 0; c < CELLS; c++) if (cfg[c] === k) out[c]++;
  return out.map((v) => (configs.length ? v / configs.length : 0));
}

export function analyze(p: Problem, seed = 12345): Computed {
  const m = buildModel(p);
  const empty = (items: string[]): Computed => ({
    analysis: {
      mode: "exact",
      consistent: false,
      samples: 0,
      items,
      perItem: {},
      anyTreasure: Array(CELLS).fill(0),
      impossible: Array(CELLS).fill(false),
      certain: Array(CELLS).fill(null),
      patternStatus: p.patterns.map(() => "none"),
    },
    configs: [],
    dug: Array(CELLS).fill(false),
    batches: 0,
  });
  if (!m || m.inst.some((l) => !l.length)) return empty(m?.items ?? []);

  let configs: Uint8Array[];
  let choices: number[][];
  let mode: Analysis["mode"] = "exact";
  const exact = enumerate(m, EXACT_BUDGET, EXACT_MAX_LEAVES);
  if (exact) {
    if (!exact.leaves.length) return empty(m.items);
    configs = exact.leaves;
    choices = exact.choices;
  } else {
    const r = sample(m, seed);
    if (!r) return empty(m.items);
    mode = "sampled";
    configs = r.chains.flat();
    choices = r.choices;
  }

  const perItem: Record<string, number[]> = {};
  m.items.forEach((name, i) => (perItem[name] = marginals(configs, i + 1)));
  const anyTreasure = Array<number>(CELLS).fill(0);
  for (const cfg of configs) for (let c = 0; c < CELLS; c++) if (cfg[c]) anyTreasure[c]++;
  for (let c = 0; c < CELLS; c++) anyTreasure[c] /= configs.length;

  const coverable = Array<boolean>(CELLS).fill(false);
  for (const list of m.inst) for (const pl of list) for (const c of pl.cells) coverable[c] = true;
  // En modo exacto, lo que dicen todas las configuraciones es seguro. En
  // muestreo, las muestras solo proponen candidatos (y descartan: cada muestra
  // es una configuración válida); cada candidato se demuestra buscando un
  // contraejemplo, y lo que no se alcanza a demostrar no se muestra.
  const deadline = Date.now() + PROOF_TIME_MS;
  const proven = (counterexample: () => Model) =>
    mode === "exact" || (Date.now() < deadline && feasible(counterexample()) === false);
  const restrict = (ids: number[], keep: (pl: Placement, k: number) => boolean): Model => ({
    ...m,
    inst: m.inst.map((list, i) => (ids.includes(i) ? list.filter(keep) : list)),
  });
  const allIds = m.inst.map((_, i) => i);

  const certain: (string | null)[] = Array(CELLS).fill(null);
  for (let c = 0; c < CELLS; c++) {
    if (m.dug[c]) continue;
    const k = m.items.findIndex((it) => perItem[it][c] === 1) + 1;
    if (!k) continue;
    const without = () => restrict(allIds, (pl) => pl.codes[pl.cells.indexOf(c)] !== k);
    if (proven(without)) certain[c] = m.items[k - 1];
  }

  // patrones repetidos: sus instancias son intercambiables, así que se mira qué
  // posiciones ocupa el grupo en todas las configuraciones
  const patternStatus: Analysis["patternStatus"] = p.patterns.map(() => "none");
  const groups = new Map<string, number[]>();
  p.patterns.forEach((name, i) => groups.set(name, [...(groups.get(name) ?? []), i]));
  const touchesDug = (pl: Placement) => pl.cells.some((c) => m.dug[c]);
  for (const ids of groups.values()) {
    const fixed = [...new Set(ids.map((i) => choices[0][i]))].filter((k) =>
      choices.every((ch) => ids.some((i) => ch[i] === k)),
    );
    const locked = fixed.filter((k) => proven(() => restrict(ids, (_, kk) => kk !== k)));
    const rest = ids.slice(locked.length);
    locked.forEach((_, j) => (patternStatus[ids[j]] = "located"));
    if (!rest.length) continue;
    const lockedSet = new Set(locked);
    const touched = choices.every((ch) => ids.some((i) => !lockedSet.has(ch[i]) && touchesDug(m.inst[i][ch[i]])));
    const noneTouch = () => restrict(ids, (pl, k) => lockedSet.has(k) || !touchesDug(pl));
    if (touched && proven(noneTouch)) patternStatus[rest[0]] = "partial";
  }

  const impossible = Array.from(
    { length: CELLS },
    (_, c) =>
      !m.dug[c] &&
      (!coverable[c] ||
        (anyTreasure[c] === 0 && proven(() => ({ ...m, treasureCells: [...m.treasureCells, c] })))),
  );

  return {
    analysis: {
      mode,
      consistent: true,
      samples: configs.length,
      items: m.items,
      perItem,
      anyTreasure,
      impossible,
      certain,
      patternStatus,
    },
    configs,
    dug: m.dug,
    batches: mode === "sampled" ? CHAINS * BATCHES_PER_CHAIN : 0,
  };
}

// ---- recomendación (§11.5) -------------------------------------------------------

/** Lo que revela cada celda en cada configuración: el código del ítem, o Crab /
 *  Sand (códigos items+1 / items+2) según sus vecinas. */
function outcomeTable(comp: Computed): Uint8Array {
  if (comp.outcomes) return comp.outcomes;
  const crab = comp.analysis.items.length + 1;
  const out = new Uint8Array(comp.configs.length * CELLS);
  comp.configs.forEach((cfg, s) => {
    for (let c = 0; c < CELLS; c++)
      out[s * CELLS + c] = cfg[c] || (NEIGHBORS[c].some((n) => cfg[n]) ? crab : crab + 1);
  });
  comp.outcomes = out;
  return out;
}

/** El rollout usa todas las configuraciones como partículas (filtro bayesiano
 *  exacto). Con más, o en modo muestreo, no se hace: con una submuestra el
 *  jugador simulado pierde la información a las pocas excavaciones y la
 *  estimación deja de servir para comparar casillas. */
const MAX_ROLLOUT_CONFIGS = 30_000;
const STAGE1_WORLDS = 120;
const STAGE2_WORLDS = 600;
const TOP_K = 8;
/** la casilla simulada reemplaza a la más probable solo si le gana por ≥ 2 errores estándar */
const MIN_Z = 2;
/** en un dispositivo lento la simulación se abandona y queda la casilla más probable */
const ROLLOUT_DEADLINE_MS = 4000;

interface Group {
  surv: Int32Array;
  next: number;
}

interface Plan {
  best: number;
  success: number | null;
  method: Advice["method"];
}

/**
 * Rollout (§11.5): para cada casilla candidata se juega el resto de la partida
 * en tableros posibles ("mundos"), excavando después siempre la casilla más
 * probable, y se cuenta en cuántos se encuentran todas las copias que faltan.
 * Las probabilidades dentro de la simulación salen de un filtro de partículas:
 * las configuraciones ya calculadas se descartan cuando contradicen lo que se
 * "excavó", sin volver a resolver el modelo.
 * Los "mundos" son configuraciones al azar del mismo conjunto: es exacto
 * porque están todas.
 */
function rollout(comp: Computed, code: number, remaining: number, budget: number, greedy: number, seed: number): Plan {
  const all = outcomeTable(comp);
  const S = comp.configs.length;
  const rng = mulberry32(seed);

  const out = all;
  const worlds = Int32Array.from({ length: S }, (_, i) => i);
  for (let i = S - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [worlds[i], worlds[j]] = [worlds[j], worlds[i]];
  }

  const dug = comp.dug;
  const tStart = new Int32Array(S + 1);
  const tCells: number[] = [];
  for (let k = 0; k < S; k++) {
    for (let c = 0; c < CELLS; c++) if (!dug[c] && out[k * CELLS + c] === code) tCells.push(c);
    tStart[k + 1] = tCells.length;
  }

  const simDug = Uint8Array.from(dug, (d) => (d ? 1 : 0));
  const counts = new Int32Array(CELLS);
  const bufA = new Int32Array(S);
  const bufB = new Int32Array(S);

  const greedyPick = (surv: Int32Array, n: number): number => {
    counts.fill(0);
    for (let i = 0; i < n; i++) {
      const k = surv[i];
      for (let j = tStart[k]; j < tStart[k + 1]; j++) counts[tCells[j]]++;
    }
    let b = -1;
    for (let c = 0; c < CELLS; c++) if (!simDug[c] && (b < 0 || counts[c] > counts[b])) b = c;
    return b;
  };

  // por candidata: partículas agrupadas por lo que revelaría, y la jugada más
  // probable que sigue en cada grupo (no dependen del mundo)
  const groupsOf = (first: number): Map<number, Group> => {
    const lists = new Map<number, number[]>();
    for (let k = 0; k < S; k++) {
      const o = out[k * CELLS + first];
      let l = lists.get(o);
      if (!l) lists.set(o, (l = []));
      l.push(k);
    }
    simDug[first] = 1;
    const groups = new Map<number, Group>();
    for (const [o, l] of lists) {
      const surv = Int32Array.from(l);
      groups.set(o, { surv, next: greedyPick(surv, surv.length) });
    }
    simDug[first] = 0;
    return groups;
  };

  const play = (first: number, w: number, g: Group): number => {
    let found = out[w * CELLS + first] === code ? 1 : 0;
    let left = budget - 1;
    if (found >= remaining || left <= 0) return found;
    const touched = [first];
    simDug[first] = 1;
    let surv = g.surv;
    let n = surv.length;
    let cell = g.next;
    for (;;) {
      const o = out[w * CELLS + cell];
      if (o === code) found++;
      left--;
      if (found >= remaining || left <= 0) break;
      simDug[cell] = 1;
      touched.push(cell);
      const dst = surv === bufA ? bufB : bufA;
      let m = 0;
      for (let i = 0; i < n; i++) {
        const k = surv[i];
        if (out[k * CELLS + cell] === o) dst[m++] = k;
      }
      surv = dst;
      n = m;
      cell = greedyPick(surv, n);
    }
    for (const c of touched) simDug[c] = 0;
    return found;
  };

  // mismos mundos para todas las candidatas: la comparación es pareada
  const evaluate = (first: number, n: number) => {
    const groups = groupsOf(first);
    const ok = new Uint8Array(n);
    const found = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const w = worlds[i % S];
      const f = play(first, w, groups.get(out[w * CELLS + first])!);
      found[i] = f;
      ok[i] = f >= remaining ? 1 : 0;
    }
    return { ok, found };
  };
  const sum = (a: Uint8Array) => a.reduce((t, v) => t + v, 0);

  const t0 = Date.now();
  const stage1: { c: number; ok: number; found: number }[] = [];
  for (let c = 0; c < CELLS; c++) {
    if (dug[c]) continue;
    if (Date.now() - t0 > ROLLOUT_DEADLINE_MS) return { best: greedy, success: null, method: "timeout" };
    const r = evaluate(c, STAGE1_WORLDS);
    stage1.push({ c, ok: sum(r.ok), found: sum(r.found) });
  }
  stage1.sort((a, b) => b.ok - a.ok || b.found - a.found);
  const finalists = new Set(stage1.slice(0, TOP_K).map((r) => r.c));
  finalists.add(greedy);

  const results = new Map<number, { ok: Uint8Array; found: Uint8Array }>();
  for (const c of finalists) results.set(c, evaluate(c, STAGE2_WORLDS));
  const base = results.get(greedy)!;
  // si completar es imposible en todos lados, se compara cuántas copias se encuentran
  const metric = [...results.values()].some((r) => sum(r.ok) > 0) ? "ok" : "found";

  let best = greedy;
  let bestMean = sum(base[metric]) / STAGE2_WORLDS;
  for (const [c, r] of results) {
    if (c === greedy) continue;
    const d = Array.from(r[metric], (v, i) => v - base[metric][i]);
    const mean = d.reduce((t, v) => t + v, 0) / d.length;
    const sd = Math.sqrt(d.reduce((t, v) => t + (v - mean) ** 2, 0) / (d.length - 1));
    const z = sd > 0 ? mean / (sd / Math.sqrt(d.length)) : mean > 0 ? Infinity : 0;
    const m = sum(r[metric]) / STAGE2_WORLDS;
    if (z >= MIN_Z && m > bestMean) {
      best = c;
      bestMean = m;
    }
  }
  return {
    best,
    success: sum(results.get(best)!.ok) / STAGE2_WORLDS,
    method: best === greedy ? "greedy" : "rollout",
  };
}

/** Error estándar de P(ítem `code` en cada celda) por batch means (§11.4). */
function standardErrors(comp: Computed, code: number): Float64Array {
  const B = comp.batches;
  const se = new Float64Array(CELLS);
  if (!B) return se;
  const len = comp.configs.length / B;
  const mean = new Float64Array(CELLS);
  const sq = new Float64Array(CELLS);
  const cnt = new Float64Array(CELLS);
  for (let b = 0; b < B; b++) {
    cnt.fill(0);
    for (let i = b * len; i < (b + 1) * len; i++) {
      const cfg = comp.configs[i];
      for (let c = 0; c < CELLS; c++) if (cfg[c] === code) cnt[c]++;
    }
    for (let c = 0; c < CELLS; c++) {
      const v = cnt[c] / len;
      mean[c] += v;
      sq[c] += v * v;
    }
  }
  for (let c = 0; c < CELLS; c++) {
    const m = mean[c] / B;
    const variance = Math.max(0, (sq[c] - B * m * m) / (B - 1));
    se[c] = SE_CALIBRATION * Math.sqrt(variance / B);
  }
  return se;
}

/** Recomendación para un tesoro (§11.5). Con `useRollout = false`, solo la
 *  casilla más probable (la estrategia base; sirve para comparar en simulación). */
export function advise(
  comp: Computed,
  p: Problem,
  target: string,
  budget: number,
  useRollout = true,
  seed = 777,
): Advice {
  const { analysis, configs, dug } = comp;
  const code = analysis.items.indexOf(target) + 1;
  const total = p.patterns.reduce(
    (acc, name) => acc + (p.formations[name] ?? []).filter((f) => f.item === target).length,
    0,
  );
  const found = Object.values(p.observed).filter((v) => v === target).length;
  const prob = analysis.perItem[target] ?? Array(CELLS).fill(0);
  const none: Advice = {
    target,
    total,
    found,
    prob,
    best: null,
    tied: [],
    precision: null,
    method: "greedy",
    budget,
    success: null,
    drill: null,
  };
  if (!code || !configs.length || found >= total) return none;

  let greedy = -1;
  for (let c = 0; c < CELLS; c++) if (!dug[c] && (greedy < 0 || prob[c] > prob[greedy])) greedy = c;

  let best = greedy;
  let method: Advice["method"] = "greedy";
  let success: number | null = null;
  const exact = analysis.mode === "exact" && configs.length <= MAX_ROLLOUT_CONFIGS;
  if (useRollout && budget > 0 && exact) ({ best, method, success } = rollout(comp, code, total - found, budget, greedy, seed));

  const se = standardErrors(comp, code);
  const precision = comp.batches ? 2 * se[best] : null;
  // la simulación ya solo se desvía con ventaja significativa: los empates son
  // de la recomendación "más probable" (§11.5)
  let tied = [best];
  if (success === null) {
    const isTie = (c: number) =>
      comp.batches
        ? prob[c] > 0 && prob[best] - prob[c] <= 2 * Math.sqrt(se[best] ** 2 + se[c] ** 2)
        : Math.abs(prob[c] - prob[best]) < 1e-12;
    tied = [...Array(CELLS).keys()].filter((c) => !dug[c] && (c === best || isTie(c))).sort((a, b) => prob[b] - prob[a]);
  }

  let drill: Advice["drill"] = null;
  for (let y = 0; y < SIZE - 1; y++)
    for (let x = 0; x < SIZE - 1; x++) {
      let e = 0;
      for (const c of [y * SIZE + x, y * SIZE + x + 1, (y + 1) * SIZE + x, (y + 1) * SIZE + x + 1])
        if (!dug[c]) e += prob[c];
      if (!drill || e > drill.expected + 1e-12) drill = { x, y, expected: e };
    }

  return { target, total, found, prob, best, tied, precision, method, budget, success, drill };
}
