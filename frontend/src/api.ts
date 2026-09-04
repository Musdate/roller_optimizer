import type {
  CatalogMiner,
  OptimizeRequestBody,
  OptimizeResponse,
  RoomImportItem,
} from "./types";

const BASE = "/api";

/** Mensaje amigable para mostrar de un error atrapado (sin el "Error: " que
 *  antepone `String(e)` a una excepción real). */
export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    // FastAPI manda los errores como {"detail": "mensaje"} -- se muestra
    // solo ese mensaje (amigable) en vez del texto crudo con el status HTTP.
    let detail = text;
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed.detail === "string") detail = parsed.detail;
    } catch {
      // no era JSON: se usa el texto tal cual
    }
    throw new Error(detail || `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export function fetchCatalog(search = "", limit = 60): Promise<CatalogMiner[]> {
  const q = new URLSearchParams({ search, limit: String(limit) });
  return fetch(`${BASE}/catalog?${q}`).then((r) => json<CatalogMiner[]>(r));
}

/** Datos actuales del catálogo para reconciliar ítems ya guardados en el
 *  inventario: al agregar un minero se copian sus datos (imagen, poder…) tal
 *  como estaban en ese momento, y quedan congelados aunque el catálogo se
 *  corrija después (p. ej. el saneo de apóstrofos en las URLs de imagen). */
export function fetchCatalogByIds(ids: string[]): Promise<CatalogMiner[]> {
  if (!ids.length) return Promise.resolve([]);
  const q = new URLSearchParams({ ids: ids.join(",") });
  return fetch(`${BASE}/catalog/by-ids?${q}`).then((r) => json<CatalogMiner[]>(r));
}

export function refreshCatalog(): Promise<{
  ok: boolean;
  started: boolean;
  already_running: boolean;
  refreshing: boolean;
  missing_base: number;
}> {
  return fetch(`${BASE}/catalog/refresh`, { method: "POST" }).then((r) => json(r));
}

/** Chequeo rápido (~segundos) contra la API de RollerCoin: cuántos nombres
 *  de minero hay ahora vs. los que ya tenemos, sin arrancar la recarga
 *  completa (~15-20 min). */
export function checkCatalog(): Promise<{
  remote_names: number;
  local_names: number;
  new_count: number;
  new_names: string[];
}> {
  return fetch(`${BASE}/catalog/check`).then((r) => json(r));
}

export interface ParsedItem {
  id: string;
  name: string;
  level: number;
  power: string;
  bonus_bp: number;
  width: number;
  quantity: number;
  image: string;
  matched: boolean;
}

export function parseInventoryText(
  text: string,
): Promise<{ items: ParsedItem[]; skipped: string[] }> {
  return fetch(`${BASE}/inventory/parse`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  }).then((r) => json(r));
}

export function optimize(body: OptimizeRequestBody): Promise<OptimizeResponse> {
  return fetch(`${BASE}/optimize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => json<OptimizeResponse>(r));
}

export function health(): Promise<Record<string, unknown>> {
  return fetch(`${BASE}/health`).then((r) => json(r));
}

/** Sala real (ya puesta en el juego) de un usuario de RollerCoin, para
 *  reemplazar la sala local con lo que de verdad está puesto ahí. */
export function importRealRoom(
  userId: string,
): Promise<{ items: RoomImportItem[]; total_cells: number; room_slots: (string | null)[] }> {
  const q = new URLSearchParams({ userId });
  return fetch(`${BASE}/room/import?${q}`).then((r) => json(r));
}
