import type {
  CatalogMiner,
  OptimizeRequestBody,
  OptimizeResponse,
} from "./types";

const BASE = "/api";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}${text ? ` — ${text}` : ""}`);
  }
  return res.json() as Promise<T>;
}

export function fetchCatalog(search = "", limit = 60): Promise<CatalogMiner[]> {
  const q = new URLSearchParams({ search, limit: String(limit) });
  return fetch(`${BASE}/catalog?${q}`).then((r) => json<CatalogMiner[]>(r));
}

export function refreshCatalog(): Promise<{ ok: boolean; catalog_size: number }> {
  return fetch(`${BASE}/catalog/refresh`, { method: "POST" }).then((r) => json(r));
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
