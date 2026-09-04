import { useState } from "react";
import type { CSSProperties } from "react";
import RoomRacks from "./RoomRacks";
import { useStore } from "../store";
import { importRealRoom } from "../api";
import { useCooldown } from "../useCooldown";

const SYNC_COOLDOWN_MS = 30_000;
// Overlay "tipo pacman": un círculo relleno (no un anillo delgado) que
// arranca tapando el botón entero y se va comiendo a sí mismo -- se logra
// con un <circle> sin relleno pero con stroke-width = su propio radio, así
// el "trazo" ocupa desde el centro hasta el borde (donut sin agujero). El
// radio pintado (RING_R) es mayor que la mitad del botón: sobra a propósito
// más allá del círculo inscripto para tapar también las esquinas del
// cuadrado, y el wrapper lo recorta (overflow:hidden) a la silueta real del
// botón -- así la animación sigue siendo un barrido circular (Pac-Man) pero
// lo que se ve es un cuadrado, no un círculo.
const PIE_R = 13.5;
const RING_R = PIE_R * 2;
const RING_CIRC = 2 * Math.PI * PIE_R;

export default function RoomPanel() {
  const userId = useStore((s) => s.rollercoinUserId);
  const setUserId = useStore((s) => s.setRollercoinUserId);
  const importRoomFromApi = useStore((s) => s.importRoomFromApi);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const cooldown = useCooldown(SYNC_COOLDOWN_MS);
  const { active: inCooldown, secondsLeft } = cooldown;

  const sync = () => {
    if (loading || inCooldown) return; // evita ráfagas de clicks / golpear la API de más
    const id = userId.trim();
    if (!id) {
      setErr("ingresa tu ID de usuario");
      return;
    }
    setLoading(true);
    setErr(null);
    importRealRoom(id)
      .then((res) => importRoomFromApi(res.items, res.room_slots))
      .catch((e) => setErr(e instanceof Error ? e.message : "no se pudo sincronizar la sala"))
      .finally(() => {
        setLoading(false);
        cooldown.trigger();
      });
  };

  return (
    <div className="panel panel-room">
      <div className="row between">
        <h2>Mi sala</h2>
        <div className="row" style={{ gap: 6 }}>
          <input
            className="tiny user-id-input"
            placeholder="User ID"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
          />
          <div className="icon-btn-wrap">
            <button
              className={`tiny icon-btn${loading ? " spinning" : ""}`}
              title={
                inCooldown
                  ? `Espera ${secondsLeft}s antes de volver a sincronizar`
                  : "Reemplazar la sala con lo que tienes puesto ahora mismo en el juego"
              }
              onClick={sync}
              disabled={loading || inCooldown}
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12a9 9 0 1 1-2.64-6.36" strokeLinecap="round" />
                <path d="M21 3v6h-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {inCooldown && (
              <svg className="cooldown-pie" viewBox="0 0 37 37" width="37" height="37" key={cooldown.key}>
                <circle
                  cx="18.5"
                  cy="18.5"
                  r={PIE_R}
                  fill="none"
                  stroke="rgba(0,0,0,.45)"
                  strokeWidth={RING_R}
                  strokeDasharray={RING_CIRC}
                  strokeDashoffset={0}
                  style={
                    {
                      // offset negativo = mismo barrido pero para el otro lado
                      // (offset positivo iría en sentido horario).
                      "--circ": -RING_CIRC,
                      animation: `cooldown-drain ${SYNC_COOLDOWN_MS}ms linear forwards`,
                    } as CSSProperties
                  }
                />
              </svg>
            )}
          </div>
        </div>
      </div>

      {err && (
        <div className="err" style={{ marginBottom: 8 }}>
          {err}
        </div>
      )}

      <RoomRacks />
    </div>
  );
}
