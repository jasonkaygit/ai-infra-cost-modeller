"use client";

import React, { useMemo, useState, useCallback, useRef, useEffect } from "react";
import { SEED_COMPONENTS, SEED_SUPPLIERS, SEED_SCENARIOS } from "../data/seed";
import { computeScenarioResult } from "../engine/scenario";
import { buildUsageContext } from "../engine/usageContext";
import type { Scenario, CostComponent, UsageDriver, Customer } from "../domain/types";
import { CostWaterfall } from "./components/CostWaterfall";
import { FixedVariableSplit } from "./components/FixedVariableSplit";
import { BreakdownTable } from "./components/BreakdownTable";
import { Slider } from "./components/Control";
import { DriverOverrides } from "./components/DriverOverrides";
import { AddComponentForm } from "./components/AddComponentForm";
import { ScenarioManager } from "./components/ScenarioManager";
import { CostFlowDiagram } from "./components/CostFlowDiagram";
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

export default function Page() {
  const [scenario, setScenario] = useState<Scenario>(() => {
    const saved = loadJSON<Scenario | null>(LS_KEYS.activeScenarioId, null);
    if (saved) return saved;
    return { ...SEED_SCENARIOS[0] };
  });
  const [waterfallMode, setWaterfallMode] = useState<"total" | "perCall">("total");
  const [showBreakdown, setShowBreakdown] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [activeTab, setActiveTab] = useState<"overview" | "customers" | "portfolio">("overview");

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

  // Growth rates for multi-year projection
  const [growth, setGrowth] = useState(() =>
    loadJSON("voice-ai:growth", { volumePct: 15, resolutionPts: 3, inflationPct: 3, years: 3 })
  );
  useEffect(() => { saveJSON("voice-ai:growth", growth); }, [growth]);

  // Auto-set default concurrency profile if none is set on the active scenario
  useEffect(() => {
    if (!scenario.callProfile.concurrencyProfile) {
      setCall({ concurrencyProfile: DEFAULT_CONCURRENCY });
    }
  }, []); // run once on mount

  // Persist active scenario + counter
  useEffect(() => { saveJSON(LS_KEYS.activeScenarioId, scenario); }, [scenario]);

  // Scenarios — ensure all have a concurrency profile
  const DEFAULT_CONCURRENCY = [500, 300, 200, 150, 150, 200, 500, 1000, 4000, 8000, 10000, 12000, 12000, 11000, 10000, 9000, 8000, 6000, 4000, 2000, 1500, 1200, 1000, 800];
  const ensureProfile = (s: Scenario): Scenario => ({
    ...s,
    callProfile: {
      ...s.callProfile,
      concurrencyProfile: s.callProfile.concurrencyProfile ?? DEFAULT_CONCURRENCY,
    },
  });
  const [scenarios, setScenarios] = useState<Scenario[]>(() =>
    loadJSON(LS_KEYS.scenarios, SEED_SCENARIOS.map((s) => ensureProfile({ ...s }))).map(ensureProfile)
  );
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
      pricing: { ...c.pricing, tiers: c.pricing.tiers?.map((t) => ({ ...t })) },
    }));

  const [componentSnapshots, setComponentSnapshots] = useState<
    Record<string, CostComponent[]>
  >(() => {
    const saved = loadJSON<Record<string, CostComponent[]> | null>(LS_KEYS.components, null);
    if (saved && Object.keys(saved).length > 0) return saved;
    const init: Record<string, CostComponent[]> = {};
    for (const s of SEED_SCENARIOS) {
      init[s.id] = cloneComponents(SEED_COMPONENTS);
    }
    return init;
  });

  useEffect(() => { saveJSON(LS_KEYS.components, componentSnapshots); }, [componentSnapshots]);

  const components =
    componentSnapshots[scenario.id] ?? cloneComponents(SEED_COMPONENTS);

  const defaultSupplier = SEED_SUPPLIERS[0];
  const supplier = defaultSupplier;

  const [driverOverrides, setDriverOverrides] = useState<Partial<Record<UsageDriver, number>>>(
    () => loadJSON(LS_KEYS.overrides, {})
  );

  useEffect(() => { saveJSON(LS_KEYS.overrides, driverOverrides); }, [driverOverrides]);

  // DR overhead: two-pass calculation to avoid circular dependency.
  // Pass 1: compute result without DR to get the base infrastructure cost.
  // Pass 2: set DR unit price = preDR total × drPct, compute final result.
  const drPct = (scenario.drOverheadPct ?? 0) / 100;
  const componentsWithoutDR = useMemo(
    () =>
      components.map((c) =>
        c.id === "dr-overhead" ? { ...c, pricing: { ...c.pricing, unitPrice: 0 } } : c
      ),
    [components]
  );

  const preDRResult = useMemo(
    () => computeScenarioResult(scenario, supplier, componentsWithoutDR, driverOverrides),
    [scenario, supplier, componentsWithoutDR, driverOverrides]
  );

  const componentsWithDR = useMemo(
    () =>
      drPct > 0
        ? components.map((c) =>
            c.id === "dr-overhead"
              ? {
                  ...c,
                  pricing: { ...c.pricing, unitPrice: (preDRResult.breakdown.totalAnnual * drPct) / 12 },
                }
              : c
          )
        : components,
    [components, drPct, preDRResult.breakdown.totalAnnual]
  );

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

  const combinedPeak = Math.max(
    ...(scenario.callProfile.concurrencyProfile ?? DEFAULT_CONCURRENCY),
    1
  );
  const combinedTCO = portfolio.reduce((s, p) => s + p.totalWithDR, 0);
  const combinedDR = portfolio.reduce((s, p) => s + p.drCost, 0);
  const combinedCalls = portfolio.reduce((s, p) => s + p.result.volumes.annualIncomingCalls, 0);

  // Multi-year portfolio projections: compute full engine run per customer per year
  const portfolioProjections = useMemo(() => {
    const years = growth.years;
    const result: { year: number; customers: { customer: Customer; volume: number; resolution: number; baselineCost: number; tco: number; drCost: number; }[]; totalTCO: number; totalDR: number; totalBenefit: number; }[] = [];
    for (let y = 1; y <= years; y++) {
      let factor = 1; let resPts = 0;
      for (let yy = 2; yy <= y; yy++) { factor *= 1 + growth.volumePct / 100; resPts += growth.resolutionPts / 100; }
      const inflation = Math.pow(1 + growth.inflationPct / 100, y - 1);
      const activeDrPct = scenario.drOverheadPct ?? 0;
      const activeProf = scenario.callProfile.concurrencyProfile;
      const customers = portfolio.map(({ customer, scenario: custScenario }) => {
        const vol = Math.round(custScenario.callProfile.annualIncomingCalls * factor);
        const res = Math.min(0.95, custScenario.outcome.resolutionRate + resPts);
        const bl = custScenario.baseline.simpleCurrentCostPerContact * inflation;
        const cp = customer.concurrencyProfile ?? custScenario.callProfile.concurrencyProfile ?? activeProf;
        const scen: Scenario = {
          ...custScenario,
          callProfile: { ...custScenario.callProfile, annualIncomingCalls: vol, concurrencyProfile: cp },
          outcome: { ...custScenario.outcome, resolutionRate: res },
          baseline: { ...custScenario.baseline, simpleCurrentCostPerContact: bl, currentAnnualCallVolume: vol },
        };
        const r = computeScenarioResult(scen, supplier, componentsWithoutDR, driverOverrides);
        const preDR = r.breakdown.totalAnnual;
        const dr = (activeDrPct / 100) * preDR;
        return { customer, volume: vol, resolution: res, baselineCost: bl, tco: preDR + dr, drCost: dr };
      });
      result.push({
        year: y,
        customers,
        totalTCO: customers.reduce((s, c) => s + c.tco, 0),
        totalDR: customers.reduce((s, c) => s + c.drCost, 0),
        totalBenefit: customers.reduce((s, c) => s + c.baselineCost * c.volume - c.tco, 0),
      });
    }
    return result;
  }, [portfolio, growth, supplier, componentsWithoutDR, driverOverrides]);

  // Multi-year projection
  const projection = useMemo(() => {
    const rows = [];
    let vol = scenario.callProfile.annualIncomingCalls;
    let res = scenario.outcome.resolutionRate;
    let bl = scenario.baseline.simpleCurrentCostPerContact;
    let cumNet = 0;
    for (let y = 1; y <= growth.years; y++) {
      const scen: Scenario = {
        ...scenario,
        callProfile: { ...scenario.callProfile, annualIncomingCalls: Math.round(vol) },
        outcome: { ...scenario.outcome, resolutionRate: Math.min(0.95, res) },
        baseline: { ...scenario.baseline, simpleCurrentCostPerContact: bl, currentAnnualCallVolume: Math.round(vol) },
      };
      const r = computeScenarioResult(scen, supplier, componentsWithoutDR, driverOverrides);
      const preDR = r.breakdown.totalAnnual;
      const drCost = ((scen.drOverheadPct ?? 0) / 100) * preDR;
      const tco = preDR + drCost;
      const benefit = r.roi.baselineAnnualCost - tco;
      cumNet += benefit;
      rows.push({ year: y, volume: Math.round(vol), resolution: res, baselineCost: bl, tco, drCost, netBenefit: benefit, cumulativeNetBenefit: cumNet });
      vol *= 1 + growth.volumePct / 100;
      res = Math.min(0.95, res + growth.resolutionPts / 100);
      bl *= 1 + growth.inflationPct / 100;
    }
    return rows;
  }, [scenario, supplier, componentsWithoutDR, driverOverrides, growth]);

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
        [scenario.id]: (prev[scenario.id] ?? []).map((c) =>
          c.id === id ? { ...c, ...patch } : c
        ),
      }));
    },
    [scenario.id]
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
              {tab === "overview" ? "Scenario" : tab === "customers" ? `Customers${customers.length > 0 ? ` (${customers.length})` : ""}` : "Portfolio"}
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
            <div className="rounded-2xl border hairline bg-panel p-5">
              <SectionLabel n="DR" title="Disaster recovery" />
              <Slider
                label="DR overhead"
                description="Disaster recovery cost as a percentage of total infrastructure. 30–50% = pilot light, 50–80% = warm standby, 80–100% = active-active."
                min={0}
                max={100}
                step={5}
                value={scenario.drOverheadPct ?? 0}
                onChange={(v) =>
                  setScenario((s) => ({ ...s, drOverheadPct: v }))
                }
                format={(v) => (v === 0 ? "none" : `${v}% of infra`)}
              />
              <p className="mt-2 text-[10px] text-faint">
                0% = no DR · 30–50% = pilot light · 50–80% = warm standby · 80–100% = hot standby / active-active
              </p>
            </div>
          </div>
        </section>

        {/* Sensitivity + Executive metrics side by side */}
        <section className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.4fr]">
          <div className="rounded-2xl border hairline bg-panel p-5">
            <SectionLabel n="01" title="Sensitivity" />
            <div className="space-y-5">
              <Slider
                label="Baseline cost per contact"
                description="Current fully-loaded human agent cost per call. UK onshore ~£4, offshore BPO ~£0.50, fully automated ~£0.01. The model compares AI TCO against this baseline."
                min={0.01}
                max={10}
                step={0.01}
                value={scenario.baseline.simpleCurrentCostPerContact}
                onChange={(v) =>
                  setScenario((s) => ({
                    ...s,
                    baseline: { ...s.baseline, simpleCurrentCostPerContact: v },
                  }))
                }
                format={(v) => (v < 0.1 ? `£${v.toFixed(2)}` : `£${v.toFixed(1)}`)}
              />
              <Slider
                label="Annual incoming calls"
                description="Total calls handled per year across all channels. Drives every volume-based cost."
                min={1_000_000}
                max={200_000_000}
                step={1_000_000}
                value={scenario.callProfile.annualIncomingCalls}
                onChange={(v) =>
                  setScenario((s) => ({
                    ...s,
                    callProfile: { ...s.callProfile, annualIncomingCalls: v },
                    baseline: { ...s.baseline, currentAnnualCallVolume: v },
                  }))
                }
                format={(v) => num(v)}
              />
              <Slider
                label="Average call duration"
                description="How long the average call lasts, including AI and human legs. Longer calls = more telephony, AI minutes, and storage."
                min={1}
                max={20}
                step={0.5}
                value={scenario.callProfile.averageCallDurationMin}
                onChange={(v) => {
                  const ratio = v / scenario.callProfile.averageCallDurationMin;
                  setCall({
                    averageCallDurationMin: v,
                    aiDurationForResolvedCallMin: scenario.callProfile.aiDurationForResolvedCallMin * ratio,
                    aiDurationBeforeHandoffMin: scenario.callProfile.aiDurationBeforeHandoffMin * ratio,
                    humanDurationAfterHandoffMin: scenario.callProfile.humanDurationAfterHandoffMin * ratio,
                  });
                }}
                format={(v) => `${v} min`}
              />
              <Slider
                label="AI resolution"
                description="% of ALL incoming calls fully resolved by AI end-to-end. 100% adoption is assumed — every call goes through AI first. The rest escalate to human (25–70%) or are abandoned/failed (5% fixed)."
                min={0}
                max={0.95}
                step={0.01}
                value={scenario.outcome.resolutionRate}
                onChange={(v) =>
                  setScenario((s) => ({
                    ...s,
                    outcome: {
                      ...s.outcome,
                      aiAdoptionPercentage: 1,
                      resolutionRate: v,
                      escalationRate: Math.max(0, 1 - v - 0.03 - 0.02),
                    },
                  }))
                }
                format={(v) => pct(v)}
              />
              <Slider
                label="Calls automatically evaluated"
                description="Percentage of AI calls sampled for quality evaluation. Higher = more assurance but more eval LLM tokens and storage cost."
                min={0}
                max={1}
                step={0.01}
                value={scenario.evaluation.autoEvaluatedPercentage}
                onChange={(v) =>
                  setScenario((s) => ({ ...s, evaluation: { ...s.evaluation, autoEvaluatedPercentage: v } }))
                }
                format={(v) => pct(v, v < 0.1 ? 1 : 0)}
              />
              <Slider
                label="Year 1 ramp"
                description="How many months to linearly ramp from 0 to full volume. 0 = instant (100%), 6 = 75% effective vol, 12 = 50% effective vol. Fixed/stepped costs are not scaled."
                min={0}
                max={12}
                step={1}
                value={scenario.callProfile.yearOneRampMonths ?? 0}
                onChange={(v) => setCall({ yearOneRampMonths: v })}
                format={(v) => (v === 0 ? "instant" : `${v} months`)}
              />
              <Slider
                label="EC2 Nitro inference nodes"
                description="Dedicated inference servers for agent orchestration. Set to 0 = auto-scale from concurrency profile (shows computed count). Drag to override."
                min={0}
                max={5000}
                step={1}
                value={
                  components.find((c) => c.id === "ec2-nitro-inference")?.pricing.scaling
                    ?.manualUnits ?? 0
                }
                onChange={(v) =>
                  updateComponent("ec2-nitro-inference", {
                    pricing: {
                      ...components.find((c) => c.id === "ec2-nitro-inference")!.pricing,
                      scaling: {
                        ...components.find((c) => c.id === "ec2-nitro-inference")!.pricing.scaling!,
                        manualUnits: v === 0 ? undefined : v,
                      },
                    },
                  })
                }
                format={(() => {
                  const computed = result.breakdown.lines.find(
                    (l) => l.componentId === "ec2-nitro-inference"
                  )?.usageQuantity ?? 0;
                  return (v: number) =>
                    v > 0
                      ? `${v} nodes (manual)`
                      : `auto (${computed.toLocaleString()} nodes)`;
                })()}
              />
            </div>
          </div>

          <div className="rounded-2xl border hairline bg-panel p-5">
            <SectionLabel n="02" title="Executive metrics" />
            <div className="grid grid-cols-2 gap-2">
              <MiniMetric label="Annual calls" value={num(result.volumes.annualIncomingCalls)} />
              <MiniMetric label="AI calls" value={num(result.volumes.aiCalls)} accent="signal" />
              <MiniMetric label="Resolved" value={num(result.volumes.resolvedCalls)} accent="signal" />
              <MiniMetric label="Human escalations" value={num(result.volumes.escalatedCalls)} accent="violet" />
              <MiniMetric label="TCO /yr" value={gbp(result.breakdown.totalAnnual, { compact: true })} accent="coral" />
              <MiniMetric label="Net benefit" value={gbp(result.roi.netBenefit, { compact: true })} accent={result.roi.netBenefit >= 0 ? "signal" : "coral"} />
              <MiniMetric
                label="Baseline (pre-AI)"
                value={gbp(result.roi.baselineAnnualCost, { compact: true })}
                sub={`£${scenario.baseline.simpleCurrentCostPerContact.toFixed(2)}/call`}
              />
              <MiniMetric label="DR overhead" value={gbp((scenario.drOverheadPct ?? 0) > 0 ? preDRResult.breakdown.totalAnnual * drPct : 0, { compact: true })} accent="amber" />
              <MiniMetric label="ROI" value={pct(result.roi.roiPercentage / 100, 0)} accent={result.roi.roiPercentage >= 0 ? "signal" : "coral"} sub={`payback ${years(result.roi.paybackPeriodYears)}`} />
              <MiniMetric label="Gross savings" value={gbp(result.roi.grossAvoidedCost, { compact: true })} />
              <MiniMetric label="Infrastructure" value={gbp(infraCost(result), { compact: true })} accent="amber" />
              <MiniMetric label="Residual human" value={gbp(categoryCost(result, "HUMAN_ESCALATION"), { compact: true })} accent="violet" />
              <MiniMetric label="Voice platform" value={gbp(categoryCost(result, "VOICE_SERVICE"), { compact: true })} />
              <MiniMetric label="Cost / in call" value={gbp(result.costPerIncomingCall, { decimals: 3 })} />
              <MiniMetric label="Cost / AI minute" value={gbp(result.costPerAiMinute, { decimals: 3 })} accent="signal" />
              <MiniMetric label="Cost / telephony min" value={gbp(result.costPerTelephonyMinute, { decimals: 3 })} />
              <MiniMetric label="Cost / resolved" value={gbp(result.costPerResolvedCall, { decimals: 3 })} accent="signal" />
              <MiniMetric label="Peak concurrency" value={num(result.volumes.peakConcurrentCalls)} accent="amber" />
            </div>
          </div>
        </section>

        {/* Concurrency profile */}
        <section className="mt-8">
          <div className="rounded-2xl border hairline bg-panel p-5">
            <SectionLabel n="CP" title="24-hour concurrency profile" />
            <p className="mb-3 text-xs text-muted">
              Profile is saved with the scenario. Drag bars to shape concurrency throughout the day.
              The peak value feeds into all stepped infrastructure sizing.
            </p>
            <ConcurrencyProfile
              profile={scenario.callProfile.concurrencyProfile}
              onChange={(p) => setCall({ concurrencyProfile: p })}
              steppedComponents={components
                .filter((c) => c.pricing.model === "STEPPED_INFRASTRUCTURE" && c.pricing.scaling && c.enabled)
                .map((c) => ({
                  id: c.id,
                  label: c.service.length > 25 ? c.service.slice(0, 23) + "…" : c.service,
                  capacityPerUnit: c.pricing.scaling!.capacityPerUnit,
                  unitPrice: c.pricing.unitPrice,
                }))}
              onUpdateComponent={(id, cap) =>
                updateComponent(id, {
                  pricing: {
                    ...components.find((c) => c.id === id)!.pricing,
                    scaling: {
                      ...components.find((c) => c.id === id)!.pricing.scaling!,
                      capacityPerUnit: cap,
                    },
                  },
                })
              }
            />
          </div>
        </section>

        {/* Growth curves */}
        <section className="mt-8">
          <div className="rounded-2xl border hairline bg-panel p-5">
            <SectionLabel n="GR" title="Multi-year projection" />
            <p className="mb-3 text-xs text-muted">
              Compound annual growth applied to year-1 baseline. Projects TCO, net benefit, and cumulative
              savings over multiple years.
            </p>
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1fr]">
              <div className="space-y-4">
                <Slider
                  label="Volume growth"
                  description={`${growth.volumePct}% more calls each year`}
                  min={0} max={50} step={1}
                  value={growth.volumePct}
                  onChange={(v) => setGrowth((g) => ({ ...g, volumePct: v }))}
                  format={(v) => `${v}%`}
                />
                <Slider
                  label="Resolution improvement"
                  description={`+${growth.resolutionPts} percentage points per year`}
                  min={0} max={10} step={0.5}
                  value={growth.resolutionPts}
                  onChange={(v) => setGrowth((g) => ({ ...g, resolutionPts: v }))}
                  format={(v) => `+${v}pp`}
                />
                <Slider
                  label="Baseline cost inflation"
                  description={`Human cost per contact inflates ${growth.inflationPct}% per year`}
                  min={0} max={10} step={0.5}
                  value={growth.inflationPct}
                  onChange={(v) => setGrowth((g) => ({ ...g, inflationPct: v }))}
                  format={(v) => `${v}%`}
                />
                <Slider
                  label="Projection years"
                  description={`Show ${growth.years} years of projections`}
                  min={1} max={5} step={1}
                  value={growth.years}
                  onChange={(v) => setGrowth((g) => ({ ...g, years: v }))}
                  format={(v) => `${v}yr`}
                />
              </div>
              <div className="overflow-hidden rounded-xl border hairline">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b hairline bg-panel2 text-left">
                      <th className="px-3 py-2 eyebrow font-normal">Year</th>
                      <th className="px-3 py-2 eyebrow font-normal text-right">Volume</th>
                      <th className="px-3 py-2 eyebrow font-normal text-right">Resolution</th>
                      <th className="px-3 py-2 eyebrow font-normal text-right">Baseline</th>
                      <th className="px-3 py-2 eyebrow font-normal text-right">TCO</th>
                      <th className="px-3 py-2 eyebrow font-normal text-right">Net benefit</th>
                      <th className="px-3 py-2 eyebrow font-normal text-right">Cumulative</th>
                    </tr>
                  </thead>
                  <tbody>
                    {projection.map((row, i) => (
                      <tr key={row.year} className={`border-b hairline ${i === 0 ? "bg-signal/5" : ""}`}>
                        <td className="px-3 py-2 figure text-xs text-ink">Year {row.year}</td>
                        <td className="px-3 py-2 text-right figure text-xs text-muted">{num(row.volume)}</td>
                        <td className="px-3 py-2 text-right figure text-xs text-muted">{pct(row.resolution)}</td>
                        <td className="px-3 py-2 text-right figure text-xs text-muted">£{row.baselineCost.toFixed(2)}</td>
                        <td className="px-3 py-2 text-right figure text-xs text-ink">{gbp(row.tco, { compact: true })}</td>
                        <td className="px-3 py-2 text-right figure text-xs text-signal">{gbp(row.netBenefit, { compact: true })}</td>
                        <td className="px-3 py-2 text-right figure text-xs text-signal">{gbp(row.cumulativeNetBenefit, { compact: true })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>

        {/* Cost waterfall */}
        <section className="mt-6">
          <div className="rounded-2xl border hairline bg-panel p-5">
            <div className="mb-4 flex items-center justify-between">
              <SectionLabel n="03" title="Cost waterfall" inline />
              <div className="flex gap-1 rounded-lg border hairline bg-panel2 p-0.5">
                {(["total", "perCall"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setWaterfallMode(m)}
                    className={`rounded-md px-3 py-1 text-xs figure transition-colors ${
                      waterfallMode === m ? "bg-signal text-ground" : "text-muted hover:text-ink"
                    }`}
                  >
                    {m === "total" ? "£ total" : "£ / call"}
                  </button>
                ))}
              </div>
            </div>
            <CostWaterfall
              breakdown={result.breakdown}
              annualCalls={result.volumes.annualIncomingCalls}
              mode={waterfallMode}
            />
          </div>
        </section>

        {/* Fixed/variable + marginal */}
        <section className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border hairline bg-panel p-5">
            <SectionLabel n="04" title="Fixed vs variable" />
            <FixedVariableSplit breakdown={result.breakdown} />
          </div>
          <div className="rounded-2xl border hairline bg-panel p-5">
            <SectionLabel n="05" title="Marginal cost" />
            <p className="mb-4 text-xs text-muted">
              Cost of the next calls, computed by re-running the model at higher volume — not by dividing
              TCO by calls. Fixed and stepped infrastructure are excluded until a capacity step is crossed.
            </p>
            <div className="grid grid-cols-3 gap-3">
              <MarginalTile label="Next 1 call" value={gbp(result.marginal.nextOneCall, { decimals: 4 })} />
              <MarginalTile label="Next 1,000" value={gbp(result.marginal.nextThousandCalls, { compact: true })} />
              <MarginalTile label="Next 1,000,000" value={gbp(result.marginal.nextMillionCalls, { compact: true })} />
            </div>
            <div className="mt-4 rounded-lg border hairline bg-panel2 p-3 text-xs text-muted">
              Average cost / incoming call is{" "}
              <span className="figure text-ink">{gbp(result.costPerIncomingCall, { decimals: 3 })}</span>. Marginal
              sits below average because fixed costs are already absorbed.
            </div>
          </div>
        </section>

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
          <SectionLabel n="06" title="Scenario comparison" />
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
            <SectionLabel n="07" title="Cost breakdown & audit" inline />
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

        {/* Cost flow diagram */}
        <section className="mt-10">
          <SectionLabel n="08" title="Cost flow" />
          <p className="mb-4 max-w-3xl text-sm text-muted">
            How cost flows from usage drivers through individual components into cost categories.
            Hover any node or link to highlight. Changes dynamically with every parameter.
          </p>
          <div className="rounded-2xl border hairline bg-panel p-4">
            <CostFlowDiagram breakdown={result.breakdown} />
          </div>
        </section>

        {/* Network architecture diagram */}
        <section className="mt-10">
          <SectionLabel n="09" title="Network architecture" />
          <p className="mb-4 max-w-3xl text-sm text-muted">
            Infrastructure topology — how services connect and where cost sits. Dashed arrows show the
            call/data flow path. Hover any node to see its annual cost.
          </p>
          <div className="rounded-2xl border hairline bg-panel p-4">
            <NetworkDiagram breakdown={result.breakdown} />
          </div>
        </section>

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
  const benefit = result.roi.netBenefit;
  const positive = benefit >= 0;
  return (
    <div className="relative overflow-hidden rounded-2xl border hairline bg-panel p-6 grid-noise">
      <div className="eyebrow">Modelled outcome · {scenario.name}</div>
      <div className="mt-3 flex items-baseline gap-3">
        <span className={`figure text-figure-xl ${positive ? "text-signal" : "text-coral"}`}>
          {gbp(benefit, { compact: true })}
        </span>
        <span className="text-sm text-muted">net benefit / yr</span>
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

function MarginalTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border hairline bg-panel2 px-3 py-3">
      <div className="eyebrow mb-2">{label}</div>
      <div className="figure text-base text-signal">{value}</div>
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
    ["Baseline cost/call", `£${scenario.baseline.simpleCurrentCostPerContact.toFixed(2)}`],
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
  // Multi-year projection
  if (projection.length > 0) {
    parts.push(toCsv(["Year", "Volume", "Resolution", "Baseline", "TCO", "Net Benefit", "Cumulative"],
      projection.map((r: any) => [String(r.year), String(r.volume), `${(r.resolution*100).toFixed(0)}%`, `£${r.baselineCost.toFixed(2)}`, `£${r.tco.toFixed(2)}`, `£${r.netBenefit.toFixed(2)}`, `£${r.cumulativeNetBenefit.toFixed(2)}`])
    ));
  }
  // Portfolio
  if (portfolio.length > 0 && portfolioProjections.length > 0) {
    parts.push(toCsv(["Customer", "Year", "Volume", "TCO"],
      portfolioProjections.flatMap((p: any) => p.customers.map((c: any) => [c.customer.name, String(p.year), String(c.volume), `£${c.tco.toFixed(2)}`]))
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

function categoryCost(r: ReturnType<typeof computeScenarioResult>, cat: string): number {
  return r.breakdown.byCategory.find((c) => c.category === cat)?.annualCost ?? 0;
}

function infraCost(r: ReturnType<typeof computeScenarioResult>): number {
  const infraCats = [
    "TELEPHONY_AND_INTEGRATION",
    "AI_AND_COMPUTE",
    "KNOWLEDGE",
    "AUDIO_TRANSCRIPT_STORAGE",
    "OPERATIONS_AND_OBSERVABILITY",
    "DATA_AND_ANALYTICS",
  ];
  return r.breakdown.byCategory
    .filter((c) => infraCats.includes(c.category))
    .reduce((s, c) => s + c.annualCost, 0);
}
