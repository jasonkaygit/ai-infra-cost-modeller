"use client";

import React, { useMemo, useState } from "react";
import type { CostBreakdown, CostCategory } from "../../domain/types";
import { COST_CATEGORY_LABELS } from "../../domain/types";
import { gbp } from "../format";

const CAT_COLORS: Record<string, string> = {
  VOICE_SERVICE: "#38E1B0",
  AI_AND_COMPUTE: "#5CD0E8",
  TELEPHONY_AND_INTEGRATION: "#8B9DCC",
  KNOWLEDGE: "#C4A6FF",
  AUDIO_TRANSCRIPT_STORAGE: "#FFB347",
  EVALUATION_AND_ASSURANCE: "#FF6B8A",
  OPERATIONS_AND_OBSERVABILITY: "#F0E68C",
  DATA_AND_ANALYTICS: "#FF9F7B",
  HUMAN_ESCALATION: "#C084FC",
  FIXED_OPERATIONAL: "#94A3B8",
};

const TOP_N = 12; // show top N components, aggregate rest

export function CostFlowDiagram({ breakdown }: { breakdown: CostBreakdown }) {
  const [hoveredCat, setHoveredCat] = useState<string | null>(null);

  const { categories, components, total } = useMemo(() => {
    const lines = breakdown.lines.filter((l) => l.annualCost > 0);
    const total = breakdown.totalAnnual;

    // Aggregate by category
    const catMap = new Map<CostCategory, { cost: number; lines: typeof lines }>();
    for (const l of lines) {
      const entry = catMap.get(l.category) ?? { cost: 0, lines: [] };
      entry.cost += l.annualCost;
      entry.lines.push(l);
      catMap.set(l.category, entry);
    }

    const categories = [...catMap.entries()]
      .sort((a, b) => b[1].cost - a[1].cost)
      .map(([cat, { cost }]) => ({
        id: cat,
        label: COST_CATEGORY_LABELS[cat] ?? cat,
        cost,
        pct: ((cost / total) * 100).toFixed(1),
        color: CAT_COLORS[cat] ?? "#555",
      }));

    // All components sorted by cost, top-N explicit, rest grouped
    const sorted = [...lines].sort((a, b) => b.annualCost - a.annualCost);
    const top = sorted.slice(0, TOP_N);
    const restCost = sorted.slice(TOP_N).reduce((s, l) => s + l.annualCost, 0);

    const components = top.map((l) => ({
      id: l.componentId,
      label: l.service,
      provider: l.provider,
      category: l.category,
      cost: l.annualCost,
      pct: ((l.annualCost / total) * 100).toFixed(1),
      color: CAT_COLORS[l.category] ?? "#555",
    }));

    if (restCost > 0 && sorted.length > TOP_N) {
      components.push({
        id: "other",
        label: `${sorted.length - TOP_N} other components`,
        provider: "",
        category: "FIXED_OPERATIONAL" as CostCategory,
        cost: restCost,
        pct: ((restCost / total) * 100).toFixed(1),
        color: "#555",
      });
    }

    return { categories, components, total };
  }, [breakdown]);

  if (components.length === 0) return null;

  return (
    <div className="space-y-8">
      {/* Category bar */}
      <div>
        <div className="eyebrow mb-3 text-[10px]">Cost by category</div>
        <div className="flex h-10 w-full overflow-hidden rounded-lg">
          {categories.map((cat) => (
            <div
              key={cat.id}
              style={{
                width: `${Math.max(0.5, (cat.cost / total) * 100)}%`,
                backgroundColor: cat.color,
              }}
              onMouseEnter={() => setHoveredCat(cat.id)}
              onMouseLeave={() => setHoveredCat(null)}
              className="relative cursor-pointer transition-opacity hover:opacity-80"
              title={`${cat.label}: ${gbp(cat.cost, { compact: true })} (${cat.pct}%)`}
            />
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
          {categories.map((cat) => {
            const active = hoveredCat === cat.id;
            return (
              <div
                key={cat.id}
                onMouseEnter={() => setHoveredCat(cat.id)}
                onMouseLeave={() => setHoveredCat(null)}
                className="flex cursor-pointer items-center gap-1.5"
              >
                <span
                  className="h-2.5 w-2.5 rounded-sm"
                  style={{ backgroundColor: cat.color, opacity: active ? 1 : 0.7 }}
                />
                <span className={`figure text-xs ${active ? "text-ink" : "text-muted"}`}>
                  {cat.label}
                </span>
                <span className={`figure text-xs ${active ? "text-ink" : "text-faint"}`}>
                  {gbp(cat.cost, { compact: true })}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Component list with bars */}
      <div>
        <div className="eyebrow mb-3 text-[10px]">
          Top components &rarr; categories
        </div>
        <div className="space-y-1.5">
          {components.map((comp) => {
            const catHovered = hoveredCat && hoveredCat !== comp.category;
            return (
              <div
                key={comp.id}
                className={`flex items-center gap-3 rounded-md px-2 py-1.5 transition-opacity ${
                  catHovered ? "opacity-30" : ""
                }`}
              >
                {/* Category color dot */}
                <span
                  className="h-3 w-3 shrink-0 rounded-sm"
                  style={{ backgroundColor: comp.color }}
                  onMouseEnter={() => setHoveredCat(comp.category)}
                  onMouseLeave={() => setHoveredCat(null)}
                />
                {/* Label */}
                <div className="w-48 shrink-0">
                  <div className="figure text-xs text-ink truncate" title={comp.label}>
                    {comp.label}
                  </div>
                  {comp.provider && (
                    <div className="text-[10px] text-faint">{comp.provider}</div>
                  )}
                </div>
                {/* Bar */}
                <div className="flex-1">
                  <div className="h-5 w-full rounded-sm bg-panel2 overflow-hidden">
                    <div
                      className="h-full rounded-sm transition-all"
                      style={{
                        width: `${Math.max(0.5, (comp.cost / total) * 100 * 3)}%`,
                        backgroundColor: comp.color,
                      }}
                    />
                  </div>
                </div>
                {/* Value */}
                <div className="w-20 text-right shrink-0">
                  <div className="figure text-xs text-ink">
                    {gbp(comp.cost, { compact: true })}
                  </div>
                  <div className="text-[10px] text-faint">{comp.pct}%</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Total */}
      <div className="flex items-center justify-end border-t hairline pt-3">
        <span className="eyebrow text-[10px] mr-3">TOTAL</span>
        <span className="figure text-base text-signal">{gbp(total, { compact: true })} / yr</span>
      </div>
    </div>
  );
}
