// Iconos de nivel de RollerCoin (numerales romanos I–VI), servidos localmente
// desde frontend/public/miner-levels/. Ver RULES.md §6.0.

export default function LevelBadge({ level }: { level: number }) {
  if (level < 1 || level > 6) return null;
  return (
    <img
      className="lvl-badge"
      src={`/miner-levels/level_${level}.webp`}
      alt={`Nivel ${level}`}
      title={`Nivel ${level}`}
    />
  );
}
