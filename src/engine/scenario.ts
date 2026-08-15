import type {
  Scenario,
  Supplier,
  CostComponent,
  ScenarioResult,
  ROIResult,
  MarginalCostResult,
  HumanContactCentreBaseline,
  UsageDriver,
} from "../domain/types";
import { computeBreakdown } from "./tco";
import { buildUsageContext } from "./usageContext";

/** Baseline (pre-AI) annual cost of the contact centre. */
export function computeBaselineCost(baseline: HumanContactCentreBaseline): number {
  if (baseline.mode === "SIMPLE_COST_PER_CONTACT") {
    if (baseline.baselineCostPerMinute > 0) {
      return baseline.baselineCostPerMinute * baseline.currentAverageHandleTimeMin * baseline.currentAnnualCallVolume;
    }
    return baseline.simpleCurrentCostPerContact * baseline.currentAnnualCallVolume;
  }
  return baseline.fullyLoadedAgentAnnualCost * baseline.numberOfAgents;
}

/**
 * Concurrency-driven baseline: uses the profile to determine what fraction of
 * daily concurrency falls within human operating hours, then applies that
 * fraction to the total call volume × duration to get human minutes.
 */
export function computeBaselineFromProfile(
  profile: number[] | undefined,
  humanHoursPerDay: number,
  costPerMinute: number,
  annualCallVolume: number,
  averageCallDurationMin: number,
  fallback: number
): number {
  if (!profile || profile.length !== 24) return fallback;
  // Fraction of daily concurrency that falls within human operating hours
  let totalConcurrency = 0;
  let humanConcurrency = 0;
  for (let h = 0; h < 24; h++) {
    totalConcurrency += profile[h];
    if (h >= 8 && h < 8 + humanHoursPerDay) humanConcurrency += profile[h];
  }
  const humanFraction = totalConcurrency > 0 ? humanConcurrency / totalConcurrency : 1;
  // Human minutes = calls that land during human hours × duration
  const humanCalls = Math.round(annualCallVolume * humanFraction);
  const humanMinutesPerYear = humanCalls * averageCallDurationMin;
  return humanMinutesPerYear * costPerMinute;
}

export function computeROI(
  scenario: Scenario,
  futureAnnualOperatingCost: number
): ROIResult {
  const baselineAnnualCost = computeBaselineCost(scenario.baseline);
  const investment = scenario.investment;

  const grossAvoidedCost = baselineAnnualCost - futureAnnualOperatingCost;
  // Net benefit over the first year (investment counted once).
  const netBenefit = baselineAnnualCost - futureAnnualOperatingCost - investment;
  const roiPercentage = investment > 0 ? (netBenefit / investment) * 100 : 0;

  // Payback: investment / annual gross saving (years).
  const paybackPeriodYears =
    grossAvoidedCost > 0 ? investment / grossAvoidedCost : Infinity;

  // Break-even call volume: volume at which future operating cost equals
  // baseline unit cost × volume. Uses per-call economics from current scenario.
  const perCallBaseline =
    scenario.baseline.mode === "SIMPLE_COST_PER_CONTACT"
      ? scenario.baseline.simpleCurrentCostPerContact
      : safeDiv(baselineAnnualCost, scenario.baseline.currentAnnualCallVolume);
  const perCallFuture = safeDiv(
    futureAnnualOperatingCost,
    scenario.callProfile.annualIncomingCalls
  );
  const breakEvenCallVolume =
    perCallBaseline > perCallFuture
      ? investment / (perCallBaseline - perCallFuture)
      : Infinity;

  return {
    baselineAnnualCost: round2(baselineAnnualCost),
    futureAnnualOperatingCost: round2(futureAnnualOperatingCost),
    investment: round2(investment),
    grossAvoidedCost: round2(grossAvoidedCost),
    netBenefit: round2(netBenefit),
    roiPercentage: round2(roiPercentage),
    paybackPeriodYears: Number.isFinite(paybackPeriodYears)
      ? round4(paybackPeriodYears)
      : Infinity,
    breakEvenCallVolume: Number.isFinite(breakEvenCallVolume)
      ? Math.round(breakEvenCallVolume)
      : Infinity,
  };
}

/**
 * Marginal cost of the next N calls. Crucially this does NOT divide annual TCO
 * by volume — it recomputes the breakdown at volume+N and takes the delta, so
 * fixed and stepped infrastructure costs are correctly excluded until a step
 * boundary is crossed.
 */
export function computeMarginalCost(
  scenario: Scenario,
  supplier: Supplier,
  allComponents: CostComponent[],
  driverOverrides?: Partial<Record<UsageDriver, number>>
): MarginalCostResult {
  const base = computeBreakdown(scenario, supplier, allComponents, undefined, driverOverrides).totalAnnual;

  const delta = (extraCalls: number): number => {
    const bumped: Scenario = {
      ...scenario,
      callProfile: {
        ...scenario.callProfile,
        annualIncomingCalls: scenario.callProfile.annualIncomingCalls + extraCalls,
      },
    };
    const bumpedTotal = computeBreakdown(bumped, supplier, allComponents, undefined, driverOverrides).totalAnnual;
    return bumpedTotal - base;
  };

  return {
    nextOneCall: round4(delta(1)),
    nextThousandCalls: round2(delta(1000)),
    nextMillionCalls: round2(delta(1_000_000)),
  };
}

export function computeScenarioResult(
  scenario: Scenario,
  supplier: Supplier,
  allComponents: CostComponent[],
  driverOverrides?: Partial<Record<UsageDriver, number>>
): ScenarioResult {
  const ctx = buildUsageContext(scenario, driverOverrides);
  const breakdown = computeBreakdown(scenario, supplier, allComponents, ctx);
  const roi = computeROI(scenario, breakdown.totalAnnual);
  const marginal = computeMarginalCost(scenario, supplier, allComponents, driverOverrides);

  const v = ctx.volumes;
  const costPerIncomingCall = safeDiv(breakdown.totalAnnual, v.annualIncomingCalls);
  const costPerAiCall = safeDiv(breakdown.totalAnnual, v.aiCalls);
  const costPerResolvedCall = safeDiv(breakdown.totalAnnual, v.resolvedCalls);
  const costPerAiMinute = safeDiv(breakdown.totalAnnual, ctx.drivers.AI_MINUTES);
  const costPerTelephonyMinute = safeDiv(breakdown.totalAnnual, ctx.drivers.TELEPHONY_MINUTES);

  const modeExtras = computeModeExtras(scenario, supplier, allComponents, breakdown, ctx);

  return {
    scenarioId: scenario.id,
    currency: scenario.currency,
    volumes: v,
    breakdown,
    roi,
    marginal,
    costPerIncomingCall: round4(costPerIncomingCall),
    costPerAiCall: round4(costPerAiCall),
    costPerResolvedCall: round4(costPerResolvedCall),
    costPerAiMinute: round4(costPerAiMinute),
    costPerTelephonyMinute: round4(costPerTelephonyMinute),
    modeExtras,
  };
}

function computeModeExtras(
  scenario: Scenario,
  supplier: Supplier,
  allComponents: CostComponent[],
  breakdown: ReturnType<typeof computeBreakdown>,
  ctx: ReturnType<typeof buildUsageContext>
): Record<string, number> {
  const extras: Record<string, number> = {};
  const perCall = safeDiv(breakdown.totalAnnual, ctx.volumes.annualIncomingCalls);

  switch (scenario.mode) {
    case "BUDGET_LED": {
      const budget = scenario.budget ?? 0;
      const fixedFloor = breakdown.fixedAnnual + breakdown.oneOffAnnual + breakdown.steppedAnnual;
      const variablePerCall = safeDiv(
        breakdown.variableAnnual + breakdown.semiVariableAnnual,
        ctx.volumes.annualIncomingCalls
      );
      const affordableCalls =
        variablePerCall > 0 ? Math.max(0, (budget - fixedFloor) / variablePerCall) : 0;
      extras.maxAffordableCalls = Math.round(affordableCalls);
      extras.maxAiCalls = Math.round(affordableCalls * scenario.outcome.aiAdoptionPercentage);
      extras.expectedContainedCalls = Math.round(
        affordableCalls * scenario.outcome.aiAdoptionPercentage * scenario.outcome.resolutionRate
      );
      extras.residualHumanCalls = Math.round(
        affordableCalls - extras.expectedContainedCalls
      );
      extras.remainingBudget = round2(budget - breakdown.totalAnnual);
      break;
    }
    case "TARGET_SAVINGS": {
      const target = scenario.targetSaving ?? 0;
      const savingPerCall = Math.max(
        0,
        computeBaselinePerCall(scenario) - perCall
      );
      extras.callVolumeRequired =
        savingPerCall > 0 ? Math.round(target / savingPerCall) : Infinity;
      extras.savingPerCall = round4(savingPerCall);
      extras.currentAnnualSaving = round2(
        computeBaselinePerCall(scenario) * ctx.volumes.annualIncomingCalls -
          breakdown.totalAnnual
      );
      break;
    }
    case "CAPACITY": {
      extras.peakConcurrentCalls = Math.round(ctx.volumes.peakConcurrentCalls);
      extras.avgSimultaneousCalls = round2(ctx.volumes.avgSimultaneousCalls);
      extras.steppedInfraAnnual = breakdown.steppedAnnual;
      extras.utilisation = round4(
        safeDiv(ctx.volumes.avgSimultaneousCalls, ctx.volumes.peakConcurrentCalls)
      );
      break;
    }
    case "VOLUME_LED": {
      extras.requiredBudget = breakdown.totalAnnual;
      extras.supplierCost = categoryTotal(breakdown, "VOICE_SERVICE");
      extras.aiCost = categoryTotal(breakdown, "AI_AND_COMPUTE");
      extras.telephonyCost = categoryTotal(breakdown, "TELEPHONY_AND_INTEGRATION");
      extras.humanResidualCost = categoryTotal(breakdown, "HUMAN_ESCALATION");
      break;
    }
    default:
      break;
  }
  return extras;
}

function categoryTotal(
  breakdown: ReturnType<typeof computeBreakdown>,
  category: string
): number {
  return breakdown.byCategory.find((c) => c.category === category)?.annualCost ?? 0;
}

function computeBaselinePerCall(scenario: Scenario): number {
  const b = scenario.baseline;
  if (b.mode === "SIMPLE_COST_PER_CONTACT") return b.simpleCurrentCostPerContact;
  return safeDiv(
    b.fullyLoadedAgentAnnualCost * b.numberOfAgents,
    b.currentAnnualCallVolume
  );
}

function safeDiv(a: number, b: number): number {
  if (!Number.isFinite(b) || b === 0) return 0;
  return a / b;
}
function round2(n: number): number {
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : n;
}
function round4(n: number): number {
  return Number.isFinite(n) ? Math.round(n * 10000) / 10000 : n;
}
