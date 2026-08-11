import type {
  CostComponent,
  CostBreakdown,
  ComponentCostLine,
  CategoryCost,
  CostCategory,
  FixedVariableClass,
  Scenario,
  Supplier,
  UsageDriver,
} from "../domain/types";
import { WATERFALL_ORDER } from "../domain/types";
import { evaluateComponent } from "./pricingEngine";
import { buildUsageContext, type UsageContext } from "./usageContext";
import { toNumber } from "../domain/money";

/** Resolve the set of enabled components applicable to a scenario. */
export function resolveComponents(
  scenario: Scenario,
  supplier: Supplier,
  allComponents: CostComponent[]
): CostComponent[] {
  const supplierSet = new Set(supplier.componentIds);
  const disabled = new Set(scenario.disabledComponentIds);
  return allComponents.filter((c) => {
    if (!c.enabled) return false;
    if (disabled.has(c.id)) return false;
    // Voice-service components belong to a specific supplier; only include this
    // supplier's. All other categories are supplier-agnostic infrastructure.
    if (c.category === "VOICE_SERVICE" && !supplierSet.has(c.id)) return false;
    return true;
  });
}

export function computeBreakdown(
  scenario: Scenario,
  supplier: Supplier,
  allComponents: CostComponent[],
  ctxOverride?: UsageContext,
  driverOverrides?: Partial<Record<UsageDriver, number>>
): CostBreakdown {
  const ctx = ctxOverride ?? buildUsageContext(scenario, driverOverrides);
  const components = resolveComponents(scenario, supplier, allComponents);
  const annualCalls = Math.max(1, ctx.volumes.annualIncomingCalls);

  const lines: ComponentCostLine[] = components.map((c) => {
    const evaluated = evaluateComponent(c, ctx);
    const annualCost = toNumber(evaluated.annual);
    return {
      componentId: c.id,
      category: c.category,
      provider: c.provider,
      service: c.service,
      classification: c.classification,
      annualCost,
      perCall: annualCost / annualCalls,
      usageQuantity: evaluated.usageQuantity,
      usageDriver: c.usageDriver,
      trace: evaluated.trace,
    };
  });

  const byCategory = aggregateByCategory(lines, annualCalls);
  const byClassification = aggregateByClassification(lines);

  const totalAnnual = round2(lines.reduce((s, l) => s + l.annualCost, 0));

  return {
    lines,
    byCategory,
    byClassification,
    totalAnnual,
    fixedAnnual: round2(byClassification.FIXED),
    variableAnnual: round2(byClassification.VARIABLE),
    semiVariableAnnual: round2(byClassification.SEMI_VARIABLE),
    steppedAnnual: round2(byClassification.STEPPED),
    oneOffAnnual: round2(byClassification.ONE_OFF),
  };
}

function aggregateByCategory(lines: ComponentCostLine[], annualCalls: number): CategoryCost[] {
  const map = new Map<CostCategory, number>();
  for (const l of lines) {
    map.set(l.category, (map.get(l.category) ?? 0) + l.annualCost);
  }
  return WATERFALL_ORDER.filter((cat) => map.has(cat)).map((cat) => {
    const annualCost = round2(map.get(cat) ?? 0);
    return { category: cat, annualCost, perCall: annualCost / annualCalls };
  });
}

function aggregateByClassification(
  lines: ComponentCostLine[]
): Record<FixedVariableClass, number> {
  const base: Record<FixedVariableClass, number> = {
    ONE_OFF: 0,
    FIXED: 0,
    SEMI_VARIABLE: 0,
    VARIABLE: 0,
    STEPPED: 0,
  };
  for (const l of lines) {
    base[l.classification] += l.annualCost;
  }
  return base;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
