"use client";

import React, { useMemo } from "react";
import type { Customer, Scenario, CostCategory } from "../../domain/types";
import { COST_CATEGORY_LABELS, WATERFALL_ORDER } from "../../domain/types";
import { gbp, num } from "../format";
import { computeScenarioResult } from "../../engine/scenario";

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

export function PortfolioView({
  portfolio,
  combinedProfile,
  combinedPeak,
  combinedTCO,
  combinedDR,
  combinedCalls,
}: {
  portfolio: {
    customer: Customer;
    scenario: Scenario;
    result: ReturnType<typeof computeScenarioResult>;
    drCost: number;
    totalWithDR: number;
  }[];
  combinedProfile: number[];
  combinedPeak: number;
  combinedTCO: number;
  combinedDR: number;
  combinedCalls: number;
}) {
  // Aggregate by category across all customers
  const catTotals = useMemo(() => {
    const map = new Map<CostCategory, number>();
    for (const { result } of portfolio) {
      for (const cat of result.breakdown.byCategory) {
        map.set(cat.category, (map.get(cat.category) ?? 0) + cat.annualCost);
      }
    }
    return WATERFALL_ORDER.filter((cat) => map.has(cat)).map((cat) => ({
      category: cat,
      label: COST_CATEGORY_LABELS[cat],
      cost: map.get(cat) ?? 0,
      color: CAT_COLORS[cat] ?? "#555",
    }));
  }, [portfolio]);

  if (portfolio.length === 0) {
    return (
      <p className="text-sm text-muted">
        No customers added yet. Go to the <strong>Customers</strong> tab to add customers and build a portfolio.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {/* Headline metrics */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <AggMetric label="Total customers" value={String(portfolio.length)} />
        <AggMetric label="Combined calls/yr" value={num(combinedCalls)} />
        <AggMetric label="Combined peak" value={num(combinedPeak)} accent="amber" />
        <AggMetric label="DR overhead" value={gbp(combinedDR, { compact: true })} accent="amber" />
        <AggMetric label="Combined TCO" value={gbp(combinedTCO, { compact: true })} accent="coral" />
      </div>

      {/* Combined category bar */}
      <div>
        <div className="eyebrow mb-2 text-[10px]">Combined cost by category</div>
        <div className="flex h-8 w-full overflow-hidden rounded-lg">
          {catTotals.map((cat) => (
            <div
              key={cat.category}
              style={{ width: `${Math.max(0.5, (cat.cost / combinedTCO) * 100)}%`, backgroundColor: cat.color }}
              className="cursor-pointer transition-opacity hover:opacity-80"
              title={`${cat.label}: ${gbp(cat.cost, { compact: true })}`}
            />
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          {catTotals.map((cat) => (
            <div key={cat.category} className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: cat.color }} />
              <span className="figure text-xs text-muted">{cat.label}</span>
              <span className="figure text-xs text-faint">{gbp(cat.cost, { compact: true })}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Combined concurrency chart */}
      <div>
        <div className="eyebrow mb-2 text-[10px]">
          Combined 24-hour concurrency profile (sum of all customers)
        </div>
        <div className="rounded-lg border hairline bg-panel2 p-3">
          <ConcurrencyBars profile={combinedProfile} peak={combinedPeak} />
        </div>
      </div>

      {/* Per-customer summary */}
      <div>
        <div className="eyebrow mb-2 text-[10px]">Per-customer breakdown</div>
        <div className="overflow-hidden rounded-xl border hairline">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b hairline bg-panel2 text-left">
                <th className="px-4 py-2.5 eyebrow font-normal">Customer</th>
                <th className="px-4 py-2.5 eyebrow font-normal text-right">Calls/yr</th>
                <th className="px-4 py-2.5 eyebrow font-normal text-right">Peak</th>
                <th className="px-4 py-2.5 eyebrow font-normal text-right">Pre-DR TCO</th>
                <th className="px-4 py-2.5 eyebrow font-normal text-right">DR cost</th>
                <th className="px-4 py-2.5 eyebrow font-normal text-right">TCO inc DR</th>
              </tr>
            </thead>
            <tbody>
              {portfolio.map(({ customer, result, drCost, totalWithDR }) => (
                <tr key={customer.id} className="border-b hairline hover:bg-panel2">
                  <td className="px-4 py-2.5 text-ink text-xs">{customer.name}</td>
                  <td className="px-4 py-2.5 text-right figure text-xs text-muted">
                    {num(result.volumes.annualIncomingCalls)}
                  </td>
                  <td className="px-4 py-2.5 text-right figure text-xs text-muted">
                    {num(result.volumes.peakConcurrentCalls)}
                  </td>
                  <td className="px-4 py-2.5 text-right figure text-xs text-muted">
                    {gbp(result.breakdown.totalAnnual, { compact: true })}
                  </td>
                  <td className="px-4 py-2.5 text-right figure text-xs text-amber">
                    {gbp(drCost, { compact: true })}
                  </td>
                  <td className="px-4 py-2.5 text-right figure text-xs text-ink">
                    {gbp(totalWithDR, { compact: true })}
                  </td>
                </tr>
              ))}
              <tr className="bg-panel2">
                <td className="px-4 py-3 text-xs font-semibold text-ink">Combined</td>
                <td className="px-4 py-3 text-right figure text-xs text-ink">{num(combinedCalls)}</td>
                <td className="px-4 py-3 text-right figure text-xs text-ink">{num(combinedPeak)}</td>
                <td className="px-4 py-3 text-right figure text-xs text-muted">
                  {gbp(combinedTCO - combinedDR, { compact: true })}
                </td>
                <td className="px-4 py-3 text-right figure text-xs text-amber">
                  {gbp(combinedDR, { compact: true })}
                </td>
                <td className="px-4 py-3 text-right figure text-sm text-signal">
                  {gbp(combinedTCO, { compact: true })}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function AggMetric({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "coral" | "amber";
}) {
  const color = accent === "coral" ? "text-coral" : accent === "amber" ? "text-amber" : "text-ink";
  return (
    <div className="rounded-xl border hairline bg-panel px-4 py-3">
      <div className="text-[10px] text-faint">{label}</div>
      <div className={`figure text-lg ${color}`}>{value}</div>
    </div>
  );
}

function ConcurrencyBars({ profile, peak }: { profile: number[]; peak: number }) {
  const W = 700;
  const H = 120;
  const PAD = { top: 10, right: 10, bottom: 20, left: 40 };
  const CHART_W = W - PAD.left - PAD.right;
  const CHART_H = H - PAD.top - PAD.bottom;
  const BAR_W = CHART_W / 24 - 2;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      {[0.5, 1].map((frac) => (
        <line
          key={frac}
          x1={PAD.left}
          y1={PAD.top + CHART_H - (CHART_H * frac)}
          x2={W - PAD.right}
          y2={PAD.top + CHART_H - (CHART_H * frac)}
          stroke="#1e2833"
          strokeWidth={1}
        />
      ))}
      {profile.map((v, hour) => {
        const barH = (v / Math.max(peak, 1)) * CHART_H;
        const x = PAD.left + hour * (CHART_W / 24) + 1;
        const y = PAD.top + CHART_H - barH;
        return (
          <g key={hour}>
            <rect x={x} y={y} width={BAR_W} height={Math.max(1, barH)} rx={1} fill="#38E1B0" opacity={0.6} />
            {hour % 6 === 0 && (
              <text x={x + BAR_W / 2} y={H - 6} textAnchor="middle" className="figure" fill="#5b6673" fontSize={8}>
                {String(hour).padStart(2, "0") + ":00"}
              </text>
            )}
          </g>
        );
      })}
      <text x={PAD.left - 8} y={PAD.top + 4} textAnchor="end" className="figure" fill="#5b6673" fontSize={8}>
        {peak >= 10000 ? (peak / 1000).toFixed(0) + "k" : peak}
      </text>
    </svg>
  );
}

function catCost(r: ReturnType<typeof computeScenarioResult>, cat: string): number {
  return r.breakdown.byCategory.find((c) => c.category === cat)?.annualCost ?? 0;
}

function infraCost(r: ReturnType<typeof computeScenarioResult>): number {
  const cats = [
    "TELEPHONY_AND_INTEGRATION", "AI_AND_COMPUTE", "KNOWLEDGE",
    "AUDIO_TRANSCRIPT_STORAGE", "OPERATIONS_AND_OBSERVABILITY", "DATA_AND_ANALYTICS",
  ];
  return cats.reduce((s, cat) => s + catCost(r, cat), 0);
}
