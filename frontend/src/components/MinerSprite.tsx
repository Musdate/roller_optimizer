// Las imágenes de mineros de RollerCoin son sprite sheets:
// 6 frames en horizontal, cada frame de (58 * width) x 50 px.
// Animación (hover) y ancho de frame se resuelven en CSS con % -> no depende
// de los px reales de la hoja.

const FRAME_W = 58;
const FRAME_H = 50;
const MAX_WIDTH = 2; // el contenedor siempre reserva el ancho de un minero de 2 celdas

interface Props {
  url: string;
  width: number; // celdas del minero (1 o 2)
  size?: number; // alto de render en px
  title?: string; // si se pasa, tooltip al pasar el mouse
}

export default function MinerSprite({ url, width, size = 40, title }: Props) {
  const k = size / FRAME_H;
  const frameW = FRAME_W * width * k;
  const boxW = FRAME_W * MAX_WIDTH * k;

  return (
    <div className="sprite-box" style={{ width: boxW, height: size }} title={title}>
      {url && (
        <div
          className="sprite"
          style={{
            width: frameW,
            height: size,
            backgroundImage: `url("${url}")`,
          }}
        />
      )}
    </div>
  );
}
