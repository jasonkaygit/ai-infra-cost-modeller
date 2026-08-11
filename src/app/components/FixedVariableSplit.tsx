"use client";

import React from "react";
import type { CostBreakdown } from "../../domain/types";
import { gbp, pct } from "../format";

const CLASSES: { key: keyof CostBreakdown; label: string; color: string }[] = [
  { key: "variableAnnual", label: "Variable", color: "#38E1B0" },
  { key: "semiVariableAnnual", label: "Semi-variable", color: "#5CD0E8" },
  { key: "steppedAnnual", label: "Stepped infra", color: "#E9B949" },
  { key: "fixedAnnual", label: "Fixed", color: "#8A97A6" },
  { key: "oneOffAnnual", label: "One-off", color: "#E06C75" },
];

export function FixedVariableSplit({ breakdown }: { breakdown: CostBreakdown }) {
  const total = breakdown.totalAnnual || 1;
  const rows = CLASSES.map((c) => ({
    ...c,
    value: (breakdown[c.key] as number) || 0,
  }));

  return (
    <div>
      <div className="flex h-4 w-full overflow-hidden rounded-full bg-panel2 hairline border">
        {rows.map((r) =>
          r.value > 0 ? (
            <div
              key={r.label}
              style={{ width: `${(r.value / total) * 100}%`, background: r.color }}
              title={`${r.label}: ${gbp(r.value, { compact: true })}`}
            />
          ) : null
        )}
      </div>
      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: r.color }} />
              <span className="text-muted">{r.label}</span>
            </div>
            <div className="figure text-ink">
              {gbp(r.value, { compact: true })}
              <span className="ml-2 text-faint">{pct(r.value / total)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
