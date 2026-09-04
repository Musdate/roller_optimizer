import { useEffect, useRef, useState } from "react";
import { fetchCatalog, refreshCatalog } from "../api";
import { useStore } from "../store";
import { bpToPct, formatPower } from "../power";
import MinerSprite from "./MinerSprite";
import LevelBadge from "./LevelBadge";
import type { CatalogMiner } from "../types";

export default function CatalogSearch() {
  const [term, setTerm] = useState("");
  const [rows, setRows] = useState<CatalogMiner[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const addFromCatalog = useStore((s) => s.addFromCatalog);
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
          disabled={loading}
          title="Vuelve a bajar todo el catálogo de RollerCoin. Tarda ~4 min."
          onClick={() => {
            if (!confirm("Recargar el catálogo completo desde RollerCoin.\nTarda ~4 minutos. ¿Continuar?")) return;
            setLoading(true);
            setErr(null);
            refreshCatalog()
              .then(() => fetchCatalog(term, 60).then(setRows))
              .catch((e) => setErr(String(e)))
              .finally(() => setLoading(false));
          }}
        >
          recargar (~4 min)
        </button>
      </div>
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
              <div>
                {m.name} <LevelBadge level={m.level} />
              </div>
              <div className="sub">
                {formatPower(BigInt(m.power))} · +{bpToPct(m.bonus_bp)} · {m.width} celda{m.width > 1 ? "s" : ""}
              </div>
            </div>
            <button className="tiny" onClick={() => addFromCatalog(m, 1)}>
              {inventory[m.id] ? `+1 (${inventory[m.id].quantity})` : "añadir"}
            </button>
          </div>
        ))}
        {!loading && rows.length === 0 && <div className="muted">sin resultados</div>}
      </div>
    </div>
  );
}
