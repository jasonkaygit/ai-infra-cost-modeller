import type {
  CostComponent,
  PricingRule,
  PricingModel,
} from "../domain/types";
import { type UsageContext } from "./usageContext";
import { money, multiply, toNumber, type Money, type Currency } from "../domain/money";

export interface EvaluatedComponent {
  annual: Money;
  usageQuantity: number;
  trace: string;
}

/**
 * The pricing engine. Given a cost component (pure data) and a resolved usage
 * context, it returns the annual cost plus a human-readable calculation trace.
 *
 * No supplier or AWS prices are hard-coded here — every number comes from the
 * component's PricingRule. Adding a new service is a data change, not a code
 * change; adding a genuinely new *pricing model* is the only reason to touch
 * this file.
 */
export function evaluateComponent(
  component: CostComponent,
  ctx: UsageContext
): EvaluatedComponent {
  const { pricing, usageDriver } = component;
  const currency = pricing.currency;
  const driverQty = ctx.drivers[usageDriver] ?? 0;

  const result = evaluateRule(pricing, driverQty, ctx, currency);
  return result;
}

function evaluateRule(
  rule: PricingRule,
  rawDriverQty: number,
  ctx: UsageContext,
  currency: Currency
): EvaluatedComponent {
  const annualize = (m: Money) => m; // rules return annual figures directly
  let qty = rawDriverQty;

  // Apply bundled allowance (per month → annualised) and sampling before pricing.
  if (rule.bundledAllowance && rule.bundledAllowance > 0) {
    qty = Math.max(0, qty - rule.bundledAllowance * 12);
  }
  if (rule.samplingFraction != null) {
    qty = qty * clamp01(rule.samplingFraction);
  }
  if (rule.maxAllowance != null) {
    qty = Math.min(qty, rule.maxAllowance);
  }

  switch (rule.model) {
    case "FIXED_MONTHLY":
      return line(money(rule.unitPrice * 12, currency), 12, `${fmt(rule.unitPrice)}/mo × 12`);

    case "FIXED_ANNUAL":
      return line(money(rule.unitPrice, currency), 1, `${fmt(rule.unitPrice)}/yr`);

    case "ONE_OFF":
      return line(money(rule.unitPrice, currency), 1, `${fmt(rule.unitPrice)} one-off`);

    case "PROVISIONED_INSTANCE":
      // unitPrice is per month per instance; driver may be provisioned months.
      return line(
        money(rule.unitPrice * 12, currency),
        12,
        `${fmt(rule.unitPrice)}/mo provisioned × 12`
      );

    case "HOURLY_COMPUTE":
      return perUnit(rule.unitPrice, qty, currency, "hr");

    case "PER_CALL":
    case "PER_SESSION":
    case "PER_REQUEST":
    case "PER_API_CALL":
    case "PER_MINUTE":
    case "PER_SECOND":
    case "PER_TOKEN":
    case "PER_GB":
    case "PER_GB_MONTH":
    case "PER_GB_TRANSFERRED":
    case "CONCURRENT_SESSION":
    case "PERCENT_OF_TRAFFIC":
    case "SAMPLED_ACTIVITY":
      return applyCommitment(perUnit(rule.unitPrice, qty, currency, unitWord(rule.model)), rule, currency);

    case "PER_1000_REQUESTS":
    case "PER_1000_TOKENS":
      return applyCommitment(perUnit(rule.unitPrice, qty / 1000, currency, "per 1k"), rule, currency);

    case "PER_1000000_TOKENS":
      return applyCommitment(perUnit(rule.unitPrice, qty / 1_000_000, currency, "per 1M"), rule, currency);

    case "INPUT_OUTPUT_TOKENS": {
      const inTokens = ctx.drivers.INPUT_TOKENS;
      const outTokens = ctx.drivers.OUTPUT_TOKENS;
      const inRate = rule.inputUnitPrice ?? 0;
      const outRate = rule.outputUnitPrice ?? 0;
      // rates are per 1M tokens by convention for LLM pricing
      const inCost = money((inTokens / 1_000_000) * inRate, currency);
      const outCost = money((outTokens / 1_000_000) * outRate, currency);
      const total = { micros: inCost.micros + outCost.micros, currency };
      return line(
        total,
        inTokens + outTokens,
        `in ${fmtN(inTokens)}tok×${fmt(inRate)}/M + out ${fmtN(outTokens)}tok×${fmt(outRate)}/M`
      );
    }

    case "TIERED_VOLUME": {
      const { cost, trace } = tieredVolume(rule, qty, currency);
      return applyCommitment(line(cost, qty, trace), rule, currency);
    }

    case "TIERED_DURATION": {
      // Same math as volume tiers but driver is minutes/seconds.
      const { cost, trace } = tieredVolume(rule, qty, currency);
      return applyCommitment(line(cost, qty, `duration tiers: ${trace}`), rule, currency);
    }

    case "BUNDLED_ALLOWANCE":
      // Allowance already deducted above; charge overage at unitPrice.
      return applyCommitment(perUnit(rule.unitPrice, qty, currency, "over bundle"), rule, currency);

    case "MIN_MONTHLY_COMMITMENT": {
      const variable = perUnit(rule.unitPrice, qty, currency, unitWord(rule.model));
      return applyCommitment(variable, rule, currency);
    }

    case "STEPPED_INFRASTRUCTURE": {
      if (!rule.scaling) return line(money(0, currency), 0, "no scaling rule");
      let units: number;
      let traceUnits: string;
      if (rule.scaling.manualUnits != null) {
        units = rule.scaling.manualUnits;
        traceUnits = `${units} (manual)`;
      } else {
        const profile = ctx.concurrencyProfile;
        if (profile && profile.length === 24) {
          // Time-weighted average: compute nodes needed per hour, average across 24h.
          const cap = Math.max(1e-9, rule.scaling.capacityPerUnit);
          let totalUnits = 0;
          for (let h = 0; h < 24; h++) {
            totalUnits += Math.max(
              rule.scaling.minUnits,
              Math.ceil(profile[h] / cap)
            );
          }
          units = Math.max(rule.scaling.minUnits, Math.round(totalUnits / 24));
          traceUnits = `profile avg: ceil(hourly/cap)/24 = ${units} unit(s)`;
        } else {
          const demand = ctx.drivers[rule.scaling.capacityDriver] ?? 0;
          units = Math.ceil(demand / Math.max(1e-9, rule.scaling.capacityPerUnit));
          units = Math.max(rule.scaling.minUnits, units);
          if (rule.scaling.maxUnits != null) units = Math.min(rule.scaling.maxUnits, units);
          traceUnits = `ceil(${fmtN(demand)}/${rule.scaling.capacityPerUnit})=${units} unit(s)`;
        }
      }
      // unitPrice is monthly per unit → annualise.
      const annual = money(rule.unitPrice * units * 12, currency);
      return line(
        annual,
        units,
        `${traceUnits} × ${fmt(rule.unitPrice)}/mo × 12`
      );
    }

    default:
      return line(money(0, currency), 0, `unhandled model ${rule.model}`);
  }
}

function tieredVolume(rule: PricingRule, qty: number, currency: Currency) {
  const tiers = rule.tiers ?? [];
  let remaining = qty;
  let prevBound = 0;
  let costMicros = 0;
  const parts: string[] = [];
  for (const tier of tiers) {
    const upper = tier.upTo ?? Infinity;
    const band = Math.max(0, Math.min(remaining, upper - prevBound));
    if (band > 0) {
      const c = money(band * tier.unitPrice, currency);
      costMicros += c.micros;
      parts.push(`${fmtN(band)}×${fmt(tier.unitPrice)}`);
      remaining -= band;
    }
    prevBound = upper;
    if (remaining <= 0) break;
  }
  return { cost: { micros: costMicros, currency }, trace: parts.join(" + ") || "no tiers" };
}

/** Enforce minimum monthly commitment (annualised) as a floor. */
function applyCommitment(
  ec: EvaluatedComponent,
  rule: PricingRule,
  currency: Currency
): EvaluatedComponent {
  if (rule.minMonthlyCommitment == null) return ec;
  const floor = rule.minMonthlyCommitment * 12;
  const current = toNumber(ec.annual);
  if (current >= floor) return ec;
  return {
    annual: money(floor, currency),
    usageQuantity: ec.usageQuantity,
    trace: `${ec.trace} → floored to min commitment ${fmt(rule.minMonthlyCommitment)}/mo × 12`,
  };
}

function perUnit(unitPrice: number, qty: number, currency: Currency, unit: string): EvaluatedComponent {
  const annual = multiply(money(unitPrice, currency), qty);
  return line(annual, qty, `${fmtN(qty)} ${unit} × ${fmt(unitPrice)}`);
}

function line(annual: Money, qty: number, trace: string): EvaluatedComponent {
  return { annual, usageQuantity: qty, trace };
}

function unitWord(model: PricingModel): string {
  switch (model) {
    case "PER_CALL": return "calls";
    case "PER_SESSION": return "sessions";
    case "PER_MINUTE": return "min";
    case "PER_SECOND": return "sec";
    case "PER_REQUEST": return "requests";
    case "PER_API_CALL": return "API calls";
    case "PER_GB": return "GB";
    case "PER_GB_MONTH": return "GB-mo";
    case "PER_GB_TRANSFERRED": return "GB transfer";
    case "CONCURRENT_SESSION": return "concurrent";
    default: return "units";
  }
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function fmt(n: number): string {
  return `£${n.toLocaleString("en-GB", { maximumFractionDigits: 6 })}`;
}
function fmtN(n: number): string {
  return n.toLocaleString("en-GB", { maximumFractionDigits: 2 });
}
