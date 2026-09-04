import { useEffect, useState } from "react";
import { health } from "./api";
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
  const [showPaste, setShowPaste] = useState(false);

  useEffect(() => {
    let alive = true;
    let timer: number | undefined;

    const poll = () => {
      health()
        .then((h) => {
          if (!alive) return;
          setBackendDown(false);
          const m = Number(h.catalog_missing_base) || 0;
          const busy = Boolean(h.catalog_refreshing);
          setMissingBase(m);
          setRefreshing(busy);
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
  }, []);

  const loadingCatalog = refreshing || (missingBase ?? 0) > 20;

  return (
    <div className="app">
      <div className="row between" style={{ marginBottom: 12 }}>
        <h1 style={{ margin: 0 }}>Optimizador de sala · RollerCoin</h1>
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
          {missingBase !== null && missingBase > 0 && (
            <> — faltan <b>{missingBase}</b> mineros de nivel base</>
          )}
          . Se actualiza solo cada 15 s.
        </div>
      )}

      <OptimizePanel />

      <div className="grid" style={{ marginTop: 16 }}>
        <CatalogSearch loading={loadingCatalog} />
        <div className="stack">
          <RoomPanel />
          <InventoryTable />
          <PlannedTable />
        </div>
      </div>
    </div>
  );
}
