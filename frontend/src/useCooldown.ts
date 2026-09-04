import { useEffect, useState } from "react";

/** Cooldown de cliente para un botón que pega a una API externa (evita
 *  ráfagas de clicks que la terminen limitando con 429). `trigger()` arranca
 *  la espera de `durationMs`; `active` indica si todavía está corriendo y
 *  `secondsLeft` el segundero para mostrar en un tooltip. `key` cambia cada
 *  vez que se dispara -- útil para reiniciar una animación CSS con `key`. */
export function useCooldown(durationMs: number) {
  const [until, setUntil] = useState(0);
  const [now, setNow] = useState(Date.now());

  // tick cada 1s mientras el cooldown esté activo, para que `secondsLeft`
  // se actualice solo (si no, quedaría congelado en el número inicial).
  useEffect(() => {
    if (until <= Date.now()) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [until]);

  const secondsLeft = Math.max(0, Math.ceil((until - now) / 1000));
  const active = secondsLeft > 0;

  const trigger = () => {
    setUntil(Date.now() + durationMs);
    setNow(Date.now());
  };

  return { active, secondsLeft, trigger, key: until };
}
