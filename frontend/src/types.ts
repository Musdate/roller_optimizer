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
  quantity: number;
  inRoom?: number; // cuántas copias tengo puestas en la sala ahora mismo
  planned?: number; // cuántas copias planeo adquirir ("Nueva adquisición")
  image?: string;
  order?: number; // orden de agregado (para ordenar "más reciente")
}

export type SlotMode = "miners" | "cells";
export type TargetUnit = "PH" | "EH" | "ZH";

export interface OptimizeRequestBody {
  target_final_power: string;
  max_slots: number;
  slot_mode: SlotMode;
  time_limit_s: number;
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
}

export interface OptimizeResponse {
  status: string;
  picks: Pick[];
  raw_power: string;
  bonus_bp: number;
  bonus_pct: number;
  final_power: string;
  target_final_power: string;
  headroom: string;
  headroom_pct: number;
  slots_used: number;
  cells_used: number;
  scale: number;
  solve_time_s: number;
}
