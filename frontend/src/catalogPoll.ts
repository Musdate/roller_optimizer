import { create } from "zustand";

/** Señal para forzar un poll inmediato de /api/health desde fuera de App
 *  (p. ej. justo después de disparar una recarga desde CatalogSearch).
 *  El loop de polling de App para solo cuando el catálogo ya está al día
 *  (nada en curso, pocos mineros faltantes): si en ese estado se dispara
 *  una recarga nueva, App nunca se entera de que arrancó -- nada le avisa
 *  a re-consultar /api/health -- y el aviso de progreso no aparece. */
interface CatalogPollState {
  tick: number;
  requestPoll: () => void;
}

export const useCatalogPoll = create<CatalogPollState>((set) => ({
  tick: 0,
  requestPoll: () => set((s) => ({ tick: s.tick + 1 })),
}));
