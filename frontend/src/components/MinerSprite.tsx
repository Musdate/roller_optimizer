// Las imágenes de mineros de RollerCoin son sprite sheets:
// 6 frames en horizontal, cada frame de (58 * width) x 50 px.
// Animación (hover) y ancho de frame se resuelven en CSS con % -> no depende
// de los px reales de la hoja.

const FRAME_W = 58;
const FRAME_H = 50;
const MAX_WIDTH = 2; // el contenedor siempre reserva el ancho de un minero de 2 celdas

import { useEffect, useState } from "react";
import LevelBadge from "./LevelBadge";

interface Props {
  url: string;
  width: number; // celdas del minero (1 o 2)
  size?: number; // alto de render en px
  title?: string; // si se pasa, tooltip al pasar el mouse
  level?: number; // si se pasa, ícono de rareza superpuesto arriba a la izq.
}

export default function MinerSprite({ url, width, size = 40, title, level }: Props) {
  const k = size / FRAME_H;
  const frameW = FRAME_W * width * k;
  const boxW = FRAME_W * MAX_WIDTH * k;

  // El sprite se pinta con background-image (no <img>), que no tiene evento
  // de error propio -> se prueba la carga aparte con un Image() de JS. Pasa
  // con assets que el catálogo apunta bien pero que el CDN de terceros no
  // tiene subidos (p. ej. "Corsair's Oath": la URL que armamos es correcta,
  // el archivo directamente no existe del otro lado).
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    setBroken(false);
    if (!url) return;
    const img = new Image();
    img.onload = () => setBroken(false);
    img.onerror = () => setBroken(true);
    img.src = url;
    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [url]);

  const showFallback = !url || broken;

  return (
    <div className="sprite-box" style={{ width: boxW, height: size }} title={title}>
      {showFallback ? (
        <div className="sprite sprite-fallback" style={{ width: frameW, height: size }} title={title ?? "Sin imagen disponible"}>
          <span>?</span>
          {level != null && (
            <span className="sprite-rarity">
              <LevelBadge level={level} />
            </span>
          )}
        </div>
      ) : (
        <div
          className="sprite"
          style={{
            width: frameW,
            height: size,
            backgroundImage: `url("${url}")`,
          }}
        >
          {level != null && (
            <span className="sprite-rarity">
              <LevelBadge level={level} />
            </span>
          )}
        </div>
      )}
    </div>
  );
}
