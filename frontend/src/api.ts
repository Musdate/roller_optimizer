import type {
  CatalogMiner,
  League,
  OptimizeJobStatus,
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

const NETWORK_MSG =
  "No se pudo conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.";

/** `fetch` con un mensaje claro si no hay conexión (el navegador rechaza con
 *  un "Failed to fetch" en inglés). */
function send(input: string, init?: RequestInit): Promise<Response> {
  return fetch(input, init).catch(() => {
    throw new Error(NETWORK_MSG);
  });
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    // FastAPI manda los errores propios como {"detail": "mensaje"}: se muestra
    // ese mensaje. Nunca el texto crudo ni el código HTTP.
    let detail: string | null = null;
    try {
      const parsed = JSON.parse(await res.text());
      if (parsed && typeof parsed.detail === "string") detail = parsed.detail;
    } catch {
      // no era JSON (proxy, servidor caído): mensaje genérico
    }
    if (detail) throw new Error(detail);
    if (res.status === 422)
      throw new Error("Algunos datos no son válidos. Revisa los valores e inténtalo de nuevo.");
    if (res.status >= 500)
      throw new Error("El servidor tuvo un problema inesperado. Inténtalo de nuevo en unos minutos.");
    throw new Error("No se pudo completar la solicitud. Inténtalo de nuevo.");
  }
  return res.json() as Promise<T>;
}

export function fetchCatalog(search = "", limit = 60): Promise<CatalogMiner[]> {
  const q = new URLSearchParams({ search, limit: String(limit) });
  return send(`${BASE}/catalog?${q}`).then((r) => json<CatalogMiner[]>(r));
}

/** Datos actuales del catálogo para reconciliar ítems ya guardados en el
 *  inventario: al agregar un minero se copian sus datos (imagen, poder…) tal
 *  como estaban en ese momento, y quedan congelados aunque el catálogo se
 *  corrija después (p. ej. el saneo de apóstrofos en las URLs de imagen). */
export function fetchCatalogByIds(ids: string[]): Promise<CatalogMiner[]> {
  if (!ids.length) return Promise.resolve([]);
  const q = new URLSearchParams({ ids: ids.join(",") });
  return send(`${BASE}/catalog/by-ids?${q}`).then((r) => json<CatalogMiner[]>(r));
}

/** Trae los mineros que falten. `full` re-baja todo el catálogo (~15-20
 *  min); sin eso son solo los nombres nuevos, que tardan segundos. */
export function refreshCatalog(full = false): Promise<{
  ok: boolean;
  started: boolean;
  already_running: boolean;
  refreshing: boolean;
  missing_base: number;
  full: boolean;
}> {
  const q = full ? "?full=true" : "";
  return send(`${BASE}/catalog/refresh${q}`, { method: "POST" }).then((r) => json(r));
}

/** Chequeo rápido (~segundos) contra la API de RollerCoin: cuántos nombres
 *  de minero hay ahora vs. los que ya tenemos, y cuánto costaría traer lo
 *  que falta (`pending` nombres, `eta_seconds` estimados). */
export function checkCatalog(): Promise<{
  remote_names: number;
  local_names: number;
  new_count: number;
  new_names: string[];
  pending: number;
  eta_seconds: number;
}> {
  return send(`${BASE}/catalog/check`).then((r) => json(r));
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
  return send(`${BASE}/inventory/parse`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  }).then((r) => json(r));
}

/** Inicia un trabajo de optimización en segundo plano (RULES.md §5.10). */
export function startOptimize(body: OptimizeRequestBody): Promise<{ job_id: string }> {
  return send(`${BASE}/optimize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => json(r));
}

/** Estado del trabajo. Hay que consultarlo seguido: si nadie lo hace en 15 s,
 *  el backend lo detiene. */
export function optimizeStatus(jobId: string): Promise<OptimizeJobStatus> {
  return send(`${BASE}/optimize/${jobId}`).then((r) => json<OptimizeJobStatus>(r));
}

export function stopOptimize(jobId: string): Promise<OptimizeJobStatus> {
  return send(`${BASE}/optimize/${jobId}/stop`, { method: "POST" }).then((r) =>
    json<OptimizeJobStatus>(r),
  );
}

/** Inicia un trabajo y lo consulta hasta que termina (sirve de heartbeat). */
export async function runOptimizeJob(body: OptimizeRequestBody): Promise<OptimizeResponse> {
  const { job_id } = await startOptimize(body);
  for (;;) {
    await new Promise((ok) => setTimeout(ok, 1000));
    const st = await optimizeStatus(job_id);
    if (st.state === "done" && st.result) return st.result;
    if (st.state === "error") throw new Error(st.error);
  }
}

export function fetchLeagues(): Promise<League[]> {
  return send(`${BASE}/leagues`).then((r) => json<League[]>(r));
}

export function health(): Promise<Record<string, unknown>> {
  return send(`${BASE}/health`).then((r) => json(r));
}

/** Sala real (ya puesta en el juego) de un usuario de RollerCoin, para
 *  reemplazar la sala local con lo que de verdad está puesto ahí. */
export function importRealRoom(
  userId: string,
): Promise<{ items: RoomImportItem[]; total_cells: number; room_slots: (string | null)[] }> {
  const q = new URLSearchParams({ userId });
  return send(`${BASE}/room/import?${q}`).then((r) => json(r));
}
