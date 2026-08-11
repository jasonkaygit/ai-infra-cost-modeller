/**
 * Decimal-safe money arithmetic.
 *
 * Money is stored internally as an integer number of "minor units" scaled by
 * MONEY_SCALE (here 1e6, i.e. micro-units) so that per-token and per-request
 * fractions of a penny survive summation without floating-point drift.
 *
 * We deliberately avoid a heavyweight decimal library to keep the bundle small,
 * but the invariant is: never add/subtract raw floats representing money — route
 * everything through these helpers, which round at well-defined points.
 */

export const MONEY_SCALE = 1_000_000; // micro-units per currency unit

export type Currency = "GBP" | "USD" | "EUR";

export interface Money {
  /** integer micro-units (e.g. £1.23 -> 1_230_000) */
  readonly micros: number;
  readonly currency: Currency;
}

/** Round-half-up to nearest integer, stable for negatives. */
function roundHalfUp(n: number): number {
  return Math.sign(n) * Math.round(Math.abs(n));
}

export function money(amount: number, currency: Currency = "GBP"): Money {
  if (!Number.isFinite(amount)) {
    return { micros: 0, currency };
  }
  return { micros: roundHalfUp(amount * MONEY_SCALE), currency };
}

export function zero(currency: Currency = "GBP"): Money {
  return { micros: 0, currency };
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new Error(`Currency mismatch: ${a.currency} vs ${b.currency}`);
  }
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { micros: a.micros + b.micros, currency: a.currency };
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { micros: a.micros - b.micros, currency: a.currency };
}

export function sum(items: Money[], currency: Currency = "GBP"): Money {
  return items.reduce((acc, m) => add(acc, m), zero(currency));
}

/** Multiply money by a dimensionless quantity (e.g. unit price × usage). */
export function multiply(a: Money, factor: number): Money {
  if (!Number.isFinite(factor)) return zero(a.currency);
  return { micros: roundHalfUp(a.micros * factor), currency: a.currency };
}

/** Divide money by a dimensionless quantity. Returns zero on divide-by-zero. */
export function divide(a: Money, divisor: number): Money {
  if (!Number.isFinite(divisor) || divisor === 0) return zero(a.currency);
  return { micros: roundHalfUp(a.micros / divisor), currency: a.currency };
}

/** Ratio of two money values as a plain number (unitless). */
export function ratio(a: Money, b: Money): number {
  if (b.micros === 0) return 0;
  return a.micros / b.micros;
}

export function toNumber(a: Money): number {
  return a.micros / MONEY_SCALE;
}

export function isNegative(a: Money): boolean {
  return a.micros < 0;
}

export function compare(a: Money, b: Money): number {
  assertSameCurrency(a, b);
  return a.micros - b.micros;
}

const SYMBOLS: Record<Currency, string> = {
  GBP: "£",
  USD: "$",
  EUR: "€",
};

export function format(a: Money, opts: { decimals?: number; compact?: boolean } = {}): string {
  const value = toNumber(a);
  const symbol = SYMBOLS[a.currency];
  if (opts.compact) {
    const abs = Math.abs(value);
    if (abs >= 1_000_000_000) return `${symbol}${(value / 1e9).toFixed(2)}bn`;
    if (abs >= 1_000_000) return `${symbol}${(value / 1e6).toFixed(2)}m`;
    if (abs >= 1_000) return `${symbol}${(value / 1e3).toFixed(1)}k`;
  }
  const decimals = opts.decimals ?? 2;
  return `${symbol}${value.toLocaleString("en-GB", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}
