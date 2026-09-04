import { useEffect, useRef, useState } from "react";
import { fetchCatalog, refreshCatalog, checkCatalog } from "../api";
import { useCatalogPoll } from "../catalogPoll";
import { useDragState } from "../dragState";
import { ROOM_DND_MIME } from "./RoomRacks";
import { bpToPct, formatPower } from "../power";
import MinerSprite from "./MinerSprite";
import type { CatalogMiner } from "../types";

export default function CatalogSearch({ loading: catalogBusy = false }: { loading?: boolean }) {
  const [term, setTerm] = useState("");
  const [rows, setRows] = useState<CatalogMiner[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const setDraggingWidth = useDragState((s) => s.setWidth);
  const debounce = useRef<number>();

  useEffect(() => {
    window.clearTimeout(debounce.current);
    debounce.current = window.setTimeout(() => {
      setLoading(true);
      setErr(null);
      fetchCatalog(term, 60)
        .then(setRows)
        .catch((e) => setErr(String(e)))
        .finally(() => setLoading(false));
    }, 250);
    return () => window.clearTimeout(debounce.current);
  }, [term]);

  return (
    <div className="panel">
      <div className="row between">
        <h2>Catálogo de mineros</h2>
        <div className="row">
          <button
            className="tiny"
            disabled={checking || catalogBusy}
            title="Chequeo rápido (unos segundos): compara contra la API de RollerCoin sin bajar todo el catálogo"
            onClick={() => {
              setErr(null);
              setChecking(true);
              checkCatalog()
                .then((r) =>
                  setRefreshMsg(
                    r.new_count > 0
                      ? `Tienes ${r.local_names} de ${r.remote_names} nombres — hay ${r.new_count} nuevos${
                          r.new_names.length ? `: ${r.new_names.slice(0, 8).join(", ")}${r.new_count > 8 ? "…" : ""}` : ""
                        }.`
                      : `Tienes ${r.local_names} de ${r.remote_names} nombres — no hay mineros nuevos.`,
                  ),
                )
                .catch((e) => setErr(String(e)))
                .finally(() => setChecking(false));
            }}
          >
            {checking ? "chequeando…" : "chequear"}
          </button>
          <button
            className="tiny"
            disabled={loading || catalogBusy}
            title={
              catalogBusy
                ? "Ya hay una descarga del catálogo en curso"
                : "Vuelve a bajar todo el catálogo de RollerCoin (~15 min, en segundo plano)"
            }
            onClick={() => {
              if (!confirm("Recargar el catálogo completo desde RollerCoin.\nCorre en segundo plano y tarda ~15 min. ¿Continuar?")) return;
              setErr(null);
              refreshCatalog()
                .then((r) => {
                  setRefreshMsg(
                    r.already_running
                      ? "Ya había una descarga en curso."
                      : "Descarga iniciada. El progreso aparece en el aviso de arriba.",
                  );
                  // el loop de poll de App puede haberse detenido si el
                  // catálogo ya estaba al día -- esto lo despierta ya
                  // mismo para que el aviso de progreso aparezca.
                  useCatalogPoll.getState().requestPoll();
                })
                .catch((e) => setErr(String(e)));
            }}
          >
            {catalogBusy ? "descargando…" : "recargar"}
          </button>
        </div>
      </div>
      {refreshMsg && <div className="muted" style={{ fontSize: 12 }}>{refreshMsg}</div>}
      <input
        style={{ width: "100%", margin: "8px 0" }}
        placeholder="Buscar por nombre… (ej: Bite Of Ice)"
        value={term}
        onChange={(e) => setTerm(e.target.value)}
      />
      {err && <div className="err">{err}</div>}
      {loading && <div className="muted">cargando…</div>}
      <div className="scroll">
        {rows.map((m) => (
          <div
            className="list-item"
            key={m.id}
            draggable
            style={{ cursor: "grab" }}
            title="Arrastra a “Mi inventario”, a la sala o a “Nueva adquisición”"
            onDragStart={(e) => {
              e.dataTransfer.setData(
                ROOM_DND_MIME,
                JSON.stringify({ source: "catalog", miner: m }),
              );
              e.dataTransfer.setData("text/plain", m.name);
              e.dataTransfer.effectAllowed = "copy";
              setDraggingWidth(m.width);
            }}
            onDragEnd={() => setDraggingWidth(null)}
          >
            <MinerSprite url={m.image} width={m.width} size={34} level={m.level} />
            <div className="name">
              <div className="name-row">
                {m.name}
              </div>
              <div className="sub">
                {formatPower(BigInt(m.power))} · +{bpToPct(m.bonus_bp)} · {m.width} celda{m.width > 1 ? "s" : ""}
              </div>
            </div>
          </div>
        ))}
        {!loading && rows.length === 0 && <div className="muted">sin resultados</div>}
      </div>
    </div>
  );
}
