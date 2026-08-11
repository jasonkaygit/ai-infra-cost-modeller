import { money, format as fmtMoney } from "../domain/money";
import type { Currency } from "../domain/money";

export function gbp(n: number, opts: { compact?: boolean; decimals?: number } = {}, ccy: Currency = "GBP") {
  return fmtMoney(money(n, ccy), opts);
}

export function num(n: number, decimals = 0): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-GB", { maximumFractionDigits: decimals, minimumFractionDigits: decimals });
}

export function pct(fraction: number, decimals = 0): string {
  if (!Number.isFinite(fraction)) return "—";
  return `${(fraction * 100).toFixed(decimals)}%`;
}

export function years(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n < 1 / 12) return `${(n * 12).toFixed(1)} mo`;
  if (n < 1) return `${(n * 12).toFixed(1)} mo`;
  return `${n.toFixed(2)} yr`;
}
