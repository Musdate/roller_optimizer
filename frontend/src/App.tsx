import { useEffect, useState } from "react";
import { health, fetchCatalogByIds } from "./api";
import { useStore } from "./store";
import { useCatalogPoll } from "./catalogPoll";
import CatalogSearch from "./components/CatalogSearch";
import InventoryTable from "./components/InventoryTable";
import RoomPanel from "./components/RoomPanel";
import PlannedTable from "./components/PlannedTable";
import OptimizePanel from "./components/OptimizePanel";
import DataIO from "./components/DataIO";
import PasteInventory from "./components/PasteInventory";

export default function App() {
  const [backendDown, setBackendDown] = useState(false);
  const [missingBase, setMissingBase] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [progressDone, setProgressDone] = useState(0);
  const [progressTotal, setProgressTotal] = useState(0);
  const [showPaste, setShowPaste] = useState(false);
  const pollTick = useCatalogPoll((s) => s.tick);

  useEffect(() => {
    let alive = true;
    let timer: number | undefined;
    let didInitialSync = false;
    let wasRefreshing = false;

    // Al agregar un minero al inventario se copian sus datos (imagen,
    // poder…) tal como estaban en ese momento, y quedan congelados aunque
    // el catálogo se corrija después (p. ej. el saneo de apóstrofos en las
    // URLs de imagen — ver "Devil's Ember"). En vez de un botón manual, se
    // resincroniza solo: una vez apenas el catálogo está listo (arreglos
    // que ya estaban en el catálogo, aunque no haya recarga de por medio) y
    // de nuevo cada vez que una recarga completa termina (por si trajo
    // datos nuevos/corregidos).
    const syncInventory = () => {
      const ids = Object.keys(useStore.getState().inventory);
      if (!ids.length) return;
      fetchCatalogByIds(ids)
        .then((rows) => useStore.getState().syncWithCatalog(rows))
        .catch(() => {}); // silencioso: nunca debe bloquear ni ensuciar la carga de la app
    };

    const poll = () => {
      health()
        .then((h) => {
          if (!alive) return;
          setBackendDown(false);
          const m = Number(h.catalog_missing_base) || 0;
          const busy = Boolean(h.catalog_refreshing);
          setMissingBase(m);
          setRefreshing(busy);
          setProgressDone(Number(h.catalog_progress_done) || 0);
          setProgressTotal(Number(h.catalog_progress_total) || 0);

          if (!busy && !didInitialSync) {
            didInitialSync = true;
            syncInventory();
          } else if (!busy && wasRefreshing) {
            syncInventory(); // la recarga en curso recién terminó
          }
          wasRefreshing = busy;

          // mientras haya descarga en curso, refrescar cada 15 s
          if (busy || m > 20) timer = window.setTimeout(poll, 15000);
        })
        .catch(() => {
          if (!alive) return;
          setBackendDown(true);
          timer = window.setTimeout(poll, 15000);
        });
    };

    poll();
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
    // pollTick: cuando alguien (p. ej. el botón "recargar") pide un poll
    // inmediato, se corta el timer de 15 s que hubiera y se vuelve a
    // consultar /api/health ya mismo -- si no, el loop ya se había
    // detenido (catálogo al día) y nunca se enteraba de la recarga nueva.
  }, [pollTick]);

  const loadingCatalog = refreshing || (missingBase ?? 0) > 20;

  return (
    <div className="app">
      <div className="row between" style={{ marginBottom: 12 }}>
        <h1 style={{ margin: 0 }}>Optimizador de sala</h1>
        <div className="row" style={{ gap: 6 }}>
          <button className="tiny" onClick={() => setShowPaste((v) => !v)}>
            pegar inventario
          </button>
          <DataIO />
        </div>
      </div>

      {showPaste && <PasteInventory onDone={() => setShowPaste(false)} />}

      {backendDown && (
        <div className="err" style={{ marginBottom: 12 }}>
          No se puede conectar con el backend (¿corriste uvicorn en :8000?)
        </div>
      )}

      {loadingCatalog && (
        <div className="warn-box">
          Descargando el catálogo de RollerCoin
          {progressTotal > 0 ? (
            <>
              {" "}
              — <b>{progressDone}</b> de <b>{progressTotal}</b> mineros nuevos cargados
            </>
          ) : (
            missingBase !== null &&
            missingBase > 0 && (
              <> — faltan <b>{missingBase}</b> mineros de nivel base</>
            )
          )}
          . Se actualiza solo cada 15 s.
        </div>
      )}

      <OptimizePanel />

      <div style={{ marginTop: 16 }}>
        <RoomPanel />
      </div>

      <div className="grid" style={{ marginTop: 16 }}>
        <div className="stack">
          <CatalogSearch loading={loadingCatalog} />
          <PlannedTable />
        </div>
        <InventoryTable />
      </div>
    </div>
  );
}
