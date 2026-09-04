import { useEffect, useRef, useState } from "react";
import { fetchCatalog, refreshCatalog } from "../api";
import { useStore } from "../store";
import { bpToPct, formatPower } from "../power";
import MinerSprite from "./MinerSprite";
import LevelBadge from "./LevelBadge";
import type { CatalogMiner } from "../types";

export default function CatalogSearch({ loading: catalogBusy = false }: { loading?: boolean }) {
  const [term, setTerm] = useState("");
  const [rows, setRows] = useState<CatalogMiner[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null);
  const addFromCatalog = useStore((s) => s.addFromCatalog);
  const addPlanned = useStore((s) => s.addPlanned);
  const inventory = useStore((s) => s.inventory);
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
              .then((r) =>
                setRefreshMsg(
                  r.already_running
                    ? "Ya había una descarga en curso."
                    : "Descarga iniciada. El progreso aparece en el aviso de arriba.",
                ),
              )
              .catch((e) => setErr(String(e)));
          }}
        >
          {catalogBusy ? "descargando…" : "recargar"}
        </button>
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
          <div className="list-item" key={m.id}>
            <MinerSprite url={m.image} width={m.width} size={34} />
            <div className="name">
              <div className="name-row">
                <LevelBadge level={m.level} />
                {m.name}
              </div>
              <div className="sub">
                {formatPower(BigInt(m.power))} · +{bpToPct(m.bonus_bp)} · {m.width} celda{m.width > 1 ? "s" : ""}
              </div>
            </div>
            <div className="col-btns">
              <button className="tiny" onClick={() => addFromCatalog(m, 1)}>
                {inventory[m.id]?.quantity ? `tengo +1 (${inventory[m.id].quantity})` : "tengo"}
              </button>
              <button
                className="tiny"
                title="Añadir a “Nueva adquisición” (mineros que planeo obtener)"
                onClick={() => addPlanned(m, 1)}
              >
                {inventory[m.id]?.planned ? `nuevo +1 (${inventory[m.id].planned})` : "nuevo"}
              </button>
            </div>
          </div>
        ))}
        {!loading && rows.length === 0 && <div className="muted">sin resultados</div>}
      </div>
    </div>
  );
}
