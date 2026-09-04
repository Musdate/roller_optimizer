import { useEffect, useState } from "react";
import { health } from "./api";
import CatalogSearch from "./components/CatalogSearch";
import InventoryTable from "./components/InventoryTable";
import OptimizePanel from "./components/OptimizePanel";

export default function App() {
  const [backendDown, setBackendDown] = useState(false);

  useEffect(() => {
    health()
      .then(() => setBackendDown(false))
      .catch(() => setBackendDown(true));
  }, []);

  return (
    <div className="app">
      <h1 style={{ marginBottom: 12 }}>Optimizador de sala · RollerCoin</h1>

      {backendDown && (
        <div className="err" style={{ marginBottom: 12 }}>
          No se puede conectar con el backend (¿corriste uvicorn en :8000?)
        </div>
      )}

      <p className="muted" style={{ marginTop: 0 }}>
        Objetivo = <b>techo</b> de poder final: la combinación se acerca lo más
        posible sin pasarse, con el menor bonus y luego el mayor poder bruto.
      </p>

      <OptimizePanel />

      <div className="grid" style={{ marginTop: 16 }}>
        <CatalogSearch />
        <InventoryTable />
      </div>
    </div>
  );
}
