// Lógica pura + persistencia de la vista "Estrategia 12h" (portada de la app
// vanilla `barras-12h`). Sin dependencias de React. Unidad de tiempo: ms.

export const STORAGE_KEY = "ronda12-data-v3";
export const REAL_DURATION = 12 * 60 * 60 * 1000;
export const MAX_LEVEL = 3;
export const LOW_MS = 5 * 60 * 1000;

// La barra I-1 es una base fija que nunca vence (siempre partes en nivel 1).
// Las victorias reales llenan, en orden, los otros casilleros. El tope de la
// estrategia es dificultad 3 · nivel 1 (nivel 7 global): 6 victorias activas.
const WIN_SLOTS = [
  { row: 0, col: 1 },
  { row: 0, col: 2 },
  { row: 1, col: 0 },
  { row: 1, col: 1 },
  { row: 1, col: 2 },
  { row: 2, col: 0 },
] as const;
export const MAX_ACTIVE_WINS = WIN_SLOTS.length; // 6

export interface Win {
  time: number;
  duration: number;
}
export interface Game {
  id: string;
  name: string;
  icon: string;
  wins: Win[];
}
export interface S12State {
  soundEnabled: boolean;
  games: Game[];
}

// Orden según la captura de referencia; sin artes reales de RollerCoin.
export const defaultGames: { name: string; icon: string }[] = [
  { name: "Crypto Hex", icon: "🔷" },
  { name: "Coinclick", icon: "🖱️" },
  { name: "Dr. Hamster", icon: "💊" },
  { name: "Coin Match", icon: "🧩" },
  { name: "Token Surfer: Snow Ride", icon: "🏂" },
  { name: "Token Blaster", icon: "👾" },
  { name: "Coin Fisher", icon: "🎣" },
  { name: "Hamster Climber", icon: "🧗" },
  { name: "Flappy Rocket", icon: "🚀" },
  { name: "Mission Hamspossible", icon: "🕶️" },
  { name: "Crypto Hamster", icon: "🪨" },
  { name: "2048 Coins", icon: "🔢" },
  { name: "Cryptonoid", icon: "🧱" },
  { name: "Coin Flip", icon: "🔄" },
  { name: "Lambo Rider", icon: "🏎️" },
];

export function createInitialState(): S12State {
  return {
    soundEnabled: true,
    games: defaultGames.map((g, i) => ({
      id: `game-${i + 1}`,
      name: g.name,
      icon: g.icon,
      wins: [],
    })),
  };
}

function normalizeWin(win: unknown): Win {
  if (typeof win === "number") return { time: win, duration: REAL_DURATION };
  const w = win as Partial<Win>;
  return { time: Number(w.time), duration: Number(w.duration) || REAL_DURATION };
}

/** Devuelve un estado válido a partir de datos crudos (localStorage o archivo
 *  importado), o null si no se puede leer. */
export function normalizeState(raw: unknown): S12State | null {
  const r = raw as { soundEnabled?: unknown; games?: unknown[] } | null;
  if (!r || !Array.isArray(r.games) || !r.games.length) return null;
  return {
    soundEnabled: r.soundEnabled !== false,
    games: r.games.map((g, i) => {
      const game = g as Partial<Game>;
      const preset = defaultGames[i % defaultGames.length];
      return {
        id: game.id || `game-${i + 1}`,
        name: String(game.name ?? preset.name),
        // el icono lo define el código, no se toma del estado guardado
        icon: preset.icon,
        wins: Array.isArray(game.wins) ? game.wins.map(normalizeWin) : [],
      };
    }),
  };
}

export function loadState(): S12State {
  try {
    const parsed = normalizeState(JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"));
    if (parsed) return parsed;
  } catch {
    // Empieza limpio si los datos guardados no se pueden leer.
  }
  return createInitialState();
}

export function saveState(state: S12State): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage no disponible: la vista sigue funcionando en memoria.
  }
}

export const expiryOf = (w: Win): number => w.time + w.duration;

export function activeWins(game: Game, now: number): Win[] {
  return game.wins.filter((w) => expiryOf(w) > now).sort((a, b) => expiryOf(a) - expiryOf(b));
}

export function rowsForWinCount(count: number): number {
  if (count <= 0) return 1;
  const idx = Math.min(count, WIN_SLOTS.length) - 1;
  return WIN_SLOTS[idx].row + 1;
}

/** Cuántas filas de dificultad mostrar y si ya está al tope. */
export function statusFor(activeCount: number): { rows: number; isMaxed: boolean } {
  return { rows: rowsForWinCount(activeCount), isMaxed: activeCount >= MAX_ACTIVE_WINS };
}

const dateFmt = new Intl.DateTimeFormat("es-CO", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  day: "numeric",
  month: "short",
});
const timeFmt = new Intl.DateTimeFormat("es-CO", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
export const formatDate = (t: number): string => dateFmt.format(t);
export const formatTime = (t: number): string => timeFmt.format(t);

export function formatRemaining(ms: number): string {
  if (ms <= 0) return "Venció — recupera ya";
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
}

/** Versión compacta de formatRemaining para el título de la pestaña. */
export function compactRemaining(ms: number): string {
  if (ms <= 0) return "0m";
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  const s = Math.floor((ms % 60000) / 1000);
  return m > 0 ? `${m}m ${String(s).padStart(2, "0")}s` : `${s}s`;
}
export function toInputValue(time = Date.now()): string {
  const d = new Date(time - new Date().getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
}

// Huecos mayores a esto separan una ronda de la siguiente. Entre rondas hay
// ~11 h de diferencia y una ronda entera se juega en menos de 1 h, así que
// cualquier valor de 2 a 6 h separa bien los grupos.
export const ROUND_GAP_MS = 4 * 60 * 60 * 1000;
// Si la primera barra del grupo vence dentro de este margen, ya estás jugando
// esa ronda (no es una que veas venir).
export const ROUND_ACTIVE_MS = 20 * 60 * 1000;
// Antelación del aviso de "está por empezar una ronda".
export const ROUND_ALERT_MS = 5 * 60 * 1000;

export interface RoundInfo {
  start: number;
  end: number;
  count: number;
  active: boolean;
}

/** Primer grupo de barras activas, cortado por huecos > ROUND_GAP_MS. Las
 *  barras que recuperas quedan a +12 h y caen en un grupo posterior, así este
 *  rango se achica a medida que recuperas y salta solo a la siguiente ronda
 *  cuando el grupo se vacía. */
export function currentRound(state: S12State, now: number): RoundInfo | null {
  const times = state.games
    .flatMap((g) => activeWins(g, now))
    .map(expiryOf)
    .sort((a, b) => a - b);
  if (!times.length) return null;
  let end = times[0];
  let count = 1;
  for (let i = 1; i < times.length; i++) {
    if (times[i] - end > ROUND_GAP_MS) break;
    end = times[i];
    count += 1;
  }
  return { start: times[0], end, count, active: times[0] - now <= ROUND_ACTIVE_MS };
}

export function formatRoundLabel(round: RoundInfo): string {
  return round.start === round.end
    ? formatTime(round.start)
    : `${formatTime(round.start)} - ${formatTime(round.end)}`;
}

export interface BarCell {
  kind: "base" | "fill" | "empty";
  pct: number;
  low: boolean;
}
export interface BarRow {
  ticks: number;
  cells: BarCell[];
}

/** La barra I-1 siempre está llena y fija (nunca vence). Las victorias reales
 *  llenan el resto de casilleros con la que vence antes en el último casillero
 *  ocupado y las recién agregadas al principio (`wins` viene ordenada por
 *  vencimiento ascendente). Cada una se vacía linealmente durante sus 12 horas. */
export function buildRows(wins: Win[], now: number): BarRow[] {
  const rowCount = rowsForWinCount(wins.length);
  const ordered = wins.slice(0, WIN_SLOTS.length).reverse();
  const assigned = new Map<string, Win>();
  ordered.forEach((win, i) => {
    assigned.set(`${WIN_SLOTS[i].row}-${WIN_SLOTS[i].col}`, win);
  });

  const rows: BarRow[] = [];
  for (let r = 0; r < rowCount; r++) {
    const cells: BarCell[] = [];
    for (let c = 0; c < MAX_LEVEL; c++) {
      if (r === 0 && c === 0) {
        cells.push({ kind: "base", pct: 100, low: false });
        continue;
      }
      const win = assigned.get(`${r}-${c}`);
      if (!win) {
        cells.push({ kind: "empty", pct: 0, low: false });
        continue;
      }
      const left = expiryOf(win) - now;
      const pct = Math.max(0, Math.min(100, (left / REAL_DURATION) * 100));
      cells.push({ kind: "fill", pct, low: left < LOW_MS });
    }
    rows.push({ ticks: r + 1, cells });
  }
  return rows;
}
