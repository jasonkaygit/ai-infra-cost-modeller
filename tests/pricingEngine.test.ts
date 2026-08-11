import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateComponent } from "../src/engine/pricingEngine";
import { toNumber } from "../src/domain/money";
import type { CostComponent, UsageDriver } from "../src/domain/types";
import type { UsageContext } from "../src/engine/usageContext";

function ctx(drivers: Partial<Record<UsageDriver, number>>): UsageContext {
  const base = Object.fromEntries(
    ([
      "ANNUAL_CALLS","AI_CALLS","RESOLVED_CALLS","ESCALATED_CALLS","AI_MINUTES","AI_SECONDS",
      "HUMAN_MINUTES","TELEPHONY_MINUTES","SESSIONS","INPUT_TOKENS","OUTPUT_TOKENS","TOTAL_TOKENS",
      "REASONING_TOKENS","LLM_REQUESTS","TOOL_CALLS","KNOWLEDGE_SEARCHES","API_CALLS","AUDIO_GB",
      "TRANSCRIPT_GB","LOG_GB","TRACE_GB","STORED_GB_MONTHS","EGRESS_GB","EVALUATED_CALLS",
      "DEEP_EVALUATED_CALLS","EVALUATION_TOKENS","PEAK_CONCURRENCY","COMPUTE_HOURS",
      "PROVISIONED_MONTHS","NONE",
    ] as UsageDriver[]).map((d) => [d, 0])
  ) as Record<UsageDriver, number>;
  base.NONE = 1;
  return { drivers: { ...base, ...drivers }, volumes: {} as any };
}

function comp(partial: Partial<CostComponent> & Pick<CostComponent, "pricing" | "usageDriver">): CostComponent {
  return {
    id: "t", category: "AI_AND_COMPUTE", provider: "p", service: "s", description: "d",
    classification: "VARIABLE", environment: "PROD", frequency: "MONTHLY",
    assumptions: "", enabled: true, sampleData: true,
    ...partial,
  } as CostComponent;
}

test("PER_CALL multiplies unit price by driver", () => {
  const c = comp({
    usageDriver: "AI_CALLS",
    pricing: { model: "PER_CALL", unitPrice: 0.2, currency: "GBP", pricingUnit: "per call" },
  });
  const r = evaluateComponent(c, ctx({ AI_CALLS: 1_000_000 }));
  assert.equal(toNumber(r.annual), 200_000);
});

test("FIXED_MONTHLY annualises by 12", () => {
  const c = comp({
    usageDriver: "NONE",
    classification: "FIXED",
    pricing: { model: "FIXED_MONTHLY", unitPrice: 1000, currency: "GBP", pricingUnit: "mo" },
  });
  const r = evaluateComponent(c, ctx({}));
  assert.equal(toNumber(r.annual), 12_000);
});

test("ONE_OFF charged once", () => {
  const c = comp({
    usageDriver: "NONE",
    classification: "ONE_OFF",
    pricing: { model: "ONE_OFF", unitPrice: 150_000, currency: "GBP", pricingUnit: "one-off" },
  });
  assert.equal(toNumber(evaluateComponent(c, ctx({})).annual), 150_000);
});

test("INPUT_OUTPUT_TOKENS uses per-1M split rates", () => {
  const c = comp({
    usageDriver: "TOTAL_TOKENS",
    pricing: {
      model: "INPUT_OUTPUT_TOKENS", unitPrice: 0, inputUnitPrice: 2.5, outputUnitPrice: 10,
      currency: "GBP", pricingUnit: "per 1M",
    },
  });
  // 1M input @2.5 + 0.5M output @10 = 2.5 + 5 = 7.5
  const r = evaluateComponent(c, ctx({ INPUT_TOKENS: 1_000_000, OUTPUT_TOKENS: 500_000 }));
  assert.equal(toNumber(r.annual), 7.5);
});

test("PER_1000_TOKENS divides by 1000", () => {
  const c = comp({
    usageDriver: "EVALUATION_TOKENS",
    pricing: { model: "PER_1000_TOKENS", unitPrice: 0.5, currency: "GBP", pricingUnit: "per 1k" },
  });
  const r = evaluateComponent(c, ctx({ EVALUATION_TOKENS: 2_000_000 }));
  assert.equal(toNumber(r.annual), 1000); // 2000 units of 1k @ 0.5
});

test("PER_1000000_TOKENS divides by 1M", () => {
  const c = comp({
    usageDriver: "EVALUATION_TOKENS",
    pricing: { model: "PER_1000000_TOKENS", unitPrice: 4, currency: "GBP", pricingUnit: "per 1M" },
  });
  const r = evaluateComponent(c, ctx({ EVALUATION_TOKENS: 5_000_000 }));
  assert.equal(toNumber(r.annual), 20);
});

test("TIERED_VOLUME charges each band at its own rate", () => {
  const c = comp({
    usageDriver: "AI_MINUTES",
    pricing: {
      model: "TIERED_VOLUME", unitPrice: 0.06, currency: "GBP", pricingUnit: "min",
      tiers: [
        { upTo: 1_000_000, unitPrice: 0.06 },
        { upTo: 3_000_000, unitPrice: 0.04 },
        { upTo: null, unitPrice: 0.02 },
      ],
    },
  });
  // 4M min: 1M@0.06 + 2M@0.04 + 1M@0.02 = 60k + 80k + 20k = 160k
  const r = evaluateComponent(c, ctx({ AI_MINUTES: 4_000_000 }));
  assert.equal(toNumber(r.annual), 160_000);
});

test("minimum monthly commitment acts as a floor", () => {
  const c = comp({
    usageDriver: "AI_CALLS",
    pricing: {
      model: "PER_CALL", unitPrice: 0.1, currency: "GBP", pricingUnit: "call",
      minMonthlyCommitment: 5000,
    },
  });
  // Low volume -> variable would be 100*0.1=10/yr, floor 5000*12=60000.
  const r = evaluateComponent(c, ctx({ AI_CALLS: 100 }));
  assert.equal(toNumber(r.annual), 60_000);
});

test("bundled allowance deducts monthly allowance annualised", () => {
  const c = comp({
    usageDriver: "SESSIONS",
    pricing: {
      model: "PER_SESSION", unitPrice: 0.15, currency: "GBP", pricingUnit: "session",
      bundledAllowance: 100_000,
    },
  });
  // 2.4M sessions - 1.2M bundled (100k*12) = 1.2M @0.15 = 180k
  const r = evaluateComponent(c, ctx({ SESSIONS: 2_400_000 }));
  assert.equal(toNumber(r.annual), 180_000);
});

test("STEPPED_INFRASTRUCTURE scales by ceil of capacity", () => {
  const c = comp({
    usageDriver: "PEAK_CONCURRENCY",
    classification: "STEPPED",
    pricing: {
      model: "STEPPED_INFRASTRUCTURE", unitPrice: 1000, currency: "GBP", pricingUnit: "node/mo",
      scaling: { capacityDriver: "PEAK_CONCURRENCY", capacityPerUnit: 100, minUnits: 2, maxUnits: null },
    },
  });
  // 250 concurrent -> ceil(250/100)=3 nodes, max(2,3)=3 -> 3*1000*12 = 36000
  const r = evaluateComponent(c, ctx({ PEAK_CONCURRENCY: 250 }));
  assert.equal(toNumber(r.annual), 36_000);
  // Below min -> still 2 nodes
  const r2 = evaluateComponent(c, ctx({ PEAK_CONCURRENCY: 50 }));
  assert.equal(toNumber(r2.annual), 24_000);
});

test("sampling fraction scales the driver", () => {
  const c = comp({
    usageDriver: "STORED_GB_MONTHS",
    pricing: {
      model: "PER_GB_MONTH", unitPrice: 0.25, currency: "GBP", pricingUnit: "GB-mo",
      samplingFraction: 0.1,
    },
  });
  // 1000 GB-months * 0.1 * 0.25 = 25
  const r = evaluateComponent(c, ctx({ STORED_GB_MONTHS: 1000 }));
  assert.equal(toNumber(r.annual), 25);
});

test("PER_1000_REQUESTS divides by 1000", () => {
  const c = comp({
    usageDriver: "KNOWLEDGE_SEARCHES",
    pricing: { model: "PER_1000_REQUESTS", unitPrice: 2, currency: "GBP", pricingUnit: "per 1k" },
  });
  const r = evaluateComponent(c, ctx({ KNOWLEDGE_SEARCHES: 10_000_000 }));
  assert.equal(toNumber(r.annual), 20_000);
});
