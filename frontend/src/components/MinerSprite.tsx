import type { CSSProperties } from "react";

// Las imágenes de mineros de RollerCoin son sprite sheets:
// 6 frames en horizontal, cada frame de (58 * width) x 50 px.

const FRAME_W = 58;
const FRAME_H = 50;
const FRAMES = 6;

interface Props {
  url: string;
  width: number; // celdas del minero (1 o 2)
  size?: number; // alto de render en px
  animate?: boolean;
}

export default function MinerSprite({ url, width, size = 40, animate = false }: Props) {
  if (!url) {
    return <div style={{ width: (size / FRAME_H) * FRAME_W * width, height: size }} />;
  }
  const k = size / FRAME_H;
  const frameW = FRAME_W * width * k;
  const sheetW = frameW * FRAMES;
  return (
    <div
      className={"sprite" + (animate ? " sprite-anim" : "")}
      style={
        {
          width: frameW,
          height: size,
          backgroundImage: `url("${url}")`,
          backgroundSize: `${sheetW}px ${size}px`,
          "--sheet-w": `-${sheetW}px`,
        } as CSSProperties
      }
    />
  );
}
