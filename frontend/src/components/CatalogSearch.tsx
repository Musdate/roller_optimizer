import { useEffect, useRef, useState } from "react";
import { fetchCatalog, refreshCatalog, checkCatalog, errMsg } from "../api";
import { useCatalogPoll } from "../catalogPoll";
import { useStore } from "../store";
import { useDragState } from "../dragState";
import { useCooldown } from "../useCooldown";
import { ROOM_DND_MIME } from "./RoomRacks";
import { bpToPct, formatPower } from "../power";
import MinerSprite from "./MinerSprite";
import type { CatalogMiner } from "../types";

// "actualizar" chequea contra la API de RollerCoin y, si falta algo, lo trae
// en el acto: el backend saltea los nombres que ya tienen su nivel base, así
// que son unos pocos pedidos y termina en segundos. El chequeo pega directo a
// la API sin ningún candado del lado del backend -- mismo host que ya nos
// devolvió 429 al sincronizar la sala real con clicks seguidos, así que va
// con cooldown. "recarga completa" (re-baja los ~1400 nombres) ya está
// protegida server-side (un segundo click mientras hay una descarga en curso
// es un no-op inmediato) -- ahí el cooldown es solo para prolijidad de UI, y
// 15s alcanza de sobra (coincide con el intervalo del polling de /api/health).
const CHECK_COOLDOWN_MS = 30_000;
const REFRESH_COOLDOWN_MS = 15_000;

const etaText = (seconds: number): string =>
  seconds < 90 ? `${Math.max(1, seconds)} s` : `${Math.round(seconds / 60)} min`;

function AddArrow() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
      <path d="M5 12h13M12 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

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
  const addFromCatalog = useStore((s) => s.addFromCatalog);
  const addPlanned = useStore((s) => s.addPlanned);
  const inventory = useStore((s) => s.inventory);
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
                  ? `Espera ${checkCooldown.secondsLeft}s antes de volver a buscar`
                  : "Busca mineros nuevos en la API de RollerCoin y trae solo los que falten (unos segundos)"
              }
              onClick={() => {
                setErr(null);
                setChecking(true);
                checkCatalog()
                  .then((r) => {
                    if (r.pending === 0) {
                      setRefreshMsg(
                        `Estás al día: tienes ${r.local_names} de ${r.remote_names} nombres.`,
                      );
                      return;
                    }
                    const falta =
                      r.new_count > 0
                        ? `${r.new_count} minero${r.new_count > 1 ? "s" : ""} nuevo${r.new_count > 1 ? "s" : ""}${
                            r.new_names.length
                              ? ` (${r.new_names.slice(0, 5).join(", ")}${r.new_count > 5 ? "…" : ""})`
                              : ""
                          }`
                        : `${r.pending} nombre${r.pending > 1 ? "s" : ""} por completar`;
                    return refreshCatalog().then(() => {
                      setRefreshMsg(`Hay ${falta} — trayéndolos (~${etaText(r.eta_seconds)}).`);
                      useCatalogPoll.getState().requestPoll();
                    });
                  })
                  .catch((e) => setErr(errMsg(e)))
                  .finally(() => {
                    setChecking(false);
                    checkCooldown.trigger();
                  });
              }}
            >
              {checking ? "buscando…" : "actualizar"}
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
                    : "Vuelve a bajar todo el catálogo de RollerCoin (~15 min, en segundo plano). Normalmente alcanza con “actualizar”"
              }
              onClick={() => {
                if (!confirm("Recargar el catálogo completo desde RollerCoin.\nCorre en segundo plano y tarda ~15 min.\nPara traer solo los mineros nuevos usa “actualizar”. ¿Continuar?")) return;
                setErr(null);
                refreshCatalog(true)
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
              {catalogBusy ? "descargando…" : "recarga completa"}
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
        {rows.map((m) => {
          const owned = inventory[m.id]?.quantity ?? 0;
          const planned = inventory[m.id]?.planned ?? 0;
          return (
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
                {owned > 0 && ` · tienes ${owned}`}
                {planned > 0 && ` · planeo ${planned}`}
              </div>
            </div>
            <div className="list-item-actions">
              <button
                className="tiny cat-add"
                title="Sumar 1 a Mi inventario"
                onClick={() => addFromCatalog(m, 1)}
              >
                <span>inventario</span>
                <AddArrow />
              </button>
              <button
                className="tiny cat-add"
                title="Sumar 1 a Nueva adquisición"
                onClick={() => addPlanned(m, 1)}
              >
                <span>nuevo</span>
                <AddArrow />
              </button>
            </div>
          </div>
          );
        })}
        {!loading && rows.length === 0 && <div className="muted">sin resultados</div>}
      </div>
    </div>
  );
}
