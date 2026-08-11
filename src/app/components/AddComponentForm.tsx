"use client";

import React, { useState, useCallback } from "react";
import type {
  CostComponent,
  CostCategory,
  PricingModel,
  UsageDriver,
  FixedVariableClass,
  Environment,
  Frequency,
  PricingRule,
} from "../../domain/types";
import { COST_CATEGORY_LABELS } from "../../domain/types";
import { PricingEditor } from "./PricingEditor";

const CATEGORIES: CostCategory[] = [
  "VOICE_SERVICE",
  "AI_AND_COMPUTE",
  "TELEPHONY_AND_INTEGRATION",
  "KNOWLEDGE",
  "AUDIO_TRANSCRIPT_STORAGE",
  "EVALUATION_AND_ASSURANCE",
  "OPERATIONS_AND_OBSERVABILITY",
  "DATA_AND_ANALYTICS",
  "HUMAN_ESCALATION",
  "FIXED_OPERATIONAL",
];

const MODELS: PricingModel[] = [
  "FIXED_MONTHLY",
  "FIXED_ANNUAL",
  "ONE_OFF",
  "PER_CALL",
  "PER_SESSION",
  "PER_MINUTE",
  "PER_SECOND",
  "PER_REQUEST",
  "PER_API_CALL",
  "PER_1000_REQUESTS",
  "PER_1000_TOKENS",
  "PER_1000000_TOKENS",
  "PER_TOKEN",
  "PER_GB",
  "PER_GB_MONTH",
  "PER_GB_TRANSFERRED",
  "INPUT_OUTPUT_TOKENS",
  "HOURLY_COMPUTE",
  "PROVISIONED_INSTANCE",
  "CONCURRENT_SESSION",
  "TIERED_DURATION",
  "TIERED_VOLUME",
  "MIN_MONTHLY_COMMITMENT",
  "BUNDLED_ALLOWANCE",
  "STEPPED_INFRASTRUCTURE",
  "PERCENT_OF_TRAFFIC",
  "SAMPLED_ACTIVITY",
];

const DRIVERS: UsageDriver[] = [
  "ANNUAL_CALLS",
  "AI_CALLS",
  "RESOLVED_CALLS",
  "ESCALATED_CALLS",
  "AI_MINUTES",
  "AI_SECONDS",
  "HUMAN_MINUTES",
  "TELEPHONY_MINUTES",
  "SESSIONS",
  "INPUT_TOKENS",
  "OUTPUT_TOKENS",
  "TOTAL_TOKENS",
  "REASONING_TOKENS",
  "LLM_REQUESTS",
  "TOOL_CALLS",
  "KNOWLEDGE_SEARCHES",
  "API_CALLS",
  "AUDIO_GB",
  "TRANSCRIPT_GB",
  "LOG_GB",
  "TRACE_GB",
  "STORED_GB_MONTHS",
  "EGRESS_GB",
  "EVALUATED_CALLS",
  "DEEP_EVALUATED_CALLS",
  "EVALUATION_TOKENS",
  "PEAK_CONCURRENCY",
  "COMPUTE_HOURS",
  "PROVISIONED_MONTHS",
  "NONE",
];

const CLASSIFICATIONS: FixedVariableClass[] = [
  "VARIABLE",
  "SEMI_VARIABLE",
  "STEPPED",
  "FIXED",
  "ONE_OFF",
];

const ENVIRONMENTS: Environment[] = ["PROD", "NON_PROD", "SHARED"];
const FREQUENCIES: Frequency[] = ["MONTHLY", "ANNUAL", "ONE_OFF"];

function defaultPricing(model: PricingModel): PricingRule {
  const base: PricingRule = {
    model,
    unitPrice: 0,
    currency: "GBP",
    pricingUnit: "",
    ...(model === "INPUT_OUTPUT_TOKENS" ? { inputUnitPrice: 0, outputUnitPrice: 0 } : {}),
    ...(model === "TIERED_VOLUME" || model === "TIERED_DURATION"
      ? { tiers: [{ upTo: null as number | null, unitPrice: 0 }] }
      : {}),
    ...(model === "STEPPED_INFRASTRUCTURE"
      ? {
          scaling: {
            capacityDriver: "PEAK_CONCURRENCY" as UsageDriver,
            capacityPerUnit: 100,
            minUnits: 1,
            maxUnits: null as number | null,
          },
        }
      : {}),
  };
  return base;
}

let idCounter = Date.now();

export function AddComponentForm({
  onAdd,
  onCancel,
}: {
  onAdd: (c: CostComponent) => void;
  onCancel: () => void;
}) {
  const [model, setModel] = useState<PricingModel>("FIXED_MONTHLY");
  const [pricing, setPricing] = useState<PricingRule>(() => defaultPricing("FIXED_MONTHLY"));
  const [category, setCategory] = useState<CostCategory>("AI_AND_COMPUTE");
  const [provider, setProvider] = useState("");
  const [service, setService] = useState("");
  const [description, setDescription] = useState("");
  const [usageDriver, setUsageDriver] = useState<UsageDriver>("NONE");
  const [classification, setClassification] = useState<FixedVariableClass>("FIXED");
  const [environment, setEnvironment] = useState<Environment>("PROD");
  const [frequency, setFrequency] = useState<Frequency>("MONTHLY");
  const [assumptions, setAssumptions] = useState("");

  const handleModelChange = useCallback(
    (m: PricingModel) => {
      setModel(m);
      setPricing(defaultPricing(m));
    },
    []
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!provider.trim() || !service.trim()) return;
      const id = `custom-${++idCounter}`;
      onAdd({
        id,
        category,
        provider: provider.trim(),
        service: service.trim(),
        description: description.trim() || service.trim(),
        usageDriver,
        classification,
        environment,
        frequency,
        pricing,
        assumptions,
        enabled: true,
        sampleData: true,
      });
    },
    [
      category, provider, service, description, usageDriver,
      classification, environment, frequency, pricing, assumptions, onAdd,
    ]
  );

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-xl border border-signalDim bg-panel p-5"
    >
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink">Add cost component</h3>
        <button
          type="button"
          onClick={onCancel}
          className="figure text-xs text-faint hover:text-coral"
        >
          cancel
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {/* Provider & Service */}
        <Field label="Provider">
          <input
            type="text"
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            placeholder="e.g. AWS, Internal"
            className="input"
            required
          />
        </Field>
        <Field label="Service name">
          <input
            type="text"
            value={service}
            onChange={(e) => setService(e.target.value)}
            placeholder="e.g. Bedrock LLM inference"
            className="input"
            required
          />
        </Field>

        {/* Category */}
        <Field label="Category">
          <select value={category} onChange={(e) => setCategory(e.target.value as CostCategory)} className="input">
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{COST_CATEGORY_LABELS[c]}</option>
            ))}
          </select>
        </Field>

        {/* Driver */}
        <Field label="Usage driver">
          <select value={usageDriver} onChange={(e) => setUsageDriver(e.target.value as UsageDriver)} className="input">
            {DRIVERS.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </Field>

        {/* Classification */}
        <Field label="Classification">
          <select value={classification} onChange={(e) => setClassification(e.target.value as FixedVariableClass)} className="input">
            {CLASSIFICATIONS.map((c) => (
              <option key={c} value={c}>{c.replace("_", "-")}</option>
            ))}
          </select>
        </Field>

        {/* Environment */}
        <Field label="Environment">
          <select value={environment} onChange={(e) => setEnvironment(e.target.value as Environment)} className="input">
            {ENVIRONMENTS.map((env) => (
              <option key={env} value={env}>{env.replace("_", " ")}</option>
            ))}
          </select>
        </Field>

        {/* Frequency */}
        <Field label="Frequency">
          <select value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency)} className="input">
            {FREQUENCIES.map((f) => (
              <option key={f} value={f}>{f.replace("_", " ")}</option>
            ))}
          </select>
        </Field>

        {/* Description */}
        <Field label="Description" full>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What this component covers"
            className="input"
          />
        </Field>

        {/* Assumptions */}
        <Field label="Assumptions" full>
          <input
            type="text"
            value={assumptions}
            onChange={(e) => setAssumptions(e.target.value)}
            placeholder="e.g. SAMPLE. Per-1M token pricing."
            className="input"
          />
        </Field>
      </div>

      {/* Pricing */}
      <div className="mt-4">
        <label className="mb-1.5 block text-xs text-muted">Pricing model</label>
        <select
          value={model}
          onChange={(e) => handleModelChange(e.target.value as PricingModel)}
          className="input mb-3"
        >
          {MODELS.map((m) => (
            <option key={m} value={m}>{m.replace(/_/g, " ")}</option>
          ))}
        </select>
        <PricingEditor pricing={pricing} onChange={setPricing} />
      </div>

      <button
        type="submit"
        disabled={!provider.trim() || !service.trim()}
        className="mt-4 figure rounded-lg bg-signal px-4 py-2 text-sm font-medium text-ground disabled:opacity-30 hover:bg-signal/90"
      >
        Add component
      </button>
    </form>
  );
}

function Field({
  label,
  children,
  full,
}: {
  label: string;
  children: React.ReactNode;
  full?: boolean;
}) {
  return (
    <div className={full ? "md:col-span-2" : ""}>
      <label className="mb-1 block text-xs text-muted">{label}</label>
      {children}
    </div>
  );
}
