import { useRef } from "react";
import { useStore, selectInventoryList } from "../store";

/** Exportar / importar todo el estado: sala (inRoom), inventario (quantity) y
 *  nueva adquisición (planned), más el nº de salas. */
export default function DataIO() {
  const fullList = useStore(selectInventoryList);
  const rooms = useStore((s) => s.rooms);
  const loadState = useStore((s) => s.loadState);
  const fileRef = useRef<HTMLInputElement>(null);

  function exportJson() {
    const data = { version: 1, rooms, inventory: fullList };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "mi-sala-roller.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  function importJson(file: File) {
    file
      .text()
      .then((txt) => {
        const parsed = JSON.parse(txt);
        const payload = Array.isArray(parsed)
          ? { inventory: parsed } // formato antiguo: array plano
          : { rooms: parsed?.rooms, inventory: parsed?.inventory };
        if (!Array.isArray(payload.inventory)) {
          alert("El archivo no tiene un inventario válido.");
          return;
        }
        if (
          fullList.length &&
          !confirm(
            "Se reemplazan sala, inventario y nueva adquisición actuales por los del archivo. ¿Continuar?",
          )
        ) {
          return;
        }
        loadState(payload);
      })
      .catch((e) => alert("JSON inválido: " + e));
  }

  return (
    <div className="row" style={{ gap: 6 }}>
      <button className="tiny" onClick={exportJson} disabled={!fullList.length}>
        exportar
      </button>
      <button className="tiny" onClick={() => fileRef.current?.click()}>
        importar
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="application/json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) importJson(f);
        }}
      />
    </div>
  );
}
