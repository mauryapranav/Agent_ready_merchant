export type Paise = number;

export function rupees(amount: number): Paise {
  return Math.round(amount * 100);
}

export function formatINR(paise: Paise): string {
  const negative = paise < 0;
  const abs = Math.abs(paise);
  const units = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  const grouped = units.toLocaleString("en-IN");
  return `${negative ? "-" : ""}₹${grouped}.${frac}`;
}

export function pct(part: number, whole: number): number {
  if (whole === 0) return 0;
  return (part / whole) * 100;
}
