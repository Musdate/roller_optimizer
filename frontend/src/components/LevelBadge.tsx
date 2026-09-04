// Iconos de nivel de RollerCoin (roman numerals II–VI). El nivel 1 (base, minero
// sin merge) no tiene icono en el juego. Ver RULES.md §6.0.

export default function LevelBadge({ level }: { level: number }) {
  if (level < 2 || level > 6) {
    return (
      <span className="pill pill-base" title={`Nivel ${level}`}>
        base
      </span>
    );
  }
  return (
    <img
      className="lvl-badge"
      src={`/miner-levels/level_${level}.webp`}
      alt={`Nivel ${level}`}
      title={`Nivel ${level}`}
    />
  );
}
