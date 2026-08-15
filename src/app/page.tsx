"use client";

import React, { useMemo, useState, useCallback, useRef, useEffect } from "react";
import { SEED_COMPONENTS, SEED_SUPPLIERS, SEED_SCENARIOS } from "../data/seed";
import { computeScenarioResult } from "../engine/scenario";
import { buildUsageContext } from "../engine/usageContext";
import type { Scenario, CostComponent, UsageDriver, Customer } from "../domain/types";
import { BreakdownTable } from "./components/BreakdownTable";
import { Slider } from "./components/Control";
import { DriverOverrides } from "./components/DriverOverrides";
import { AddComponentForm } from "./components/AddComponentForm";
import { ScenarioManager } from "./components/ScenarioManager";
import { NetworkDiagram } from "./components/NetworkDiagram";
import { ConcurrencyProfile } from "./components/ConcurrencyProfile";
import { CustomerManager } from "./components/CustomerManager";
import { PortfolioView } from "./components/PortfolioView";
import { gbp, num, pct, years } from "./format";

const LS_KEYS = {
  scenarios: "voice-ai:scenarios",
  components: "voice-ai:components",
  customers: "voice-ai:customers",
  overrides: "voice-ai:overrides",
  activeScenarioId: "voice-ai:activeScenarioId",
  counter: "voice-ai:counter",
};

const OPERATING_MODEL_PRESETS = [
  { label: "Lean", dr: 0, preprod: 10, staging: 0, evaluation: 0.05 },
  { label: "Standard", dr: 35, preprod: 15, staging: 15, evaluation: 0.1 },
  { label: "Gov-ready", dr: 60, preprod: 20, staging: 20, evaluation: 0.25 },
] as const;

type ProjectionSettings = {
  startYear: number;
  volumePct: number;
  inflationPct: number;
  supplierPricePct: number;
  infrastructurePricePct: number;
  aiPricePct: number;
  years: number;
  concurrencyFollowsVolume: boolean;
};

type ForecastCategoryKey =
  | "voiceSupplier"
  | "telephony"
  | "aiLlm"
  | "infrastructure"
  | "storage"
  | "evaluation"
  | "operations";

type ForecastProjectionRow = {
  year: number;
  fiscalYear: number;
  label: string;
  volume: number;
  peakConcurrency: number;
  baselineAnnualCost: number;
  totalCost: number;
  costPerCall: number;
  yoyChangePct: number;
  categories: Record<ForecastCategoryKey, number>;
};

const DEFAULT_PROJECTION: ProjectionSettings = {
  startYear: 2027,
  volumePct: 10,
  inflationPct: 3,
  supplierPricePct: 0,
  infrastructurePricePct: 2,
  aiPricePct: -5,
  years: 5,
  concurrencyFollowsVolume: true,
};

const FORECAST_COST_ROWS = [
  { key: "callVolume", label: "Call volume", kind: "number" },
  { key: "voiceSupplier", label: "Voice supplier", kind: "money" },
  { key: "telephony", label: "Telephony", kind: "money" },
  { key: "aiLlm", label: "AI / LLM", kind: "money" },
  { key: "infrastructure", label: "Infrastructure", kind: "money" },
  { key: "storage", label: "Storage", kind: "money" },
  { key: "evaluation", label: "Evaluation", kind: "money" },
  { key: "operations", label: "Operations", kind: "money" },
  { key: "totalCost", label: "Total cost", kind: "money" },
  { key: "yoyChangePct", label: "YoY cost change", kind: "percent" },
  { key: "costPerCall", label: "Cost per call", kind: "unitMoney" },
] as const;

function ensureProjectionSettings(value: Partial<ProjectionSettings> | null): ProjectionSettings {
  return { ...DEFAULT_PROJECTION, ...(value ?? {}) };
}

// Persistence: localStorage (fast sync cache) + SQLite (primary, durable)
// Background: on every write, localStorage is updated immediately for fast reload,
// then SQLite is updated asynchronously via the Repository.
function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch { return fallback; }
}

function saveJSON(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota */ }
  // Background sync to SQLite via Repository
  import("../repository/repository").then(({ getRepository }) => {
    const repo = getRepository();
    if (key === "voice-ai:scenarios" && Array.isArray(value)) {
      value.forEach((s: any) => repo.saveScenario(s).catch(() => {}));
    } else if (key === "voice-ai:components" && typeof value === "object" && value) {
      // Store components as a JSON blob in a scenario-keyed entry
      repo.saveScenario({ id: "__components__", data: value } as any).catch(() => {});
    }
  }).catch(() => {});
}

  // Patch old scenarios missing newer fields
  const DEFAULT_CONCURRENCY = [500, 300, 200, 150, 150, 200, 500, 1000, 4000, 8000, 10000, 12000, 12000, 11000, 10000, 9000, 8000, 6000, 4000, 2000, 1500, 1200, 1000, 800];
  const ensureProfile = (s: Scenario): Scenario => ({
    ...s,
    callProfile: {
      ...s.callProfile,
      concurrencyProfile: s.callProfile.concurrencyProfile ?? DEFAULT_CONCURRENCY,
      humanOperatingHoursPerDay: s.callProfile.humanOperatingHoursPerDay ?? 14,
    },
    baseline: {
      ...s.baseline,
      baselineCostPerMinute: s.baseline.baselineCostPerMinute ?? 0.70,
    },
  });

  const seedScenarioIds = new Set(SEED_SCENARIOS.map((s) => s.id));
  const latestSeedScenario = (id: string) => SEED_SCENARIOS.find((s) => s.id === id);

export default function Page() {
  const [scenario, setScenario] = useState<Scenario>(() => {
    const saved = loadJSON<Scenario | null>(LS_KEYS.activeScenarioId, null);
    if (saved) {
      const latestSeed = latestSeedScenario(saved.id);
      return ensureProfile(latestSeed ? { ...latestSeed } : saved);
    }
    return ensureProfile({ ...SEED_SCENARIOS[0] });
  });
  const [showBreakdown, setShowBreakdown] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(true);
  const [activeTab, setActiveTab] = useState<"overview" | "customers" | "portfolio">("overview");
  const [hasHydrated, setHasHydrated] = useState(false);

  useEffect(() => {
    setHasHydrated(true);
  }, []);

  // One-time: restore from SQLite if localStorage was cleared
  useEffect(() => {
    const key = "voice-ai:scenarios";
    if (localStorage.getItem(key)) return; // already have data
    import("../repository/repository").then(({ getRepository }) => {
      getRepository().listScenarios().then((scenarios) => {
        if (scenarios.length > 0) {
          localStorage.setItem(key, JSON.stringify(scenarios));
          window.location.reload();
        }
      });
    }).catch(() => {});
  }, []);

  // FinOps projection assumptions.
  const [growth, setGrowth] = useState(() =>
    ensureProjectionSettings(loadJSON<Partial<ProjectionSettings> | null>("voice-ai:growth", null))
  );
  useEffect(() => { saveJSON("voice-ai:growth", growth); }, [growth]);
  const [forecastCallOverrides, setForecastCallOverrides] = useState<Record<number, number>>(() =>
    loadJSON<Record<number, number>>("voice-ai:forecastCallOverrides", {})
  );
  const [componentForecastRates, setComponentForecastRates] = useState<Record<string, number>>(() =>
    loadJSON<Record<string, number>>("voice-ai:componentForecastRates", {})
  );
  useEffect(() => { saveJSON("voice-ai:forecastCallOverrides", forecastCallOverrides); }, [forecastCallOverrides]);
  useEffect(() => { saveJSON("voice-ai:componentForecastRates", componentForecastRates); }, [componentForecastRates]);

  // Auto-set default concurrency profile if none is set on the active scenario
  useEffect(() => {
    if (!scenario.callProfile.concurrencyProfile) {
      setCall({ concurrencyProfile: DEFAULT_CONCURRENCY });
    }
  }, []); // run once on mount

  // Persist active scenario + counter
  useEffect(() => { saveJSON(LS_KEYS.activeScenarioId, scenario); }, [scenario]);

  // Scenarios — apply patches for fields added after initial save
  const [scenarios, setScenarios] = useState<Scenario[]>(() => {
    const saved = loadJSON<Scenario[] | null>(LS_KEYS.scenarios, null);
    const customScenarios = (saved ?? []).filter((s) => !seedScenarioIds.has(s.id));
    return [
      ...SEED_SCENARIOS.map((s) => ensureProfile({ ...s })),
      ...customScenarios.map(ensureProfile),
    ];
  });
  const counterData = loadJSON<{ scenario: number; customer: number }>(LS_KEYS.counter, { scenario: SEED_SCENARIOS.length, customer: 0 });
  const scenarioIdCounter = useRef(Math.max(SEED_SCENARIOS.length, counterData.scenario));

  useEffect(() => { saveJSON(LS_KEYS.scenarios, scenarios); }, [scenarios]);

  // Customers — recover counter from existing data to avoid ID collisions
  const savedCustomers = loadJSON<Customer[]>(LS_KEYS.customers, []);
  const maxCustomerId = savedCustomers.reduce((max, c) => {
    const n = parseInt(c.id.replace("customer-", ""), 10);
    return isNaN(n) ? max : Math.max(max, n);
  }, 0);
  // Rebuild with guaranteed unique IDs if duplicates exist
  let nextId = Math.max(maxCustomerId, counterData.customer);
  const fixedCustomers = savedCustomers.map((c, i) => {
    if (savedCustomers.findIndex((x) => x.id === c.id) !== i) {
      return { ...c, id: `customer-${++nextId}` };
    }
    return c;
  });

  const [customers, setCustomers] = useState<Customer[]>(fixedCustomers);
  const customerIdCounter = useRef(nextId);

  useEffect(() => { saveJSON(LS_KEYS.customers, customers); }, [customers]);
  useEffect(() => { saveJSON(LS_KEYS.counter, { scenario: scenarioIdCounter.current, customer: customerIdCounter.current }); }, [scenarios, customers]);

  const addCustomer = useCallback(() => {
    const n = ++customerIdCounter.current;
    const c: Customer = {
      id: `customer-${n}`,
      name: `Customer ${n}`,
      scenarioId: scenario.id,
    };
    setCustomers((prev) => [...prev, c]);
  }, [scenario.id]);

  const updateCustomer = useCallback((id: string, patch: Partial<Customer>) => {
    setCustomers((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }, []);

  const removeCustomer = useCallback((id: string) => {
    setCustomers((prev) => prev.filter((c) => c.id !== id));
  }, []);

  // Per-scenario component snapshots
  const cloneComponents = (src: CostComponent[]) =>
    src.map((c) => ({
      ...c,
      pricing: {
        ...c.pricing,
        tiers: c.pricing.tiers?.map((t) => ({ ...t })),
        scaling: c.pricing.scaling ? { ...c.pricing.scaling } : undefined,
      },
    }));

  const mergeSeedComponents = (current: CostComponent[]) => {
    const currentIds = new Set(current.map((c) => c.id));
    const missingSeedComponents = SEED_COMPONENTS.filter((c) => !currentIds.has(c.id));
    return missingSeedComponents.length === 0
      ? current
      : [...current, ...cloneComponents(missingSeedComponents)];
  };

  const [componentSnapshots, setComponentSnapshots] = useState<
    Record<string, CostComponent[]>
  >(() => {
    const saved = loadJSON<Record<string, CostComponent[]> | null>(LS_KEYS.components, null);
    if (saved && Object.keys(saved).length > 0) {
      const next = { ...saved };
      for (const s of SEED_SCENARIOS) {
        next[s.id] = cloneComponents(SEED_COMPONENTS);
      }
      return next;
    }
    const init: Record<string, CostComponent[]> = {};
    for (const s of SEED_SCENARIOS) {
      init[s.id] = cloneComponents(SEED_COMPONENTS);
    }
    return init;
  });

  useEffect(() => { saveJSON(LS_KEYS.components, componentSnapshots); }, [componentSnapshots]);

  const components = useMemo(
    () => mergeSeedComponents(componentSnapshots[scenario.id] ?? cloneComponents(SEED_COMPONENTS)),
    [componentSnapshots, scenario.id]
  );

  const supplier = SEED_SUPPLIERS.find((s) => s.id === scenario.supplierId) ?? SEED_SUPPLIERS[0];

  const [driverOverrides, setDriverOverrides] = useState<Partial<Record<UsageDriver, number>>>(
    () => loadJSON(LS_KEYS.overrides, {})
  );

  useEffect(() => { saveJSON(LS_KEYS.overrides, driverOverrides); }, [driverOverrides]);

  // DR overhead: two-pass calculation to avoid circular dependency.
  // Pass 1: compute result without DR to get the base infrastructure cost.
  // Pass 2: set DR unit price = preDR total × drPct, compute final result.
  const drPct = (scenario.drOverheadPct ?? 0) / 100;
  // Overhead components set to zero for base calculation
  const overheadIds = ["dr-overhead", "preprod-overhead", "staging-overhead"];
  const componentsWithoutOverhead = useMemo(
    () =>
      components.map((c) =>
        overheadIds.includes(c.id) ? { ...c, pricing: { ...c.pricing, unitPrice: 0 } } : c
      ),
    [components]
  );

  const preOverheadResult = useMemo(
    () => computeScenarioResult(scenario, supplier, componentsWithoutOverhead, driverOverrides),
    [scenario, supplier, componentsWithoutOverhead, driverOverrides]
  );

  const stagingPct = (scenario.stagingOverheadPct ?? 0) / 100;
  const preprodPct = (scenario.preprodOverheadPct ?? 0) / 100;
  const componentsWithOverhead = useMemo(() => {
    const base = preOverheadResult.breakdown.totalAnnual;
    return components.map((c) => {
      if (c.id === "dr-overhead" && drPct > 0)
        return { ...c, pricing: { ...c.pricing, unitPrice: (base * drPct) / 12 } };
      if (c.id === "preprod-overhead" && preprodPct > 0)
        return { ...c, pricing: { ...c.pricing, unitPrice: (base * preprodPct) / 12 } };
      if (c.id === "staging-overhead" && stagingPct > 0)
        return { ...c, pricing: { ...c.pricing, unitPrice: (base * stagingPct) / 12 } };
      return c;
    });
  }, [components, drPct, preprodPct, stagingPct, preOverheadResult.breakdown.totalAnnual]);

  // Keep old names for remaining references
  const componentsWithoutDR = componentsWithoutOverhead;
  const componentsWithDR = componentsWithOverhead;

  const result = useMemo(
    () => computeScenarioResult(scenario, supplier, componentsWithDR, driverOverrides),
    [scenario, supplier, componentsWithDR, driverOverrides]
  );

  // Scenario comparison uses DR-free result for consistent cross-scenario comparison.
  const comparison = useMemo(
    () =>
      scenarios.map((s) => ({
        scenario: s,
        result: computeScenarioResult(s, supplier, componentsWithoutDR, driverOverrides),
      })),
    [scenarios, componentsWithoutDR, driverOverrides, supplier]
  );

  // Portfolio: aggregate all customers with per-customer DR overhead
  const portfolio = useMemo(() => {
    return customers
      .map((c) => {
        const s = scenarios.find((x) => x.id === c.scenarioId);
        if (!s) return null;
        const scen: Scenario = c.concurrencyProfile
          ? {
              ...s,
              callProfile: { ...s.callProfile, concurrencyProfile: c.concurrencyProfile },
            }
          : s;
        // Pre-DR result
        const r = computeScenarioResult(scen, supplier, componentsWithoutDR, driverOverrides);
        // Apply per-customer DR overhead from their scenario
        const custDrPct = (scen.drOverheadPct ?? 0) / 100;
        const drCost = custDrPct > 0 ? r.breakdown.totalAnnual * custDrPct : 0;
        const totalWithDR = r.breakdown.totalAnnual + drCost;
        return { customer: c, scenario: scen, result: r, drCost, totalWithDR };
      })
      .filter(Boolean) as {
      customer: Customer;
      scenario: Scenario;
      result: ReturnType<typeof computeScenarioResult>;
      drCost: number;
      totalWithDR: number;
    }[];
  }, [customers, scenarios, supplier, componentsWithoutDR, driverOverrides]);

  const profile = scenario.callProfile.concurrencyProfile ?? DEFAULT_CONCURRENCY;

  const combinedPeak = Math.max(...profile, 1);
  const combinedTCO = portfolio.reduce((s, p) => s + p.totalWithDR, 0);
  const combinedDR = portfolio.reduce((s, p) => s + p.drCost, 0);
  const combinedCalls = portfolio.reduce((s, p) => s + p.result.volumes.annualIncomingCalls, 0);

  // Multi-year portfolio projections use the same forecast assumptions as the
  // executive model, then rerun the cost engine for each customer/year.
  const portfolioProjections = useMemo(() => {
    const years = growth.years;
    const result: {
      year: number;
      fiscalYear: number;
      label: string;
      customers: {
        customer: Customer;
        volume: number;
        resolution: number;
        baselineCost: number;
        tco: number;
        drCost: number;
        peakConcurrency: number;
      }[];
      totalTCO: number;
      totalDR: number;
      totalBenefit: number;
      totalPeakConcurrency: number;
    }[] = [];
    for (let y = 1; y <= years; y++) {
      const yearIndex = y - 1;
      const fiscalYear = growth.startYear + yearIndex;
      const volumeFactor = projectionFactor(growth.volumePct, yearIndex);
      const humanCostFactor = projectionFactor(growth.inflationPct, yearIndex);
      const activeProf = scenario.callProfile.concurrencyProfile;
      const projectedComponents = applyProjectionPriceChanges(
        components,
        growth,
        componentForecastRates,
        yearIndex,
        y === 1
      );
      const customers = portfolio.map(({ customer, scenario: custScenario }) => {
        const vol = Math.round(custScenario.callProfile.annualIncomingCalls * volumeFactor);
        const res = custScenario.outcome.resolutionRate;
        const projectedCostPerMinute = custScenario.baseline.baselineCostPerMinute * humanCostFactor;
        const projectedAht = custScenario.baseline.currentAverageHandleTimeMin;
        const baseProfile = customer.concurrencyProfile ?? custScenario.callProfile.concurrencyProfile ?? activeProf;
        const cp =
          growth.concurrencyFollowsVolume && baseProfile
            ? scaleConcurrencyProfileByFactor(baseProfile, volumeFactor)
            : baseProfile;
        const scen: Scenario = {
          ...custScenario,
          callProfile: { ...custScenario.callProfile, annualIncomingCalls: vol, concurrencyProfile: cp },
          outcome: { ...custScenario.outcome, resolutionRate: res },
          baseline: {
            ...custScenario.baseline,
            baselineCostPerMinute: projectedCostPerMinute,
            simpleCurrentCostPerContact: projectedCostPerMinute * projectedAht,
            currentAnnualCallVolume: vol,
          },
        };
        const projectedComponentsWithoutOverhead = projectedComponents.map((c) =>
          overheadIds.includes(c.id) ? { ...c, pricing: { ...c.pricing, unitPrice: 0 } } : c
        );
        const preOverhead = computeScenarioResult(scen, supplier, projectedComponentsWithoutOverhead, driverOverrides);
        const projectedComponentsWithOverhead = projectedComponents.map((c) => {
          const base = preOverhead.breakdown.totalAnnual;
          if (c.id === "dr-overhead" && (scen.drOverheadPct ?? 0) > 0) {
            return { ...c, pricing: { ...c.pricing, unitPrice: (base * ((scen.drOverheadPct ?? 0) / 100)) / 12 } };
          }
          if (c.id === "preprod-overhead" && (scen.preprodOverheadPct ?? 0) > 0) {
            return { ...c, pricing: { ...c.pricing, unitPrice: (base * ((scen.preprodOverheadPct ?? 0) / 100)) / 12 } };
          }
          if (c.id === "staging-overhead" && (scen.stagingOverheadPct ?? 0) > 0) {
            return { ...c, pricing: { ...c.pricing, unitPrice: (base * ((scen.stagingOverheadPct ?? 0) / 100)) / 12 } };
          }
          return c;
        });
        const r = computeScenarioResult(scen, supplier, projectedComponentsWithOverhead, driverOverrides);
        const dr = categoryLineCost(r, "dr-overhead");
        const tco = r.breakdown.totalAnnual + (y === 1 ? scen.investment : 0);
        return {
          customer,
          volume: vol,
          resolution: res,
          baselineCost: projectedCostPerMinute * projectedAht,
          tco,
          drCost: dr,
          peakConcurrency: Math.round(r.volumes.peakConcurrentCalls),
        };
      });
      result.push({
        year: y,
        fiscalYear,
        label: fiscalYearLabel(fiscalYear),
        customers,
        totalTCO: customers.reduce((s, c) => s + c.tco, 0),
        totalDR: customers.reduce((s, c) => s + c.drCost, 0),
        totalBenefit: customers.reduce((s, c) => s + c.baselineCost * c.volume - c.tco, 0),
        totalPeakConcurrency: customers.reduce((s, c) => s + c.peakConcurrency, 0),
      });
    }
    return result;
  }, [portfolio, growth, supplier, components, componentForecastRates, overheadIds, driverOverrides, scenario.callProfile.concurrencyProfile]);

  // Multi-year FinOps projection: recalculate the full model every year from
  // projected demand, concurrency, outcomes and category-specific price changes.
  const projection = useMemo(() => {
    const rows: ForecastProjectionRow[] = [];
    for (let y = 1; y <= growth.years; y++) {
      const yearIndex = y - 1;
      const fiscalYear = growth.startYear + yearIndex;
      const volumeFactor = projectionFactor(growth.volumePct, yearIndex);
      const automaticVolume = Math.round(scenario.callProfile.annualIncomingCalls * volumeFactor);
      const projectedVolume = forecastCallOverrides[fiscalYear] ?? automaticVolume;
      const effectiveVolumeFactor =
        scenario.callProfile.annualIncomingCalls > 0
          ? projectedVolume / scenario.callProfile.annualIncomingCalls
          : 1;
      const humanCostFactor = projectionFactor(growth.inflationPct, yearIndex);
      const projectedCostPerMinute = scenario.baseline.baselineCostPerMinute * humanCostFactor;
      const projectedAht = scenario.baseline.currentAverageHandleTimeMin;
      const projectedProfile =
        growth.concurrencyFollowsVolume && scenario.callProfile.concurrencyProfile
          ? scaleConcurrencyProfileByFactor(scenario.callProfile.concurrencyProfile, effectiveVolumeFactor)
          : scenario.callProfile.concurrencyProfile;
      const scen: Scenario = {
        ...scenario,
        callProfile: {
          ...scenario.callProfile,
          annualIncomingCalls: projectedVolume,
          concurrencyProfile: projectedProfile,
        },
        outcome: {
          ...scenario.outcome,
        },
        baseline: {
          ...scenario.baseline,
          baselineCostPerMinute: projectedCostPerMinute,
          simpleCurrentCostPerContact: projectedCostPerMinute * projectedAht,
          currentAnnualCallVolume: projectedVolume,
        },
      };

      const projectedComponents = applyProjectionPriceChanges(
        components,
        growth,
        componentForecastRates,
        yearIndex,
        y === 1
      );
      const projectedComponentsWithoutOverhead = projectedComponents.map((c) =>
        overheadIds.includes(c.id) ? { ...c, pricing: { ...c.pricing, unitPrice: 0 } } : c
      );
      const preOverhead = computeScenarioResult(
        scen,
        supplier,
        projectedComponentsWithoutOverhead,
        driverOverrides
      );
      const projectedComponentsWithOverhead = projectedComponents.map((c) => {
        const base = preOverhead.breakdown.totalAnnual;
        if (c.id === "dr-overhead" && (scen.drOverheadPct ?? 0) > 0) {
          return { ...c, pricing: { ...c.pricing, unitPrice: (base * ((scen.drOverheadPct ?? 0) / 100)) / 12 } };
        }
        if (c.id === "preprod-overhead" && (scen.preprodOverheadPct ?? 0) > 0) {
          return { ...c, pricing: { ...c.pricing, unitPrice: (base * ((scen.preprodOverheadPct ?? 0) / 100)) / 12 } };
        }
        if (c.id === "staging-overhead" && (scen.stagingOverheadPct ?? 0) > 0) {
          return { ...c, pricing: { ...c.pricing, unitPrice: (base * ((scen.stagingOverheadPct ?? 0) / 100)) / 12 } };
        }
        return c;
      });

      const r = computeScenarioResult(scen, supplier, projectedComponentsWithOverhead, driverOverrides);
      const oneOffInvestment = y === 1 ? scen.investment : 0;
      const totalCost = r.breakdown.totalAnnual + oneOffInvestment;
      rows.push({
        year: y,
        fiscalYear,
        label: fiscalYearLabel(fiscalYear),
        volume: projectedVolume,
        peakConcurrency: Math.round(r.volumes.peakConcurrentCalls),
        baselineAnnualCost: r.roi.baselineAnnualCost,
        totalCost,
        costPerCall: projectedVolume > 0 ? totalCost / projectedVolume : 0,
        yoyChangePct: 0,
        categories: forecastCategoryCosts(r),
      });
    }
    return rows.map((row, index) => ({
      ...row,
      yoyChangePct:
        index === 0 || rows[index - 1].totalCost === 0
          ? 0
          : ((row.totalCost - rows[index - 1].totalCost) / rows[index - 1].totalCost) * 100,
    }));
  }, [scenario, supplier, components, driverOverrides, growth, forecastCallOverrides, componentForecastRates, overheadIds]);

  const forecastComponentOptions = useMemo(() => {
    return result.breakdown.lines
      .map((line) => ({
        line,
        component: components.find((component) => component.id === line.componentId),
      }))
      .filter((item) => item.component)
      .sort((a, b) => b.line.annualCost - a.line.annualCost)
      .slice(0, 8);
  }, [components, result.breakdown.lines]);

  const handleLoadScenario = useCallback((id: string) => {
    const target = scenarios.find((s) => s.id === id);
    if (target) setScenario({ ...target });
  }, [scenarios]);

  const handleNewScenario = useCallback(() => {
    const n = ++scenarioIdCounter.current;
    const id = `custom-scenario-${n}`;
    const fresh: Scenario = ensureProfile({
      ...SEED_SCENARIOS[0],
      id,
      name: `Scenario ${n}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    setScenarios((prev) => [...prev, fresh]);
    // Snapshot current components for the new scenario
    setComponentSnapshots((prev) => ({
      ...prev,
      [id]: cloneComponents(SEED_COMPONENTS),
    }));
    setScenario({ ...fresh });
  }, []);

  const handleSaveScenario = useCallback((name: string) => {
    const n = ++scenarioIdCounter.current;
    const id = `custom-scenario-${n}`;
    const saved: Scenario = {
      ...scenario,
      id,
      name,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setScenarios((prev) => [...prev, saved]);
    // Snapshot the current components for the saved scenario
    setComponentSnapshots((prev) => ({
      ...prev,
      [id]: cloneComponents(components),
    }));
    setScenario({ ...saved });
  }, [scenario, components]);

  const handleDeleteScenario = useCallback((id: string) => {
    setScenarios((prev) => {
      const next = prev.filter((s) => s.id !== id);
      if (next.length === 0) return prev;
      return next;
    });
    // Clean up component snapshot
    setComponentSnapshots((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    // If deleting the active scenario, switch to the first remaining one
    if (scenario.id === id) {
      const remaining = scenarios.find((s) => s.id !== id);
      if (remaining) setScenario({ ...remaining });
    }
  }, [scenario.id, scenarios]);

  const updateComponent = useCallback(
    (id: string, patch: Partial<CostComponent>) => {
      setComponentSnapshots((prev) => ({
        ...prev,
        [scenario.id]: components.map((c) =>
          c.id === id ? { ...c, ...patch } : c
        ),
      }));
    },
    [components, scenario.id]
  );

  const deleteComponent = useCallback(
    (id: string) => {
      setComponentSnapshots((prev) => ({
        ...prev,
        [scenario.id]: (prev[scenario.id] ?? []).filter((c) => c.id !== id),
      }));
    },
    [scenario.id]
  );

  const handleAddComponent = useCallback(
    (c: CostComponent) => {
      setComponentSnapshots((prev) => ({
        ...prev,
        [scenario.id]: [...(prev[scenario.id] ?? []), c],
      }));
      setShowAddForm(false);
    },
    [scenario.id]
  );

  const handleOverride = useCallback((driver: UsageDriver, value: number) => {
    setDriverOverrides((prev) => ({ ...prev, [driver]: value }));
  }, []);

  const handleClearOverride = useCallback((driver: UsageDriver) => {
    setDriverOverrides((prev) => {
      const next = { ...prev };
      delete next[driver];
      return next;
    });
  }, []);

  const handleClearAllOverrides = useCallback(() => {
    setDriverOverrides({});
  }, []);

  // Base driver values (without overrides) for display in the overrides panel.
  const baseDrivers = useMemo(
    () => buildUsageContext(scenario).drivers,
    [scenario]
  );

  const setCall = (patch: Partial<Scenario["callProfile"]>) =>
    setScenario((s) => ({ ...s, callProfile: { ...s.callProfile, ...patch } }));

  const bestTco = Math.min(...comparison.map((c) => c.result.breakdown.totalAnnual));

  return (
    <div className="min-h-screen">
      <Header />

      <main className="mx-auto max-w-[1400px] px-5 pb-24 lg:px-8">
        {/* Tab navigation */}
        <div className="flex gap-1 pt-6 pb-2">
          {(["overview", "customers", "portfolio"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`figure rounded-lg px-4 py-2 text-sm transition-colors ${
                activeTab === tab
                  ? "bg-signal text-ground"
                  : "text-muted hover:text-ink"
              }`}
            >
              {tab === "overview" ? "Scenario" : tab === "customers" ? `Customers${hasHydrated && customers.length > 0 ? ` (${customers.length})` : ""}` : "Portfolio"}
            </button>
          ))}
        </div>

        {activeTab === "overview" && (
          <>
        {/* Hero: the headline the whole tool exists to produce */}
        <section className="grid grid-cols-1 gap-6 pt-8 lg:grid-cols-[1.15fr_0.85fr]">
          <HeroThesis result={result} scenario={scenario} />
          <div className="space-y-4">
            <div className="rounded-2xl border hairline bg-panel p-5">
              <div className="mb-3 flex items-center justify-between">
                <SectionLabel n="00" title="Scenarios" inline />
                <button
                  onClick={() => exportCSV(scenario, result, projection, portfolio, portfolioProjections)}
                  className="figure rounded border border-signalDim px-2 py-1 text-[10px] text-signal hover:bg-panel2"
                >
                  export csv
                </button>
              </div>
              <ScenarioManager
                scenarios={scenarios}
                activeId={scenario.id}
                onLoad={handleLoadScenario}
                onNew={handleNewScenario}
                onSave={handleSaveScenario}
                onDelete={handleDeleteScenario}
              />
            </div>
          </div>
        </section>

        <section className="mt-8">
          <ExecutiveForecast
            scenario={scenario}
            result={result}
            components={components}
            onUpdateComponent={updateComponent}
            onScenarioChange={setScenario}
            onCallChange={setCall}
          />
        </section>

        <section className="mt-8">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border hairline bg-panel p-5">
            <div>
              <SectionLabel n="AD" title="Advanced audit" inline />
              <p className="mt-2 max-w-3xl text-sm text-muted">
                Component pricing, usage-driver overrides, capacity tuning and architecture diagrams are kept
                available for audit and supplier validation.
              </p>
            </div>
            <button
              onClick={() => setShowAdvanced((v) => !v)}
              className={`figure rounded-lg border px-4 py-2 text-xs transition-colors ${
                showAdvanced
                  ? "border-signal bg-signal text-ground"
                  : "hairline bg-panel2 text-muted hover:text-ink"
              }`}
            >
              {showAdvanced ? "hide advanced" : "show advanced"}
            </button>
          </div>
        </section>

        {showAdvanced && (
          <>
        {/* Capacity */}
        <section className="mt-8">
          <div className="rounded-2xl border hairline bg-panel p-5">
            <SectionLabel n="EC2" title="EC2 node sizing" />
            <ConcurrencyProfile
              profile={scenario.callProfile.concurrencyProfile}
              onChange={(p) => setCall({ concurrencyProfile: p })}
              steppedComponents={components.filter((c) => c.id === "ec2-nitro-inference" && c.pricing.model === "STEPPED_INFRASTRUCTURE" && c.pricing.scaling && c.enabled).map((c) => ({ id: c.id, label: c.service.length > 25 ? c.service.slice(0, 23) + "..." : c.service, capacityPerUnit: c.pricing.scaling!.capacityPerUnit, unitPrice: c.pricing.unitPrice }))}
              onUpdateComponent={(id, cap) => updateComponent(id, { pricing: { ...components.find((c) => c.id === id)!.pricing, scaling: { ...components.find((c) => c.id === id)!.pricing.scaling!, capacityPerUnit: cap } } })}
            />
          </div>
        </section>

          </>
        )}

        {/* Multi-year forecast */}
        <section className="mt-8">
          <div className="rounded-2xl border hairline bg-panel p-5">
            <SectionLabel n="FC" title="Multi-year cost forecast" />
            <p className="mb-3 text-xs text-muted">
              Uses the current scenario as year 1, then reruns the existing cost engine for each forecast year
              with changed call volume and pricing assumptions.
            </p>
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-[0.85fr_1.15fr]">
              <div className="space-y-4">
                <div className="rounded-xl border hairline bg-panel2 p-4">
                  <div className="mb-4 text-xs font-semibold text-ink">Forecast settings</div>
                  <div className="space-y-4">
                    <Slider
                      label="Forecast start year"
                      description={`Year 1 is ${fiscalYearLabel(growth.startYear)} and uses the current scenario.`}
                      min={2025} max={2040} step={1}
                      value={growth.startYear}
                      onChange={(v) => setGrowth((g) => ({ ...g, startYear: v }))}
                      format={(v) => fiscalYearLabel(v)}
                    />
                    <Slider
                      label="Number of years"
                      description={`Show ${growth.years} forecast years`}
                      min={1} max={7} step={1}
                      value={growth.years}
                      onChange={(v) => setGrowth((g) => ({ ...g, years: v }))}
                      format={(v) => `${v}yr`}
                    />
                    <Slider
                      label="Annual call volume growth"
                      description={`${growth.volumePct}% more calls each year unless a year is overridden.`}
                      min={-20} max={100} step={1}
                      value={growth.volumePct}
                      onChange={(v) => setGrowth((g) => ({ ...g, volumePct: v }))}
                      format={(v) => `${v > 0 ? "+" : ""}${v}%`}
                    />
                    <Slider
                      label="Annual cost inflation"
                      description={`${growth.inflationPct}% default annual price change for costs without a more specific rule.`}
                      min={-20} max={30} step={0.5}
                      value={growth.inflationPct}
                      onChange={(v) => setGrowth((g) => ({ ...g, inflationPct: v }))}
                      format={(v) => `${v > 0 ? "+" : ""}${v}%`}
                    />
                    <Slider
                      label="Supplier price change"
                      description={`Optional voice supplier annual price change: ${growth.supplierPricePct}%.`}
                      min={-30} max={30} step={0.5}
                      value={growth.supplierPricePct}
                      onChange={(v) => setGrowth((g) => ({ ...g, supplierPricePct: v }))}
                      format={(v) => `${v > 0 ? "+" : ""}${v}%`}
                    />
                    <Slider
                      label="Infrastructure price change"
                      description={`Optional EC2, EKS, SageMaker, storage, egress, logging and monitoring price change.`}
                      min={-30} max={30} step={0.5}
                      value={growth.infrastructurePricePct}
                      onChange={(v) => setGrowth((g) => ({ ...g, infrastructurePricePct: v }))}
                      format={(v) => `${v > 0 ? "+" : ""}${v}%`}
                    />
                    <Slider
                      label="AI / LLM price change"
                      description={`Optional Bedrock, LLM, evaluation and knowledge/search price change.`}
                      min={-60} max={30} step={1}
                      value={growth.aiPricePct}
                      onChange={(v) => setGrowth((g) => ({ ...g, aiPricePct: v }))}
                      format={(v) => `${v > 0 ? "+" : ""}${v}%`}
                    />
                    <button
                      type="button"
                      onClick={() => setGrowth((g) => ({ ...g, concurrencyFollowsVolume: !g.concurrencyFollowsVolume }))}
                      className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                        growth.concurrencyFollowsVolume
                          ? "border-signalDim bg-signal/10"
                          : "hairline bg-panel"
                      }`}
                    >
                      <span className="block text-xs text-muted">Peak concurrency</span>
                      <span className="figure mt-1 block text-sm text-signal">
                        {growth.concurrencyFollowsVolume ? "follows call growth" : "held flat"}
                      </span>
                    </button>
                  </div>
                </div>

                <div className="rounded-xl border hairline bg-panel2 p-4">
                  <div className="mb-3 text-xs font-semibold text-ink">Year call-volume overrides</div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {projection.map((row) => (
                      <label key={row.fiscalYear} className="rounded-lg border hairline bg-panel px-3 py-2">
                        <span className="mb-1 block text-[10px] text-muted">{row.label} calls</span>
                        <input
                          type="number"
                          value={forecastCallOverrides[row.fiscalYear] ?? ""}
                          placeholder={String(row.volume)}
                          onChange={(event) => {
                            const value = Number(event.target.value);
                            setForecastCallOverrides((prev) => {
                              const next = { ...prev };
                              if (!event.target.value || !Number.isFinite(value) || value <= 0) {
                                delete next[row.fiscalYear];
                              } else {
                                next[row.fiscalYear] = value;
                              }
                              return next;
                            });
                          }}
                          className="figure w-full bg-transparent text-sm text-ink outline-none"
                        />
                      </label>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl border hairline bg-panel2 p-4">
                  <div className="mb-3 text-xs font-semibold text-ink">Component-specific annual change</div>
                  <p className="mb-3 text-[10px] leading-relaxed text-ink/90">
                    Optional overrides for the largest current cost components. Blank uses the general/category forecast rule.
                  </p>
                  <div className="space-y-2">
                    {forecastComponentOptions.map(({ line, component }) => (
                      <label key={line.componentId} className="flex items-center justify-between gap-3 rounded-lg border hairline bg-panel px-3 py-2">
                        <span className="min-w-0">
                          <span className="block truncate text-[10px] text-muted">{component!.service}</span>
                          <span className="figure text-[10px] text-faint">{gbp(line.annualCost, { compact: true })}/yr</span>
                        </span>
                        <input
                          type="number"
                          value={componentForecastRates[line.componentId] ?? ""}
                          placeholder="auto"
                          step={0.5}
                          onChange={(event) => {
                            const value = Number(event.target.value);
                            setComponentForecastRates((prev) => {
                              const next = { ...prev };
                              if (!event.target.value || !Number.isFinite(value)) {
                                delete next[line.componentId];
                              } else {
                                next[line.componentId] = value;
                              }
                              return next;
                            });
                          }}
                          className="figure w-20 rounded border hairline bg-panel2 px-2 py-1 text-right text-xs text-ink outline-none"
                        />
                      </label>
                    ))}
                  </div>
                </div>
              </div>
              <ForecastResults projection={projection} />
            </div>
          </div>
        </section>

        {showAdvanced && (
          <>
        {/* Driver overrides */}
        <section className="mt-10">
          <DriverOverrides
            drivers={baseDrivers}
            overrides={driverOverrides}
            onOverride={handleOverride}
            onClear={handleClearOverride}
            onClearAll={handleClearAllOverrides}
          />
        </section>

        {/* Scenario comparison */}
        <section className="mt-10">
          <SectionLabel n="05" title="Scenario comparison" />
          <p className="mb-4 max-w-3xl text-sm text-muted">
            All saved scenarios compared side-by-side using the same supplier and infrastructure. Click
            a row to load that scenario.
          </p>
          <div className="overflow-hidden rounded-2xl border hairline">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b hairline bg-panel2 text-left">
                  <th className="px-4 py-3 eyebrow font-normal">Scenario</th>
                  <th className="px-4 py-3 eyebrow font-normal text-right">Calls</th>
                  <th className="px-4 py-3 eyebrow font-normal text-right">AI calls</th>
                  <th className="px-4 py-3 eyebrow font-normal text-right">Resolution</th>
                  <th className="px-4 py-3 eyebrow font-normal text-right">Annual TCO</th>
                  <th className="px-4 py-3 eyebrow font-normal text-right">Net benefit</th>
                  <th className="px-4 py-3 eyebrow font-normal text-right">ROI</th>
                </tr>
              </thead>
              <tbody>
                {comparison.map(({ scenario: s, result: r }) => {
                  const isBest = r.breakdown.totalAnnual === bestTco;
                  const selected = s.id === scenario.id;
                  return (
                    <tr
                      key={s.id}
                      onClick={() => handleLoadScenario(s.id)}
                      className={`cursor-pointer border-b hairline hover:bg-panel2 ${
                        selected ? "bg-panel2" : ""
                      }`}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className={`h-2 w-2 rounded-full ${selected ? "bg-signal" : "bg-line"}`} />
                          <span className="text-ink">{s.name}</span>
                          {isBest && (
                            <span className="figure rounded border border-signalDim px-1.5 py-0.5 text-[10px] text-signal">
                              lowest TCO
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right figure text-muted">
                        {num(r.volumes.annualIncomingCalls)}
                      </td>
                      <td className="px-4 py-3 text-right figure text-muted">
                        {num(r.volumes.aiCalls)}
                      </td>
                      <td className="px-4 py-3 text-right figure text-muted">
                        {pct(s.outcome.resolutionRate)}
                      </td>
                      <td className="px-4 py-3 text-right figure text-ink">
                        {gbp(r.breakdown.totalAnnual, { compact: true })}
                      </td>
                      <td className="px-4 py-3 text-right figure text-signal">
                        {gbp(r.roi.netBenefit, { compact: true })}
                      </td>
                      <td className="px-4 py-3 text-right figure text-ink">
                        {pct(r.roi.roiPercentage / 100, 0)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* Full breakdown */}
        <section className="mt-10">
          <div className="mb-4 flex items-center justify-between">
            <SectionLabel n="06" title="Cost breakdown & audit" inline />
            <div className="flex gap-2">
              <button
                onClick={() => setShowAddForm((v) => !v)}
                className={`figure rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                  showAddForm
                    ? "border-signal bg-signal text-ground"
                    : "hairline bg-panel2 text-muted hover:text-ink"
                }`}
              >
                {showAddForm ? "cancel" : "+ add"} component
              </button>
              <button
                onClick={() => setShowBreakdown((v) => !v)}
                className="figure rounded-lg border hairline bg-panel2 px-3 py-1.5 text-xs text-muted hover:text-ink"
              >
                {showBreakdown ? "hide" : "show"} components
              </button>
            </div>
          </div>
          <p className="mb-4 max-w-3xl text-sm text-muted">
            Every line traces back to its usage driver, pricing rule and calculation. Click any row to expand
            the working.
          </p>
          {showAddForm && (
            <div className="mb-4">
              <AddComponentForm onAdd={handleAddComponent} onCancel={() => setShowAddForm(false)} />
            </div>
          )}
          {showBreakdown && <BreakdownTable breakdown={result.breakdown} components={componentsWithDR} onUpdateComponent={updateComponent} onDeleteComponent={deleteComponent} />}
        </section>

        {/* Network architecture diagram */}
        <section className="mt-10">
          <SectionLabel n="08" title="Network architecture" />
          <p className="mb-4 max-w-3xl text-sm text-muted">
            Infrastructure topology — how services connect and where cost sits. Dashed arrows show the
            call/data flow path. Hover any node to see its annual cost.
          </p>
          <div className="rounded-2xl border hairline bg-panel p-4">
            <NetworkDiagram breakdown={result.breakdown} />
          </div>
        </section>
          </>
        )}

        <SampleDataNotice />
          </>
        )}

        {activeTab === "customers" && (
          <section className="mt-4">
            <div className="rounded-2xl border hairline bg-panel p-5">
              <SectionLabel n="CU" title="Customers" />
              <CustomerManager
                customers={customers}
                scenarios={scenarios}
                onAdd={addCustomer}
                onUpdate={updateCustomer}
                onRemove={removeCustomer}
                portfolioProjections={portfolioProjections}
              />
            </div>
          </section>
        )}

        {activeTab === "portfolio" && (
          <section className="mt-4">
            <div className="rounded-2xl border hairline bg-panel p-5">
              <SectionLabel n="PF" title="Portfolio" />
              <PortfolioView
                combinedPeak={combinedPeak}
                growth={growth}
                portfolioProjections={portfolioProjections}
              />
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ pieces */

function Header() {
  const handleExport = () => {
    const data = {
      scenarios: loadJSON("voice-ai:scenarios", []),
      components: loadJSON("voice-ai:components", {}),
      customers: loadJSON("voice-ai:customers", []),
      overrides: loadJSON("voice-ai:overrides", {}),
      activeScenarioId: loadJSON("voice-ai:activeScenarioId", null),
      counter: loadJSON("voice-ai:counter", {}),
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `voice-ai-model-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result as string);
          if (data.scenarios) localStorage.setItem("voice-ai:scenarios", JSON.stringify(data.scenarios));
          if (data.components) localStorage.setItem("voice-ai:components", JSON.stringify(data.components));
          if (data.customers) localStorage.setItem("voice-ai:customers", JSON.stringify(data.customers));
          if (data.overrides) localStorage.setItem("voice-ai:overrides", JSON.stringify(data.overrides));
          if (data.activeScenarioId) localStorage.setItem("voice-ai:activeScenarioId", JSON.stringify(data.activeScenarioId));
          if (data.counter) localStorage.setItem("voice-ai:counter", JSON.stringify(data.counter));
          window.location.reload();
        } catch { alert("Invalid file — could not import."); }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  return (
    <header className="border-b hairline">
      <div className="mx-auto flex max-w-[1400px] items-center justify-between px-5 py-4 lg:px-8">
        <div className="flex items-center gap-3">
          <SignalMark />
          <div>
            <div className="text-sm font-semibold tracking-tight text-ink">AI &amp; Infra Cost Modeller</div>
            <div className="eyebrow">TCO · unit economics · capacity · ROI</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleImport}
            className="figure rounded border hairline px-2 py-1 text-[10px] text-muted hover:text-ink"
          >
            import
          </button>
          <button
            onClick={handleExport}
            className="figure rounded border hairline px-2 py-1 text-[10px] text-muted hover:text-ink"
          >
            export
          </button>
          <span className="figure hidden text-xs text-faint sm:block">GBP · sample pricing</span>
        </div>
      </div>
    </header>
  );
}

function SignalMark() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden>
      <rect x="0.5" y="0.5" width="27" height="27" rx="7" stroke="#1E2833" />
      <path
        d="M4 15 L8 15 L10 8 L13 20 L16 11 L18 15 L24 15"
        stroke="#38E1B0"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

function HeroThesis({
  result,
  scenario,
}: {
  result: ReturnType<typeof computeScenarioResult>;
  scenario: Scenario;
}) {
  const benefit = result.roi.grossAvoidedCost;
  const positive = benefit >= 0;
  return (
    <div className="relative overflow-hidden rounded-2xl border hairline bg-panel p-6 grid-noise">
      <div className="eyebrow">Modelled outcome · {scenario.name}</div>
      <div className="mt-3 flex items-baseline gap-3">
        <span className={`figure text-figure-xl ${positive ? "text-signal" : "text-coral"}`}>
          {gbp(benefit, { compact: true })}
        </span>
        <span className="text-sm text-muted">operating saving / yr</span>
      </div>
      <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted">
        Handling{" "}
        <span className="figure text-ink">{num(scenario.callProfile.annualIncomingCalls)}</span> calls a year
        with <span className="figure text-ink">{pct(scenario.outcome.resolutionRate)}</span> resolved by AI
        end-to-end. Total cost
        of ownership <span className="figure text-ink">{gbp(result.breakdown.totalAnnual, { compact: true })}</span>{" "}
        against a <span className="figure text-ink">{gbp(result.roi.baselineAnnualCost, { compact: true })}</span>{" "}
        baseline.
      </p>
      <div className="mt-5 flex flex-wrap gap-6">
        <HeroStat label="ROI" value={pct(result.roi.roiPercentage / 100, 0)} />
        <HeroStat label="Payback" value={years(result.roi.paybackPeriodYears)} />
        <HeroStat label="Cost / resolved" value={gbp(result.costPerResolvedCall, { decimals: 3 })} />
        <HeroStat label="Break-even volume" value={num(result.roi.breakEvenCallVolume)} />
      </div>
    </div>
  );
}

function HeroStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="eyebrow mb-1">{label}</div>
      <div className="figure text-lg text-ink">{value}</div>
    </div>
  );
}

function ExecutiveForecast({
  scenario,
  result,
  components,
  onUpdateComponent,
  onScenarioChange,
  onCallChange,
}: {
  scenario: Scenario;
  result: ReturnType<typeof computeScenarioResult>;
  components: CostComponent[];
  onUpdateComponent: (id: string, patch: Partial<CostComponent>) => void;
  onScenarioChange: React.Dispatch<React.SetStateAction<Scenario>>;
  onCallChange: (patch: Partial<Scenario["callProfile"]>) => void;
}) {
  const humanCostPerContact =
    scenario.baseline.baselineCostPerMinute * scenario.baseline.currentAverageHandleTimeMin;
  const aiCostPerContact = result.costPerIncomingCall;
  const savingPerContact = humanCostPerContact - aiCostPerContact;
  const peakConcurrency = Math.round(result.volumes.peakConcurrentCalls);
  const drCost = categoryLineCost(result, "dr-overhead");
  const preprodCost = categoryLineCost(result, "preprod-overhead");
  const stagingCost = categoryLineCost(result, "staging-overhead");
  const residualHumanCost = categoryCost(result, "HUMAN_ESCALATION");
  const evaluationCost = result.breakdown.byCategory.find(
    (category) => category.category === "EVALUATION_AND_ASSURANCE"
  )?.annualCost ?? 0;
  const operatingModelCost = drCost + preprodCost + stagingCost + evaluationCost;
  const voiceComponent = components.find(
    (component) => component.category === "VOICE_SERVICE" && component.id === "voice-a-percall"
  );
  const humanEscalationComponent = components.find(
    (component) => component.id === "human-escalation"
  );
  const ec2Component = components.find((component) => component.id === "ec2-nitro-inference");
  const llmLineCost = categoryLineCost(result, "bedrock-llm-io");
  const platformOpsComponent = components.find((component) => component.id === "platform-ops");
  const sagemakerRealtimeComponent = components.find(
    (component) => component.id === "sagemaker-realtime-inference"
  );
  const sagemakerRealtimeCost = categoryLineCost(result, "sagemaker-realtime-inference");
  const voicePlatformCostPerAiMinute = voiceComponent?.pricing.unitPrice ?? 0;
  const platformOpsAnnualCost = (platformOpsComponent?.pricing.unitPrice ?? 0) * 12;
  const inputTokensPerAiCall =
    scenario.aiUsage.avgInputTokensPerInteraction * scenario.aiUsage.llmCallsPerConversation;
  const outputTokensPerAiCall =
    scenario.aiUsage.avgOutputTokensPerInteraction * scenario.aiUsage.llmCallsPerConversation;
  const reasoningTokensPerAiCall =
    scenario.aiUsage.avgReasoningTokensPerInteraction * scenario.aiUsage.llmCallsPerConversation;
  const costedTokensPerAiCall = inputTokensPerAiCall + outputTokensPerAiCall;
  const totalTokensPerAiCall = costedTokensPerAiCall + reasoningTokensPerAiCall;
  const annualCostedLlmTokens = costedTokensPerAiCall * result.volumes.aiCalls;
  const ec2Nodes = requiredPeakUnits(ec2Component, peakConcurrency);
  const sagemakerRealtimeUnits = requiredPeakUnits(sagemakerRealtimeComponent, peakConcurrency);
  const abandoned = scenario.outcome.abandonedPercentage;
  const failed = scenario.outcome.failedPercentage;

  const setVolume = (annualIncomingCalls: number) => {
    onScenarioChange((s) => ({
      ...s,
      callProfile: { ...s.callProfile, annualIncomingCalls },
      baseline: { ...s.baseline, currentAnnualCallVolume: annualIncomingCalls },
    }));
  };

  const setDuration = (averageCallDurationMin: number) => {
    onScenarioChange((s) => ({
      ...s,
      callProfile: { ...s.callProfile, averageCallDurationMin },
      baseline: {
        ...s.baseline,
        currentAverageHandleTimeMin: averageCallDurationMin,
        simpleCurrentCostPerContact: s.baseline.baselineCostPerMinute * averageCallDurationMin,
      },
    }));
  };

  const setHumanCostPerMinute = (costPerMinute: number) => {
    onScenarioChange((s) => ({
      ...s,
      baseline: {
        ...s.baseline,
        baselineCostPerMinute: costPerMinute,
        simpleCurrentCostPerContact: costPerMinute * s.baseline.currentAverageHandleTimeMin,
      },
    }));
    if (humanEscalationComponent) {
      onUpdateComponent(humanEscalationComponent.id, {
        pricing: {
          ...humanEscalationComponent.pricing,
          unitPrice: costPerMinute,
        },
      });
    }
  };

  const setResolution = (resolutionRate: number) => {
    onScenarioChange((s) => ({
      ...s,
      outcome: {
        ...s.outcome,
        resolutionRate,
        escalationRate: Math.max(0, 1 - resolutionRate - abandoned - failed),
      },
    }));
  };

  const setPeakConcurrency = (targetPeak: number) => {
    onCallChange({
      concurrencyProfile: scaleConcurrencyProfile(
        scenario.callProfile.concurrencyProfile,
        targetPeak
      ),
    });
  };

  const setVoicePlatformCost = (unitPrice: number) => {
    if (!voiceComponent) return;
    onUpdateComponent(voiceComponent.id, {
      pricing: {
        ...voiceComponent.pricing,
        unitPrice,
      },
    });
  };

  const setPlatformOpsAnnualCost = (annualCost: number) => {
    if (!platformOpsComponent) return;
    onUpdateComponent(platformOpsComponent.id, {
      pricing: {
        ...platformOpsComponent.pricing,
        unitPrice: annualCost / 12,
      },
    });
  };

  const setSagemakerRealtimeEnabled = (enabled: boolean) => {
    if (!sagemakerRealtimeComponent) return;
    onUpdateComponent(sagemakerRealtimeComponent.id, { enabled });
  };

  const setAiUsage = (patch: Partial<Scenario["aiUsage"]>) => {
    onScenarioChange((s) => ({
      ...s,
      aiUsage: {
        ...s.aiUsage,
        ...patch,
      },
    }));
  };

  const applyOverheadPreset = (
    drOverheadPct: number,
    preprodOverheadPct: number,
    stagingOverheadPct: number,
    autoEvaluatedPercentage?: number
  ) => {
    onScenarioChange((s) => ({
      ...s,
      drOverheadPct,
      preprodOverheadPct,
      stagingOverheadPct,
      evaluation: {
        ...s.evaluation,
        autoEvaluatedPercentage: autoEvaluatedPercentage ?? s.evaluation.autoEvaluatedPercentage,
      },
    }));
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.05fr_0.95fr]">
      <div className="rounded-2xl border hairline bg-panel p-5">
        <SectionLabel n="01" title="Executive forecast" />
        <div className="mb-5 grid grid-cols-1 gap-3">
          <Slider
            label="Voice AI platform cost"
            description="Commercial voice platform fee per AI-handled minute."
            min={0}
            max={0.25}
            step={0.005}
            value={voicePlatformCostPerAiMinute}
            onChange={setVoicePlatformCost}
            format={(v) => `${gbp(v, { decimals: 3 })}/AI min`}
          />
          <Slider
            label="Platform run team cost"
            description="Annual internal run-team, programme and operational overhead."
            min={0}
            max={5_000_000}
            step={50_000}
            value={platformOpsAnnualCost}
            onChange={setPlatformOpsAnnualCost}
            format={(v) => `${gbp(v, { compact: true })}/yr`}
          />
          <div>
            <div className="mb-1.5 flex items-center justify-between gap-3">
              <span className="block text-xs text-muted">Operating model preset</span>
              <span className="figure text-[10px] text-amber">
                adds {gbp(operatingModelCost, { compact: true })}/yr
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {OPERATING_MODEL_PRESETS.map((preset) => (
                <PresetButton
                  key={preset.label}
                  label={preset.label}
                  detail={`DR ${preset.dr}% · pre-prod ${preset.preprod}% · staging ${preset.staging}% · eval ${pct(preset.evaluation)}`}
                  active={
                    (scenario.drOverheadPct ?? 0) === preset.dr &&
                    (scenario.preprodOverheadPct ?? 0) === preset.preprod &&
                    (scenario.stagingOverheadPct ?? 0) === preset.staging &&
                    scenario.evaluation.autoEvaluatedPercentage === preset.evaluation
                  }
                  onClick={() =>
                    applyOverheadPreset(
                      preset.dr,
                      preset.preprod,
                      preset.staging,
                      preset.evaluation
                    )
                  }
                />
              ))}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-[10px] text-faint">
              <span>DR: {scenario.drOverheadPct ?? 0}% = {gbp(drCost, { compact: true })}/yr</span>
              <span>Pre-prod: {scenario.preprodOverheadPct ?? 0}% = {gbp(preprodCost, { compact: true })}/yr</span>
              <span>Staging: {scenario.stagingOverheadPct ?? 0}% = {gbp(stagingCost, { compact: true })}/yr</span>
              <span>Evaluation: {pct(scenario.evaluation.autoEvaluatedPercentage)} = {gbp(evaluationCost, { compact: true })}/yr</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <Slider
            label="Annual incoming calls"
            description="Primary demand forecast across the service."
            min={1_000_000}
            max={200_000_000}
            step={1_000_000}
            value={scenario.callProfile.annualIncomingCalls}
            onChange={setVolume}
            format={(v) => num(v)}
          />
          <Slider
            label="Average call duration"
            description="Used for AI, telephony, storage and human baseline minutes."
            min={1}
            max={20}
            step={0.5}
            value={scenario.callProfile.averageCallDurationMin}
            onChange={setDuration}
            format={(v) => `${v} min`}
          />
          <Slider
            label="AI adoption"
            description="Share of calls offered to the voice agent first."
            min={0}
            max={1}
            step={0.01}
            value={scenario.outcome.aiAdoptionPercentage}
            onChange={(v) =>
              onScenarioChange((s) => ({ ...s, outcome: { ...s.outcome, aiAdoptionPercentage: v } }))
            }
            format={(v) => pct(v)}
          />
          <Slider
            label="AI resolution"
            description="Share of AI calls completed without a human handoff."
            min={0}
            max={1}
            step={0.01}
            value={scenario.outcome.resolutionRate}
            onChange={setResolution}
            format={(v) => pct(v)}
          />
          <Slider
            label="Human cost per minute"
            description="Fully loaded agent handling cost per minute. Human cost/contact is derived from duration."
            min={0.01}
            max={2}
            step={0.01}
            value={scenario.baseline.baselineCostPerMinute}
            onChange={setHumanCostPerMinute}
            format={(v) => `${gbp(v, { decimals: 2 })}/min`}
          />
          <Slider
            label="Peak concurrent calls"
            description="Capacity driver for real-time voice infrastructure."
            min={100}
            max={100_000}
            step={100}
            value={peakConcurrency}
            onChange={setPeakConcurrency}
            format={(v) => num(v)}
          />
          <div className="rounded-lg border hairline bg-panel2 p-3 md:col-span-2">
            <div className="mb-4">
              <h3 className="text-xs font-semibold tracking-tight text-ink">LLM Token Costs</h3>
              <p className="mt-1 text-[10px] leading-relaxed text-ink/90">
                Controls how many model calls happen per phone call and how many input/output tokens each model call uses.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
              <Slider
                label="LLM turns per call"
                description="How many times the AI voice agent calls the language model during one phone call."
                min={1}
                max={15}
                step={1}
                value={scenario.aiUsage.llmCallsPerConversation}
                onChange={(v) => setAiUsage({ llmCallsPerConversation: v })}
                format={(v) => num(v)}
              />
              <Slider
                label="Input tokens per turn"
                description="Prompt, history, retrieval context and tool context per LLM call."
                min={250}
                max={12_000}
                step={250}
                value={scenario.aiUsage.avgInputTokensPerInteraction}
                onChange={(v) => setAiUsage({ avgInputTokensPerInteraction: v })}
                format={(v) => num(v)}
              />
              <Slider
                label="Output tokens per turn"
                description="Average assistant response tokens per LLM call."
                min={50}
                max={2_000}
                step={50}
                value={scenario.aiUsage.avgOutputTokensPerInteraction}
                onChange={(v) => setAiUsage({ avgOutputTokensPerInteraction: v })}
                format={(v) => num(v)}
              />
            </div>
          </div>
          <div className="rounded-lg border hairline bg-panel2 p-3">
            <div className="mb-1.5 flex items-start justify-between gap-3">
              <div>
                <div className="text-xs text-muted">SageMaker real-time inference</div>
                <p className="mt-1 text-[10px] leading-relaxed text-ink/90">
                  Optional AWS calculator line. Enable only if Gov Voice uses SageMaker endpoints as a
                  real-time inference tier in addition to EC2/Nitro.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSagemakerRealtimeEnabled(!sagemakerRealtimeComponent?.enabled)}
                className={`figure rounded-full border px-3 py-1 text-[10px] ${
                  sagemakerRealtimeComponent?.enabled
                    ? "border-signalDim bg-signal/10 text-signal"
                    : "hairline bg-panel text-faint"
                }`}
              >
                {sagemakerRealtimeComponent?.enabled ? "Included" : "Excluded"}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[10px] text-faint">
              <span>Peak units: {num(sagemakerRealtimeUnits)}</span>
              <span>Annual cost: {gbp(sagemakerRealtimeCost, { compact: true })}</span>
            </div>
          </div>
          <Slider
            label="Evaluation sampling"
            description="Calls automatically quality-checked by AI evaluation."
            min={0}
            max={1}
            step={0.01}
            value={scenario.evaluation.autoEvaluatedPercentage}
            onChange={(v) =>
              onScenarioChange((s) => ({ ...s, evaluation: { ...s.evaluation, autoEvaluatedPercentage: v } }))
            }
            format={(v) => pct(v, v < 0.1 ? 1 : 0)}
          />
          <Slider
            label="Year 1 ramp"
            description="Lower effective variable usage during rollout."
            min={0}
            max={12}
            step={1}
            value={scenario.callProfile.yearOneRampMonths ?? 0}
            onChange={(v) => onCallChange({ yearOneRampMonths: v })}
            format={(v) => (v === 0 ? "instant" : `${v} months`)}
          />
        </div>
      </div>

      <div className="space-y-6">
        <div className="rounded-2xl border hairline bg-panel p-5">
          <SectionLabel n="02" title="Forecast output" />
	          <div className="mb-3 grid grid-cols-1 gap-2">
	            <MiniMetric label="Human baseline / year" value={gbp(result.roi.baselineAnnualCost, { compact: true })} />
	            <MiniMetric label="AI + infra TCO / year" value={gbp(result.breakdown.totalAnnual, { compact: true })} accent="coral" />
	            <MiniMetric label="Operating saving / year" value={gbp(result.roi.grossAvoidedCost, { compact: true })} accent={result.roi.grossAvoidedCost >= 0 ? "signal" : "coral"} />
	          </div>
	          <div className="mb-3 rounded-lg border hairline bg-panel2 p-3">
	            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink/90">
	              Human baseline run-rate
	            </div>
	            <div className="grid grid-cols-3 gap-2">
	              <MiniMetric label="Daily" value={gbp(result.roi.baselineAnnualCost / 365, { compact: true })} accent="coral" />
	              <MiniMetric label="Monthly" value={gbp(result.roi.baselineAnnualCost / 12, { compact: true })} accent="coral" />
	              <MiniMetric label="Annual" value={gbp(result.roi.baselineAnnualCost, { compact: true })} accent="coral" />
	            </div>
	          </div>
	          <div className="grid grid-cols-2 gap-2">
            <MiniMetric label="Human cost/contact" value={gbp(humanCostPerContact, { decimals: 2 })} />
            <MiniMetric label="AI cost/contact" value={gbp(aiCostPerContact, { decimals: 3 })} />
            <MiniMetric label="Saving/contact" value={gbp(savingPerContact, { decimals: 3 })} accent={savingPerContact >= 0 ? "signal" : "coral"} />
            <MiniMetric label="ROI" value={pct(result.roi.roiPercentage / 100, 0)} accent={result.roi.roiPercentage >= 0 ? "signal" : "coral"} sub={`payback ${years(result.roi.paybackPeriodYears)}`} />
            <MiniMetric label="AI resolved calls" value={num(result.volumes.resolvedCalls)} accent="signal" />
            <MiniMetric label="Residual human calls" value={num(result.volumes.residualHumanCalls)} accent="amber" />
            <MiniMetric label="Residual human cost" value={gbp(residualHumanCost, { compact: true })} accent="amber" />
            <MiniMetric label="Peak concurrency" value={num(peakConcurrency)} accent="amber" />
            <MiniMetric label="EC2 nodes required" value={num(ec2Nodes)} accent="amber" />
            <MiniMetric label="LLM tokens / AI call" value={num(totalTokensPerAiCall)} sub={`${num(costedTokensPerAiCall)} billed in/out`} />
            <MiniMetric label="Annual LLM tokens" value={num(annualCostedLlmTokens)} />
            <MiniMetric label="LLM cost / year" value={gbp(llmLineCost, { compact: true })} />
            <MiniMetric label="Run team / year" value={gbp(platformOpsAnnualCost, { compact: true })} />
            {sagemakerRealtimeComponent?.enabled && (
              <MiniMetric label="SageMaker / year" value={gbp(sagemakerRealtimeCost, { compact: true })} accent="violet" sub={`${num(sagemakerRealtimeUnits)} peak units`} />
            )}
          </div>
        </div>

	        <AssumptionSummary scenario={scenario} result={result} />
	      </div>
    </div>
  );
}

function PresetButton({
  label,
  detail,
  active,
  onClick,
}: {
  label: string;
  detail: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border px-2 py-2 text-left transition-colors ${
        active
          ? "border-signalDim bg-signal/10 text-ink"
          : "hairline bg-panel2 text-muted hover:border-signalDim hover:text-ink"
      }`}
    >
      <span className="figure block text-xs">{label}</span>
      <span className="mt-1 block text-[10px] leading-snug text-faint">{detail}</span>
    </button>
  );
}

function ForecastResults({ projection }: { projection: ForecastProjectionRow[] }) {
  const totalForecastCost = projection.reduce((sum, row) => sum + row.totalCost, 0);
  const maxCost = Math.max(...projection.map((row) => row.totalCost), 1);

  const valueFor = (row: ForecastProjectionRow, key: string) => {
    if (key === "callVolume") return row.volume;
    if (key === "totalCost") return row.totalCost;
    if (key === "yoyChangePct") return row.yoyChangePct;
    if (key === "costPerCall") return row.costPerCall;
    return key in row.categories ? row.categories[key as ForecastCategoryKey] : 0;
  };

  const formatForecastValue = (value: number, kind: string) => {
    if (kind === "number") return num(value);
    if (kind === "percent") return value === 0 ? "-" : `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
    if (kind === "unitMoney") return gbp(value, { decimals: 3 });
    return gbp(value, { compact: true });
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <MiniMetric label="Total forecast cost" value={gbp(totalForecastCost, { compact: true })} accent="coral" />
        <MiniMetric label="Final year calls" value={num(projection.at(-1)?.volume ?? 0)} />
        <MiniMetric label="Final year cost/call" value={gbp(projection.at(-1)?.costPerCall ?? 0, { decimals: 3 })} />
      </div>

      <div className="rounded-xl border hairline bg-panel2 p-4">
        <div className="mb-3 text-xs font-semibold text-ink">Total cost by year</div>
        <div className="flex h-36 items-end gap-2">
          {projection.map((row) => (
            <div key={row.fiscalYear} className="flex flex-1 flex-col items-center gap-2">
              <div
                className="w-full rounded-t bg-signal/70"
                style={{ height: `${Math.max(6, (row.totalCost / maxCost) * 100)}%` }}
                title={`${row.label}: ${gbp(row.totalCost, { compact: true })}`}
              />
              <div className="figure text-[10px] text-faint">{row.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border hairline">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b hairline bg-panel2 text-left">
              <th className="sticky left-0 bg-panel2 px-3 py-2 eyebrow font-normal">Cost</th>
              {projection.map((row) => (
                <th key={row.fiscalYear} className="px-3 py-2 eyebrow font-normal text-right">
                  {row.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {FORECAST_COST_ROWS.map((forecastRow) => (
              <tr key={forecastRow.key} className="border-b hairline">
                <td className="sticky left-0 bg-panel px-3 py-2 text-xs text-ink">{forecastRow.label}</td>
                {projection.map((row) => (
                  <td key={`${forecastRow.key}-${row.fiscalYear}`} className="px-3 py-2 text-right figure text-xs text-muted">
                    {formatForecastValue(valueFor(row, forecastRow.key), forecastRow.kind)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] leading-relaxed text-ink/90">
        Forecast uses the existing scenario and cost engine for every year. Year overrides replace automatic call-growth values.
      </p>
    </div>
  );
}

function AssumptionSummary({
  scenario,
  result,
}: {
  scenario: Scenario;
  result: ReturnType<typeof computeScenarioResult>;
}) {
  const inputTokensPerAiCall =
    scenario.aiUsage.avgInputTokensPerInteraction * scenario.aiUsage.llmCallsPerConversation;
  const outputTokensPerAiCall =
    scenario.aiUsage.avgOutputTokensPerInteraction * scenario.aiUsage.llmCallsPerConversation;
  const reasoningTokensPerAiCall =
    scenario.aiUsage.avgReasoningTokensPerInteraction * scenario.aiUsage.llmCallsPerConversation;
  const totalTokensPerAiCall = inputTokensPerAiCall + outputTokensPerAiCall + reasoningTokensPerAiCall;
  const annualLlmCost = categoryLineCost(result, "bedrock-llm-io");
  const sagemakerRealtimeCost = categoryLineCost(result, "sagemaker-realtime-inference");
  const items = [
    ["AI outcome", `${pct(scenario.outcome.aiAdoptionPercentage)} adoption, ${pct(scenario.outcome.resolutionRate)} resolution, ${pct(scenario.outcome.escalationRate)} escalation`],
    ["Human baseline", `${gbp(scenario.baseline.baselineCostPerMinute, { decimals: 2 })}/min, ${gbp(scenario.baseline.simpleCurrentCostPerContact, { decimals: 2 })}/contact derived`],
    ["Voice usage", `${num(result.volumes.aiCalls)} AI calls, ${gbp(result.costPerAiMinute, { decimals: 3 })}/AI min`],
    ["LLM usage", `${num(scenario.aiUsage.llmCallsPerConversation)} turns/call, ${num(totalTokensPerAiCall)} tokens/AI call, ${gbp(annualLlmCost, { compact: true })}/yr`],
    ["Overheads", `${scenario.drOverheadPct ?? 0}% DR, ${scenario.preprodOverheadPct ?? 0}% pre-prod, ${scenario.stagingOverheadPct ?? 0}% staging`],
    ["Assurance", `${pct(scenario.evaluation.autoEvaluatedPercentage)} evaluated, ${scenario.storage.audioRetentionDays}d audio retention`],
  ];
  if (sagemakerRealtimeCost > 0) {
    items.push(["SageMaker real-time", `${gbp(sagemakerRealtimeCost, { compact: true })}/yr included as optional endpoint capacity`]);
  }

  return (
    <div className="rounded-2xl border hairline bg-panel p-5">
      <SectionLabel n="04" title="Assumptions included" />
      <div className="space-y-2">
        {items.map(([label, value]) => (
          <div key={label} className="flex items-start justify-between gap-4 border-b hairline pb-2 last:border-0 last:pb-0">
            <span className="text-xs text-faint">{label}</span>
            <span className="max-w-[70%] text-right text-xs text-muted">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MiniMetric({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: "signal" | "coral" | "amber" | "violet";
}) {
  const color =
    accent === "signal" ? "text-signal" :
    accent === "coral" ? "text-coral" :
    accent === "amber" ? "text-amber" :
    accent === "violet" ? "text-violet" : "text-ink";
  return (
    <div className="rounded-lg border hairline bg-panel2 px-3 py-2">
      <div className="text-[10px] text-faint">{label}</div>
      <div className={`figure text-sm ${color}`}>{value}</div>
      {sub && <div className="text-[10px] text-faint">{sub}</div>}
    </div>
  );
}

function SectionLabel({ n, title, inline }: { n: string; title: string; inline?: boolean }) {
  return (
    <div className={`flex items-center gap-2.5 ${inline ? "" : "mb-4"}`}>
      <span className="figure text-xs text-signalDim">{n}</span>
      <span className="h-px w-5 bg-line" />
      <h2 className="text-sm font-semibold tracking-tight text-ink">{title}</h2>
    </div>
  );
}

function toCsv(headers: string[], rows: string[][]): string {
  const escape = (v: string) => v.includes(",") || v.includes('"') ? `"${v.replace(/"/g, '""')}"` : v;
  return [headers.join(","), ...rows.map((r) => r.map(escape).join(","))].join("\n");
}

function downloadCSV(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function exportCSV(scenario: any, result: any, projection: any[], portfolio: any[], portfolioProjections: any[]) {
  const parts: string[] = [];
  // Scenario parameters
  parts.push(toCsv(["Parameter", "Value"], [
    ["Scenario", scenario.name],
    ["Annual calls", String(scenario.callProfile.annualIncomingCalls)],
    ["Avg call duration", `${scenario.callProfile.averageCallDurationMin} min`],
    ["AI resolution", `${(scenario.outcome.resolutionRate * 100).toFixed(0)}%`],
    ["Human cost/min", `£${scenario.baseline.baselineCostPerMinute.toFixed(2)}`],
    ["Derived baseline cost/call", `£${scenario.baseline.simpleCurrentCostPerContact.toFixed(2)}`],
    ["DR overhead", `${scenario.drOverheadPct ?? 0}%`],
    ["Year 1 ramp", `${scenario.callProfile.yearOneRampMonths ?? 0} months`],
    ["Investment", `£${scenario.investment.toLocaleString()}`],
    ["", ""],
  ]));
  // Executive metrics
  parts.push(toCsv(["Metric", "Value"], [
    ["Annual TCO", `£${result.breakdown.totalAnnual.toLocaleString()}`],
    ["Baseline cost", `£${result.roi.baselineAnnualCost.toLocaleString()}`],
    ["Net benefit", `£${result.roi.netBenefit.toLocaleString()}`],
    ["ROI", `${result.roi.roiPercentage.toFixed(1)}%`],
    ["Payback", `${result.roi.paybackPeriodYears.toFixed(2)} years`],
    ["Cost/incoming call", `£${result.costPerIncomingCall.toFixed(4)}`],
    ["Cost/AI minute", `£${result.costPerAiMinute.toFixed(4)}`],
    ["Cost/resolved call", `£${result.costPerResolvedCall.toFixed(4)}`],
    ["Peak concurrency", String(result.volumes.peakConcurrentCalls)],
    ["", ""],
  ]));
  // Cost breakdown
  parts.push(toCsv(["Category", "Annual Cost", "Per Call"], result.breakdown.byCategory.map((c: any) => [c.category, `£${c.annualCost.toFixed(2)}`, `£${c.perCall.toFixed(4)}`])));
  // Multi-year forecast
  if (projection.length > 0) {
    parts.push(toCsv([
      "Year",
      "Call volume",
      "Peak concurrency",
      "Voice supplier",
      "Telephony",
      "AI / LLM",
      "Infrastructure",
      "Storage",
      "Evaluation",
      "Operations",
      "Total cost",
      "Cost per call",
      "YoY cost change",
    ],
      projection.map((r: any) => [
        r.label ?? String(r.year),
        String(r.volume),
        String(r.peakConcurrency),
        `£${(r.categories?.voiceSupplier ?? 0).toFixed(2)}`,
        `£${(r.categories?.telephony ?? 0).toFixed(2)}`,
        `£${(r.categories?.aiLlm ?? 0).toFixed(2)}`,
        `£${(r.categories?.infrastructure ?? 0).toFixed(2)}`,
        `£${(r.categories?.storage ?? 0).toFixed(2)}`,
        `£${(r.categories?.evaluation ?? 0).toFixed(2)}`,
        `£${(r.categories?.operations ?? 0).toFixed(2)}`,
        `£${r.totalCost.toFixed(2)}`,
        `£${r.costPerCall.toFixed(4)}`,
        `${r.yoyChangePct.toFixed(1)}%`,
      ])
    ));
  }
  // Portfolio
  if (portfolio.length > 0 && portfolioProjections.length > 0) {
    parts.push(toCsv(["Customer", "Year", "Volume", "Peak Concurrency", "DR Cost", "TCO"],
      portfolioProjections.flatMap((p: any) =>
        p.customers.map((c: any) => [
          c.customer.name,
          p.label ?? String(p.year),
          String(c.volume),
          String(c.peakConcurrency ?? 0),
          `£${c.drCost.toFixed(2)}`,
          `£${c.tco.toFixed(2)}`,
        ])
      )
    ));
  }
  downloadCSV(`ai-cost-model-${new Date().toISOString().slice(0,10)}.csv`, parts.join("\n\n"));
}

function SampleDataNotice() {
  return (
    <div className="mt-12 rounded-xl border border-[#4a3a1a] bg-[#1a1509] p-4">
      <div className="figure text-xs text-amber">⚠ SAMPLE DATA</div>
      <p className="mt-1.5 text-xs leading-relaxed text-muted">
        All supplier and AWS prices shown are illustrative placeholders for demonstration only. They do not
        represent current, quoted or contracted pricing from any provider. Replace the seed data with real
        commercial and cloud pricing before using this model for any decision. The calculation engine is
        independent of the pricing data — updating prices requires no code changes.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ helpers */

function scaleConcurrencyProfile(profile: number[] | undefined, targetPeak: number): number[] {
  const base =
    profile && profile.length === 24
      ? profile
      : [500, 300, 200, 150, 150, 200, 500, 1000, 4000, 8000, 10000, 12000, 12000, 11000, 10000, 9000, 8000, 6000, 4000, 2000, 1500, 1200, 1000, 800];
  const currentPeak = Math.max(...base, 1);
  const factor = Math.max(1, targetPeak) / currentPeak;
  return base.map((v) => Math.round(v * factor));
}

function requiredPeakUnits(component: CostComponent | undefined, peakConcurrency: number): number {
  const scaling = component?.pricing.scaling;
  if (!component?.enabled || !scaling) return 0;
  const capacityPerUnit = Math.max(1e-9, scaling.capacityPerUnit);
  const calculatedUnits = scaling.manualUnits ?? Math.ceil(peakConcurrency / capacityPerUnit);
  const unitsWithMinimum = Math.max(scaling.minUnits, calculatedUnits);
  return scaling.maxUnits == null ? unitsWithMinimum : Math.min(scaling.maxUnits, unitsWithMinimum);
}

function projectionFactor(percent: number, yearIndex: number): number {
  return Math.pow(1 + percent / 100, yearIndex);
}

function fiscalYearLabel(year: number): string {
  return `FY${String(year).slice(-2)}`;
}

function scaleConcurrencyProfileByFactor(profile: number[], factor: number): number[] {
  return profile.map((value) => Math.max(1, Math.round(value * factor)));
}

function applyProjectionPriceChanges(
  components: CostComponent[],
  settings: ProjectionSettings,
  componentRates: Record<string, number>,
  yearIndex: number,
  includeOneOff: boolean
): CostComponent[] {
  return components.map((component) => {
    const annualChangePct =
      componentRates[component.id] ??
      defaultProjectionRateForComponent(component, settings);
    const factor = projectionFactor(annualChangePct, yearIndex);

    const unitPrice =
      component.classification === "ONE_OFF" && !includeOneOff
        ? 0
        : component.pricing.unitPrice * factor;

    return {
      ...component,
      pricing: {
        ...component.pricing,
        unitPrice,
        inputUnitPrice:
          component.pricing.inputUnitPrice == null
            ? undefined
            : component.pricing.inputUnitPrice * factor,
        outputUnitPrice:
          component.pricing.outputUnitPrice == null
            ? undefined
            : component.pricing.outputUnitPrice * factor,
        tiers: component.pricing.tiers?.map((tier) => ({
          ...tier,
          unitPrice: tier.unitPrice * factor,
        })),
        scaling: component.pricing.scaling ? { ...component.pricing.scaling } : undefined,
      },
    };
  });
}

function defaultProjectionRateForComponent(
  component: CostComponent,
  settings: ProjectionSettings
): number {
  if (component.category === "VOICE_SERVICE") return settings.supplierPricePct;
  if (isTokenCost(component) || component.category === "KNOWLEDGE") return settings.aiPricePct;
  if (isInfrastructureCost(component)) return settings.infrastructurePricePct;
  return settings.inflationPct;
}

function isInfrastructureCost(component: CostComponent): boolean {
  return (
    component.category === "AI_AND_COMPUTE" ||
    component.category === "TELEPHONY_AND_INTEGRATION" ||
    component.category === "AUDIO_TRANSCRIPT_STORAGE" ||
    component.category === "OPERATIONS_AND_OBSERVABILITY" ||
    component.category === "DATA_AND_ANALYTICS"
  );
}

function isTokenCost(component: CostComponent): boolean {
  return (
    component.pricing.model === "INPUT_OUTPUT_TOKENS" ||
    component.pricing.model === "PER_TOKEN" ||
    component.pricing.model === "PER_1000_TOKENS" ||
    component.pricing.model === "PER_1000000_TOKENS" ||
    component.id === "bedrock-llm-io" ||
    component.id === "eval-llm"
  );
}

function forecastCategoryCosts(r: ReturnType<typeof computeScenarioResult>) {
  const byCategory = (category: string) => categoryCost(r, category);
  const lineCost = (ids: string[]) =>
    r.breakdown.lines
      .filter((line) => ids.includes(line.componentId))
      .reduce((sum, line) => sum + line.annualCost, 0);
  const llmTokens = lineCost(["bedrock-llm-io", "eval-llm"]);
  const aiLlm = llmTokens + byCategory("KNOWLEDGE");
  const infrastructure = byCategory("AI_AND_COMPUTE") - lineCost(["bedrock-llm-io"]);
  const operations =
    byCategory("FIXED_OPERATIONAL") +
    byCategory("HUMAN_ESCALATION") +
    byCategory("OPERATIONS_AND_OBSERVABILITY") +
    byCategory("DATA_AND_ANALYTICS");

  return {
    voiceSupplier: byCategory("VOICE_SERVICE"),
    telephony: byCategory("TELEPHONY_AND_INTEGRATION"),
    aiLlm,
    infrastructure: Math.max(0, infrastructure),
    storage: byCategory("AUDIO_TRANSCRIPT_STORAGE"),
    evaluation: byCategory("EVALUATION_AND_ASSURANCE"),
    operations,
  };
}

function categoryCost(r: ReturnType<typeof computeScenarioResult>, cat: string): number {
  return r.breakdown.byCategory.find((c) => c.category === cat)?.annualCost ?? 0;
}

function categoryLineCost(r: ReturnType<typeof computeScenarioResult>, componentId: string): number {
  return r.breakdown.lines.find((line) => line.componentId === componentId)?.annualCost ?? 0;
}
