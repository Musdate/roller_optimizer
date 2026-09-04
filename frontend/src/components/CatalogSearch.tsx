import { useEffect, useRef, useState } from "react";
import { fetchCatalog, refreshCatalog, checkCatalog, errMsg } from "../api";
import { useCatalogPoll } from "../catalogPoll";
import { useDragState } from "../dragState";
import { useCooldown } from "../useCooldown";
import { ROOM_DND_MIME } from "./RoomRacks";
import { bpToPct, formatPower } from "../power";
import MinerSprite from "./MinerSprite";
import type { CatalogMiner } from "../types";

// "chequear" pega directo a la API de RollerCoin sin ningún candado del
// lado del backend (a diferencia de "recargar", se puede llamar aunque haya
// una descarga completa en curso) -- mismo host que ya nos devolvió 429 al
// sincronizar la sala real con clicks seguidos, así que va con el mismo
// cooldown. "recargar" en cambio ya está protegido server-side (un segundo
// click mientras hay una descarga en curso es un no-op inmediato) -- ahí el
// cooldown es solo para prolijidad de UI, y 15s alcanza de sobra (coincide
// con el intervalo del polling de /api/health que ya usa la app).
const CHECK_COOLDOWN_MS = 30_000;
const REFRESH_COOLDOWN_MS = 15_000;

function CooldownBar({ durationMs, cooldownKey }: { durationMs: number; cooldownKey: number }) {
  return (
    <div
      className="cooldown-bar"
      key={cooldownKey}
      style={{ animation: `cooldown-bar-drain ${durationMs}ms linear forwards` }}
    />
  );
}

export default function CatalogSearch({ loading: catalogBusy = false }: { loading?: boolean }) {
  const [term, setTerm] = useState("");
  const [rows, setRows] = useState<CatalogMiner[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const setDraggingWidth = useDragState((s) => s.setWidth);
  const debounce = useRef<number>();
  const checkCooldown = useCooldown(CHECK_COOLDOWN_MS);
  const refreshCooldown = useCooldown(REFRESH_COOLDOWN_MS);

  useEffect(() => {
    window.clearTimeout(debounce.current);
    debounce.current = window.setTimeout(() => {
      setLoading(true);
      setErr(null);
      fetchCatalog(term, 60)
        .then(setRows)
        .catch((e) => setErr(errMsg(e)))
        .finally(() => setLoading(false));
    }, 250);
    return () => window.clearTimeout(debounce.current);
  }, [term]);

  return (
    <div className="panel">
      <div className="row between">
        <h2>Catálogo de mineros</h2>
        <div className="row">
          <div className="cooldown-wrap">
            <button
              className="tiny"
              disabled={checking || catalogBusy || checkCooldown.active}
              title={
                checkCooldown.active
                  ? `Espera ${checkCooldown.secondsLeft}s antes de volver a chequear`
                  : "Chequeo rápido (unos segundos): compara contra la API de RollerCoin sin bajar todo el catálogo"
              }
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
                  .catch((e) => setErr(errMsg(e)))
                  .finally(() => {
                    setChecking(false);
                    checkCooldown.trigger();
                  });
              }}
            >
              {checking ? "chequeando…" : "chequear"}
            </button>
            {checkCooldown.active && (
              <CooldownBar durationMs={CHECK_COOLDOWN_MS} cooldownKey={checkCooldown.key} />
            )}
          </div>
          <div className="cooldown-wrap">
            <button
              className="tiny"
              disabled={loading || catalogBusy || refreshCooldown.active}
              title={
                catalogBusy
                  ? "Ya hay una descarga del catálogo en curso"
                  : refreshCooldown.active
                    ? `Espera ${refreshCooldown.secondsLeft}s antes de volver a recargar`
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
                  .catch((e) => setErr(errMsg(e)))
                  .finally(() => refreshCooldown.trigger());
              }}
            >
              {catalogBusy ? "descargando…" : "recargar"}
            </button>
            {refreshCooldown.active && (
              <CooldownBar durationMs={REFRESH_COOLDOWN_MS} cooldownKey={refreshCooldown.key} />
            )}
          </div>
        </div>
      </div>
      {refreshMsg && <div className="muted" style={{ fontSize: 12 }}>{refreshMsg}</div>}
      <div className="search-wrap" style={{ margin: "8px 0" }}>
        <input
          placeholder="Buscar por nombre… (ej: Bite Of Ice)"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
        />
        {term && (
          <button className="search-clear" title="Limpiar búsqueda" onClick={() => setTerm("")}>
            ×
          </button>
        )}
      </div>
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
