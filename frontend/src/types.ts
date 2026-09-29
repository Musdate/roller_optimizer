export interface CatalogMiner {
  id: string;
  name: string;
  level: number;
  power: string; // GH/s (string por consistencia / futuro ZH+)
  bonus_bp: number;
  width: number;
  image: string;
}

/** Un minero tal como está puesto AHORA MISMO en la sala real del juego
 *  (desde /api/room/import). */
export interface RoomImportItem extends CatalogMiner {
  count: number;
}

export interface InventoryItem {
  id: string;
  name: string;
  level: number;
  power: string;
  bonus_bp: number;
  width: number;
  quantity: number; // copias en "Mi inventario" (independiente de la sala)
  inRoom?: number; // copias puestas en la sala
  simUsed?: number; // copias del inventario ya usadas por la simulación (RULES.md §5.5)
  planned?: number; // cuántas copias planeo adquirir ("Nueva adquisición")
  plannedUsed?: number; // copias planeadas ya usadas por la simulación (RULES.md §5.6)
  image?: string;
  order?: number; // orden de agregado (para ordenar "más reciente")
  locked?: number; // copias bloqueadas en la sala; solo en el pedido al optimizador (RULES.md §5.11)
}

export type SlotMode = "miners" | "cells";
export type TargetUnit = "PH" | "EH" | "ZH";
export type TargetMode = "league" | "custom";

/** Liga de RollerCoin (RULES.md §6.3). Poderes en GH/s. */
export interface League {
  level: number;
  title: string;
  min_power: string;
  max_power: string | null; // tope; null en la última liga
  image: string;
}

export interface OptimizeRequestBody {
  target_final_power: string | null; // null = sin tope
  margin_bp: number;
  primary_only?: boolean; // "¿cuánto aporta?" (RULES.md §5.9)
  max_slots: number;
  slot_mode: SlotMode;
  time_limit_s: number;
  allow_merges: boolean;
  excluded_merges: string[];
  inventory: InventoryItem[];
}

export interface Pick {
  id: string;
  name: string;
  level: number;
  count: number;
  power: string;
  bonus_bp: number;
  width: number;
  image?: string;
}

/** Merge propuesto: consume 2·count copias del origen, produce count de `to`. */
export interface Merge {
  from_id: string;
  from_name: string;
  from_level: number;
  from_power: string;
  count: number;
  to: CatalogMiner;
}

/** Escalón de merge descartado a mano (se identifica por el modelo origen). */
export interface ExcludedMerge {
  from_id: string;
  from_name: string;
  from_level: number;
}

export interface OptimizeResponse {
  status: string;
  picks: Pick[];
  merges: Merge[];
  raw_power: string;
  bonus_bp: number;
  bonus_pct: number;
  final_power: string;
  target_final_power: string | null;
  floor_power: string;
  in_window: boolean;
  headroom: string | null;
  headroom_pct: number;
  slots_used: number;
  cells_used: number;
  scale: number;
  solve_time_s: number;
}

export type OptimizePhase = "raw" | "final" | "tiebreak" | "miners" | "fallback" | "";

/** Estado de un trabajo de optimización (RULES.md §5.10). */
export interface OptimizeJobStatus {
  state: "running" | "done" | "error";
  elapsed_s: number;
  time_limit_s: number;
  phase: OptimizePhase;
  best: string;
  bound: string;
  stopping: boolean;
  result: OptimizeResponse | null;
  error: string;
}
