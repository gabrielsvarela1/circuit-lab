const PREFIXES: [number, string][] = [
  [1e6, 'M'],
  [1e3, 'k'],
  [1, ''],
  [1e-3, 'm'],
  [1e-6, 'µ'],
];

/** 0.03, 'A' -> "30 mA"; 4.615, 'V' -> "4,62 V". */
export function formatSI(x: number, unit: string, digits = 3): string {
  if (!Number.isFinite(x)) return '—';
  const abs = Math.abs(x);
  if (abs < 1e-9) return `0 ${unit}`;
  const [factor, prefix] = PREFIXES.find(([f]) => abs >= f * 0.9995) ?? PREFIXES[PREFIXES.length - 1];
  const n = new Intl.NumberFormat('pt-PT', { maximumSignificantDigits: digits }).format(x / factor);
  return `${n} ${prefix}${unit}`;
}

/** Plain number in Portuguese notation, for input fields: 4.7 -> "4,7". */
export function formatNumber(x: number): string {
  return new Intl.NumberFormat('pt-PT', { maximumSignificantDigits: 6, useGrouping: false }).format(x);
}

/**
 * Parses values typed by the user: "330", "4,7k", "1.5", "2k2", "20 mA", "0,5 V".
 * Returns the value in base units, or null.
 */
export function parseValue(text: string): number | null {
  let s = text.trim().replace(/\s+/g, '').replace(',', '.');
  s = s.replace(/(Ω|ohms?|V|A|W)$/i, '');
  // "2k2" style.
  const infix = s.match(/^(\d+)([kKmMµu])(\d+)$/);
  if (infix) s = `${infix[1]}.${infix[3]}${infix[2]}`;
  const m = s.match(/^([+-]?\d*\.?\d+(?:e[+-]?\d+)?)([kKMmµu]?)$/);
  if (!m) return null;
  const scale: Record<string, number> = { '': 1, k: 1e3, K: 1e3, M: 1e6, m: 1e-3, µ: 1e-6, u: 1e-6 };
  const x = parseFloat(m[1]) * scale[m[2]];
  return Number.isFinite(x) ? x : null;
}
