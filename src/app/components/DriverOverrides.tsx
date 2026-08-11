"use client";

import React, { useState, useCallback } from "react";
import type { UsageDriver } from "../../domain/types";

const DRIVER_LABELS: Partial<Record<UsageDriver, string>> = {
  ANNUAL_CALLS: "Annual calls",
  AI_CALLS: "AI calls",
  RESOLVED_CALLS: "Resolved calls",
  ESCALATED_CALLS: "Escalated calls",
  AI_MINUTES: "AI minutes",
  AI_SECONDS: "AI seconds",
  HUMAN_MINUTES: "Human minutes",
  TELEPHONY_MINUTES: "Telephony minutes",
  SESSIONS: "Sessions",
  INPUT_TOKENS: "Input tokens",
  OUTPUT_TOKENS: "Output tokens",
  TOTAL_TOKENS: "Total tokens",
  REASONING_TOKENS: "Reasoning tokens",
  LLM_REQUESTS: "LLM requests",
  TOOL_CALLS: "Tool calls",
  KNOWLEDGE_SEARCHES: "Knowledge searches",
  API_CALLS: "API calls",
  AUDIO_GB: "Audio GB",
  TRANSCRIPT_GB: "Transcript GB",
  LOG_GB: "Log GB",
  TRACE_GB: "Trace GB",
  STORED_GB_MONTHS: "Stored GB-months",
  EGRESS_GB: "Egress GB",
  EVALUATED_CALLS: "Evaluated calls",
  DEEP_EVALUATED_CALLS: "Deep evaluated calls",
  EVALUATION_TOKENS: "Evaluation tokens",
  PEAK_CONCURRENCY: "Peak concurrency",
  COMPUTE_HOURS: "Compute hours",
  PROVISIONED_MONTHS: "Provisioned months",
};

const DRIVER_FORMATTERS: Partial<Record<UsageDriver, (v: number) => string>> = {
  INPUT_TOKENS: (v) => v.toLocaleString("en-GB"),
  OUTPUT_TOKENS: (v) => v.toLocaleString("en-GB"),
  TOTAL_TOKENS: (v) => v.toLocaleString("en-GB"),
  REASONING_TOKENS: (v) => v.toLocaleString("en-GB"),
  EVALUATION_TOKENS: (v) => v.toLocaleString("en-GB"),
};

function fmtDriver(key: UsageDriver, value: number): string {
  const formatter = DRIVER_FORMATTERS[key];
  if (formatter) return formatter(value);
  if (value >= 1_000_000) return (value / 1_000_000).toFixed(2) + "M";
  if (value >= 1_000) return (value / 1_000).toFixed(1) + "K";
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

export function DriverOverrides({
  drivers,
  overrides,
  onOverride,
  onClear,
  onClearAll,
}: {
  drivers: Record<UsageDriver, number>;
  overrides: Partial<Record<UsageDriver, number>>;
  onOverride: (driver: UsageDriver, value: number) => void;
  onClear: (driver: UsageDriver) => void;
  onClearAll: () => void;
}) {
  const [open, setOpen] = useState(false);
  const hasOverrides = Object.keys(overrides).length > 0;

  const entries = Object.entries(drivers)
    .filter(([key]) => key !== "NONE")
    .sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="rounded-2xl border hairline bg-panel p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="figure text-xs text-amber">O</span>
          <span className="h-px w-5 bg-line" />
          <h2 className="text-sm font-semibold tracking-tight text-ink">Usage driver overrides</h2>
          {hasOverrides && (
            <span className="figure rounded-full bg-amber/20 px-1.5 py-0.5 text-[10px] text-amber">
              {Object.keys(overrides).length}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          {hasOverrides && (
            <button
              onClick={onClearAll}
              className="figure text-[10px] text-faint hover:text-coral"
            >
              clear all
            </button>
          )}
          <button
            onClick={() => setOpen((v) => !v)}
            className="figure rounded-lg border hairline bg-panel2 px-3 py-1 text-xs text-muted hover:text-ink"
          >
            {open ? "hide" : "show"}
          </button>
        </div>
      </div>
      <p className="mb-3 text-xs text-muted">
        Override computed driver values. Overridden values are pinned and won't recalculate when
        scenario parameters change.
      </p>
      {open && (
        <div className="grid grid-cols-2 gap-1 md:grid-cols-3 lg:grid-cols-4">
          {entries.map(([key, value]) => {
            const driver = key as UsageDriver;
            const overridden = driver in overrides;
            return (
              <DriverValue
                key={key}
                driver={driver}
                value={overridden ? overrides[driver]! : value}
                overridden={overridden}
                onOverride={onOverride}
                onClear={onClear}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function DriverValue({
  driver,
  value,
  overridden,
  onOverride,
  onClear,
}: {
  driver: UsageDriver;
  value: number;
  overridden: boolean;
  onOverride: (d: UsageDriver, v: number) => void;
  onClear: (d: UsageDriver) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));

  const commit = useCallback(() => {
    const n = Number(draft);
    if (!isNaN(n)) onOverride(driver, n);
    setEditing(false);
  }, [draft, driver, onOverride]);

  const startEdit = useCallback(() => {
    setDraft(String(value));
    setEditing(true);
  }, [value]);

  return (
    <div
      className={`rounded-lg border px-2.5 py-2 ${
        overridden ? "border-amber/40 bg-amber/[0.04]" : "hairline bg-panel2"
      }`}
    >
      <div className="mb-0.5 flex items-center justify-between">
        <span className="text-[10px] text-faint">{DRIVER_LABELS[driver] ?? driver}</span>
        {overridden && (
          <button
            type="button"
            onClick={() => onClear(driver)}
            className="text-[10px] text-amber hover:text-coral"
            title="Clear override"
          >
            ×
          </button>
        )}
      </div>
      {editing ? (
        <input
          type="number"
          value={draft}
          step={driver.includes("TOKEN") ? 1000000 : 1}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              setDraft(String(value));
              setEditing(false);
            }
          }}
          className={`figure w-full rounded border bg-panel px-1.5 py-0.5 text-xs outline-none ${
            overridden ? "border-amber text-amber" : "border-signalDim text-ink"
          }`}
          autoFocus
        />
      ) : (
        <button
          type="button"
          onClick={startEdit}
          className={`figure text-xs cursor-pointer hover:opacity-70 ${
            overridden ? "text-amber" : "text-ink"
          }`}
          title="Click to override"
        >
          {fmtDriver(driver, value)}
        </button>
      )}
    </div>
  );
}
