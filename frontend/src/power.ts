// Hashrate con BigInt.
// Unidad interna: GH/s (entero) — es la unidad en la que la API de RollerCoin
// entrega `power` (p. ej. "10k Crust" L1 = 2000000 -> 2.000.000 GH/s = 2 PH/s).
// Visualización y entrada: SOLO GH, TH, PH, EH, ZH (factor 1000 entre cada una).

const UNITS: { sym: string; gh: bigint }[] = [
  { sym: "GH", gh: 1n },
  { sym: "TH", gh: 1_000n },
  { sym: "PH", gh: 1_000_000n },
  { sym: "EH", gh: 1_000_000_000n },
  { sym: "ZH", gh: 1_000_000_000_000n },
];

const SUFFIX: Record<string, bigint> = {
  gh: 1n, g: 1n,
  th: 1_000n, t: 1_000n,
  ph: 1_000_000n, p: 1_000_000n,
  eh: 1_000_000_000n, e: 1_000_000_000n,
  zh: 1_000_000_000_000n, z: 1_000_000_000_000n,
};

/** "1.5 PH/s", "2,5 GH", "500 TH" -> BigInt en GH/s. Sin sufijo = GH. */
export function parsePower(input: string): bigint {
  let s = input.trim().toLowerCase().replace(/\s+/g, "");
  s = s.replace(/h\/s$|hs$/i, "").replace(/\/s$/i, "");
  s = s.replace(/,/g, ".");
  const m = s.match(/^([0-9]*\.?[0-9]+)(zh|eh|ph|th|gh|z|e|p|t|g)?$/i);
  if (!m) throw new Error(`No se pudo interpretar "${input}" (usá GH, TH, PH, EH o ZH)`);
  const [, numStr, unit] = m;
  const factor = unit ? SUFFIX[unit] : 1n;
  const [intPart, fracPart = ""] = numStr.split(".");
  const digits = (intPart + fracPart).replace(/^0+(?=\d)/, "") || "0";
  // valor = digits * factor / 10^fracLen   (trunca precisión sub-GH)
  return (BigInt(digits) * factor) / 10n ** BigInt(fracPart.length);
}

/** BigInt en GH/s -> "1.500 PH/s". Unidad mínima GH. */
export function formatPower(value: bigint, decimals = 3): string {
  if (value < 0n) return "-" + formatPower(-value, decimals);
  if (value === 0n) return "0 GH/s";

  let chosen = UNITS[0];
  for (const u of UNITS) {
    if (value >= u.gh) chosen = u;
  }
  const divisor = chosen.gh;
  const whole = value / divisor;
  const remainder = value % divisor;
  const fracDigits = (remainder * 10n ** BigInt(decimals)) / divisor;
  const frac = fracDigits.toString().padStart(decimals, "0").replace(/0+$/, "");

  if (whole === 0n && frac === "") return "~0 GH/s";
  return frac ? `${whole}.${frac} ${chosen.sym}/s` : `${whole} ${chosen.sym}/s`;
}

/** Separador de miles. */
export function groupDigits(value: bigint | string): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** Valor exacto en GH/s (para tooltips): "2.000.000 GH/s". */
export function formatExactGh(value: bigint): string {
  return `${groupDigits(value)} GH/s`;
}

export const bpToPct = (bp: number): string => (bp / 100).toFixed(2) + "%";
