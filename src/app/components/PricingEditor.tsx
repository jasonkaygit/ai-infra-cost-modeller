"use client";

import React, { useState, useCallback } from "react";
import type { PricingRule, PricingTier } from "../../domain/types";

/**
 * Model-aware inline editor for a PricingRule.
 * Renders only the fields relevant to the rule's pricing model.
 */
export function PricingEditor({
  pricing,
  onChange,
}: {
  pricing: PricingRule;
  onChange: (p: PricingRule) => void;
}) {
  const model = pricing.model;

  return (
    <div className="mt-3 space-y-2 rounded-lg border hairline bg-panel2 p-3">
      <div className="eyebrow text-[10px]">Pricing rule · {model.replace(/_/g, " ")}</div>

      {/* Simple single-price models */}
      {isSimpleModel(model) && (
        <EditableField
          label="Unit price"
          value={pricing.unitPrice}
          onChange={(v) => onChange({ ...pricing, unitPrice: v })}
          prefix="£"
          step={model === "PER_1000000_TOKENS" ? 0.01 : undefined}
        />
      )}

      {/* Per-1000 models */}
      {isPer1000Model(model) && (
        <EditableField
          label="Unit price (per 1,000)"
          value={pricing.unitPrice}
          onChange={(v) => onChange({ ...pricing, unitPrice: v })}
          prefix="£"
          step={0.0001}
        />
      )}

      {/* Input/Output token split */}
      {model === "INPUT_OUTPUT_TOKENS" && (
        <>
          <EditableField
            label="Input price / 1M tokens"
            value={pricing.inputUnitPrice ?? 0}
            onChange={(v) => onChange({ ...pricing, inputUnitPrice: v })}
            prefix="£"
            step={0.01}
          />
          <EditableField
            label="Output price / 1M tokens"
            value={pricing.outputUnitPrice ?? 0}
            onChange={(v) => onChange({ ...pricing, outputUnitPrice: v })}
            prefix="£"
            step={0.01}
          />
        </>
      )}

      {/* Stepped infrastructure */}
      {model === "STEPPED_INFRASTRUCTURE" && pricing.scaling && (
        <>
          <EditableField
            label="Unit price / month"
            value={pricing.unitPrice}
            onChange={(v) => onChange({ ...pricing, unitPrice: v })}
            prefix="£"
          />
          <EditableField
            label="Capacity per unit"
            value={pricing.scaling.capacityPerUnit}
            onChange={(v) =>
              onChange({
                ...pricing,
                scaling: { ...pricing.scaling!, capacityPerUnit: v },
              })
            }
            suffix={pricing.scaling.capacityDriver.replace(/_/g, " ").toLowerCase()}
          />
          <EditableField
            label="Min units"
            value={pricing.scaling.minUnits}
            onChange={(v) =>
              onChange({
                ...pricing,
                scaling: { ...pricing.scaling!, minUnits: v },
              })
            }
          />
        </>
      )}

      {/* Tiered models */}
      {(model === "TIERED_VOLUME" || model === "TIERED_DURATION") && (
        <TierEditor
          tiers={pricing.tiers ?? []}
          onChange={(tiers) => onChange({ ...pricing, tiers })}
        />
      )}

      {/* Common optional fields */}
      {pricing.minMonthlyCommitment != null && (
        <EditableField
          label="Min monthly commitment"
          value={pricing.minMonthlyCommitment}
          onChange={(v) => onChange({ ...pricing, minMonthlyCommitment: v })}
          prefix="£"
          allowClear
          onClear={() => onChange({ ...pricing, minMonthlyCommitment: undefined })}
        />
      )}

      {pricing.bundledAllowance != null && (
        <EditableField
          label="Bundled allowance (per month)"
          value={pricing.bundledAllowance}
          onChange={(v) => onChange({ ...pricing, bundledAllowance: v })}
          allowClear
          onClear={() => onChange({ ...pricing, bundledAllowance: undefined })}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ helpers */

function isSimpleModel(m: PricingRule["model"]): boolean {
  return ![
    "INPUT_OUTPUT_TOKENS",
    "PER_1000_REQUESTS",
    "PER_1000_TOKENS",
    "PER_1000000_TOKENS",
    "TIERED_VOLUME",
    "TIERED_DURATION",
    "STEPPED_INFRASTRUCTURE",
  ].includes(m);
}

function isPer1000Model(m: PricingRule["model"]): boolean {
  return m === "PER_1000_REQUESTS" || m === "PER_1000_TOKENS" || m === "PER_1000000_TOKENS";
}

/* ------------------------------------------------------------------ sub-components */

function EditableField({
  label,
  value,
  onChange,
  prefix,
  suffix,
  step,
  allowClear,
  onClear,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  prefix?: string;
  suffix?: string;
  step?: number;
  allowClear?: boolean;
  onClear?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));

  const commit = useCallback(() => {
    const n = Number(draft);
    if (!isNaN(n)) onChange(n);
    setEditing(false);
  }, [draft, onChange]);

  const startEdit = useCallback(() => {
    setDraft(String(value));
    setEditing(true);
  }, [value]);

  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-muted shrink-0">{label}</span>
      <div className="flex items-center gap-1">
        {editing ? (
          <input
            type="number"
            value={draft}
            step={step}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") {
                setDraft(String(value));
                setEditing(false);
              }
            }}
            className="figure w-28 rounded border border-signalDim bg-panel px-2 py-0.5 text-xs text-ink outline-none"
            autoFocus
          />
        ) : (
          <button
            type="button"
            onClick={startEdit}
            className="group flex items-center gap-1 figure text-xs text-ink cursor-pointer hover:text-signal transition-colors"
            title="Click to edit value"
          >
            <span>
              {prefix}
              {value.toLocaleString("en-GB")}
              {suffix ? ` ${suffix}` : ""}
            </span>
            <span className="text-[10px] text-faint opacity-0 group-hover:opacity-100 transition-opacity">
              ✎
            </span>
          </button>
        )}
        {allowClear && onClear && (
          <button
            type="button"
            onClick={onClear}
            className="text-[10px] text-faint hover:text-coral"
            title="Remove"
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}

function TierEditor({
  tiers,
  onChange,
}: {
  tiers: PricingTier[];
  onChange: (t: PricingTier[]) => void;
}) {
  const updateTier = (i: number, patch: Partial<PricingTier>) => {
    const next = [...tiers];
    next[i] = { ...next[i], ...patch };
    onChange(next);
  };

  const removeTier = (i: number) => {
    onChange(tiers.filter((_, idx) => idx !== i));
  };

  const addTier = () => {
    const last = tiers[tiers.length - 1];
    onChange([
      ...tiers.slice(0, -1),
      { ...last, upTo: (last?.upTo ?? 0) + 1000000 },
      { upTo: null, unitPrice: (last?.unitPrice ?? 0) * 0.8 },
    ]);
  };

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs text-muted">Tiers</span>
        <button
          type="button"
          onClick={addTier}
          className="text-[10px] text-signal hover:text-signal/80"
        >
          + add tier
        </button>
      </div>
      {tiers.map((tier, i) => (
        <div key={i} className="mb-1 flex items-center gap-1.5">
          <span className="text-[10px] text-faint w-6">T{i + 1}</span>
          <input
            type="number"
            value={tier.upTo ?? ""}
            placeholder="∞"
            step={100000}
            onChange={(e) =>
              updateTier(i, {
                upTo: e.target.value === "" ? null : Number(e.target.value),
              })
            }
            className="figure w-20 rounded border hairline bg-panel px-1.5 py-0.5 text-[11px] text-ink outline-none focus:border-signalDim"
          />
          <span className="text-[10px] text-faint">up to</span>
          <input
            type="number"
            value={tier.unitPrice}
            step={0.001}
            onChange={(e) => updateTier(i, { unitPrice: Number(e.target.value) })}
            className="figure w-20 rounded border hairline bg-panel px-1.5 py-0.5 text-[11px] text-ink outline-none focus:border-signalDim"
          />
          <span className="text-[10px] text-faint">/unit</span>
          {tiers.length > 1 && (
            <button
              type="button"
              onClick={() => removeTier(i)}
              className="text-[10px] text-faint hover:text-coral"
            >
              ×
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
