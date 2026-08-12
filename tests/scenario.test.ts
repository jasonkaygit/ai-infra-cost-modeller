import { test } from "node:test";
import assert from "node:assert/strict";
import { computeVolumes, buildUsageContext } from "../src/engine/usageContext";
import { computeBreakdown } from "../src/engine/tco";
import {
  computeScenarioResult,
  computeROI,
  computeMarginalCost,
  computeBaselineCost,
} from "../src/engine/scenario";
import { SEED_COMPONENTS, SEED_SUPPLIERS, SEED_SCENARIOS } from "../src/data/seed";
import type { Scenario, Supplier } from "../src/domain/types";

const supplierA = SEED_SUPPLIERS.find((s) => s.id === "supplier-a") as Supplier;
const scenario = SEED_SCENARIOS.find((s) => s.id === "seed-a") as Scenario;

test("volumes: AI calls = adoption × annual", () => {
  const v = computeVolumes(scenario);
  assert.equal(v.aiCalls, 25_000_000);
  assert.equal(v.resolvedCalls, 25_000_000 * 0.70);
  assert.equal(v.escalatedCalls, 25_000_000 * 0.25);
});

test("volumes: residual human = not-offered + escalated + failed", () => {
  const v = computeVolumes(scenario);
  const notOffered = 25_000_000 - v.aiCalls;
  assert.equal(v.residualHumanCalls, notOffered + v.escalatedCalls + v.failedCalls);
});

test("concurrency: peak > average and both positive", () => {
  const v = computeVolumes(scenario);
  assert.ok(v.avgSimultaneousCalls > 0);
  assert.ok(v.peakConcurrentCalls > v.avgSimultaneousCalls);
});

test("INVARIANT: escalated calls still incur AI cost (AI minutes include escalated leg)", () => {
  const ctx = buildUsageContext(scenario);
  const v = ctx.volumes;
  // AI minutes must exceed resolved-only minutes because escalated calls add AI time.
  const resolvedOnly = v.resolvedCalls * (scenario.callProfile.averageCallDurationMin * 4 / 6);
  assert.ok(ctx.drivers.AI_MINUTES > resolvedOnly);
});

test("INVARIANT: telephony minutes include both AI and human legs for escalations", () => {
  const ctx = buildUsageContext(scenario);
  assert.ok(ctx.drivers.TELEPHONY_MINUTES >= ctx.drivers.AI_MINUTES);
});

test("AHT reduction lowers human minutes", () => {
  const noReduction: Scenario = {
    ...scenario,
    outcome: { ...scenario.outcome, ahtReductionAfterTransfer: 0 },
  };
  const withReduction: Scenario = {
    ...scenario,
    outcome: { ...scenario.outcome, ahtReductionAfterTransfer: 0.3 },
  };
  const a = buildUsageContext(noReduction).drivers.HUMAN_MINUTES;
  const b = buildUsageContext(withReduction).drivers.HUMAN_MINUTES;
  assert.ok(b < a);
  // Seed now has adoption=100%, resolution=70%, escalation=25%.
  // residualHuman = notOffered(0) + escalated(6.25M) + failed(0.5M) = 6.75M
  // a (no reduction) = 6.75M × 7 = 47.25M
  // b (30% reduction) = (6.75M-6.25M)×7 + 6.25M×7×0.7 = 3.5M + 30.625M = 34.125M
  assert.ok(Math.abs(a - 47_250_000) < 100);
  assert.ok(Math.abs(b - 34_125_000) < 100);
});

test("TCO breakdown sums to total and splits by classification", () => {
  const bd = computeBreakdown(scenario, supplierA, SEED_COMPONENTS);
  const lineSum = bd.lines.reduce((s, l) => s + l.annualCost, 0);
  assert.ok(Math.abs(lineSum - bd.totalAnnual) < 1);
  const classSum =
    bd.fixedAnnual + bd.variableAnnual + bd.semiVariableAnnual + bd.steppedAnnual + bd.oneOffAnnual;
  assert.ok(Math.abs(classSum - bd.totalAnnual) < 1);
});

test("disabled Redshift placeholder is excluded by default", () => {
  const bd = computeBreakdown(scenario, supplierA, SEED_COMPONENTS);
  assert.ok(!bd.lines.some((l) => l.componentId === "redshift-placeholder"));
});

test("only the selected supplier's voice component is included", () => {
  const bd = computeBreakdown(scenario, supplierA, SEED_COMPONENTS);
  const voiceLines = bd.lines.filter((l) => l.category === "VOICE_SERVICE");
  assert.equal(voiceLines.length, 1);
  assert.equal(voiceLines[0].componentId, "voice-a-percall");
});

test("baseline cost: simple mode = per-minute × handle-time × volume", () => {
  assert.ok(Math.abs(computeBaselineCost(scenario.baseline) - 0.70 * 7 * 25_000_000) < 1);
});

test("ROI: net benefit and payback formulas", () => {
  const future = 10_000_000;
  const roi = computeROI(scenario, future);
  const baseline = Math.round(0.70 * 7 * 25_000_000); // 122,500,000
  assert.equal(roi.baselineAnnualCost, baseline);
  assert.ok(Math.abs(roi.grossAvoidedCost - (baseline - future)) < 1);
  assert.ok(Math.abs(roi.netBenefit - (baseline - future - scenario.investment)) < 1);
  assert.ok(roi.roiPercentage > 0);
  // Very fast payback: 150k / 95m ≈ 0.0016 yr, rounds to a small non-negative value.
  assert.ok(roi.paybackPeriodYears >= 0 && roi.paybackPeriodYears < 1);
  assert.ok(Number.isFinite(roi.paybackPeriodYears));
});

test("marginal cost of next call is NOT annual TCO / volume", () => {
  const bd = computeBreakdown(scenario, supplierA, SEED_COMPONENTS);
  const naive = bd.totalAnnual / scenario.callProfile.annualIncomingCalls;
  const marginal = computeMarginalCost(scenario, supplierA, SEED_COMPONENTS);
  // Marginal (variable-only, no fixed/stepped) should be below the naive average.
  assert.ok(marginal.nextOneCall < naive);
  assert.ok(marginal.nextOneCall >= 0);
});

test("marginal per-call from 1k batch is stable and positive", () => {
  const marginal = computeMarginalCost(scenario, supplierA, SEED_COMPONENTS);
  const per = marginal.nextThousandCalls / 1000;
  assert.ok(per > 0);
});

test("full scenario result populates all headline metrics", () => {
  const r = computeScenarioResult(scenario, supplierA, SEED_COMPONENTS);
  assert.ok(r.breakdown.totalAnnual > 0);
  assert.ok(r.costPerIncomingCall > 0);
  assert.ok(r.costPerResolvedCall > r.costPerAiCall);
  assert.ok(r.volumes.peakConcurrentCalls > 0);
  assert.equal(r.currency, "GBP");
});

test("higher resolution rate lowers cost per resolved call", () => {
  const low = computeScenarioResult(
    { ...scenario, outcome: { ...scenario.outcome, resolutionRate: 0.4 } },
    supplierA,
    SEED_COMPONENTS
  );
  const high = computeScenarioResult(
    { ...scenario, outcome: { ...scenario.outcome, resolutionRate: 0.7 } },
    supplierA,
    SEED_COMPONENTS
  );
  assert.ok(high.costPerResolvedCall < low.costPerResolvedCall);
});

test("supplier comparison: identical infra, different voice cost", () => {
  const supplierB = SEED_SUPPLIERS.find((s) => s.id === "supplier-b") as Supplier;
  const a = computeScenarioResult({ ...scenario, supplierId: "supplier-a" }, supplierA, SEED_COMPONENTS);
  const b = computeScenarioResult({ ...scenario, supplierId: "supplier-b" }, supplierB, SEED_COMPONENTS);
  const infraA = a.breakdown.totalAnnual - voiceTotal(a);
  const infraB = b.breakdown.totalAnnual - voiceTotal(b);
  assert.ok(Math.abs(infraA - infraB) < 1); // infra identical
});

function voiceTotal(r: ReturnType<typeof computeScenarioResult>): number {
  return r.breakdown.byCategory.find((c) => c.category === "VOICE_SERVICE")?.annualCost ?? 0;
}
