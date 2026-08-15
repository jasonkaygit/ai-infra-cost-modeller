"use client";

import React from "react";
import type { Customer } from "../../domain/types";
import { gbp, num, pct } from "../format";

interface ProjectionYear {
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
}

export function PortfolioView({
  combinedPeak,
  growth,
  portfolioProjections,
}: {
  combinedPeak: number;
  growth: { years: number };
  portfolioProjections: ProjectionYear[];
}) {
  const [selectedYear, setSelectedYear] = React.useState(1);

  const proj = selectedYear === 0 ? null : portfolioProjections.find((p) => p.year === selectedYear) ?? portfolioProjections[0];

  const projTCO = selectedYear === 0
    ? portfolioProjections.reduce((s, p) => s + p.totalTCO, 0)
    : proj?.totalTCO ?? 0;
  const projDR = selectedYear === 0
    ? portfolioProjections.reduce((s, p) => s + p.totalDR, 0)
    : proj?.totalDR ?? 0;
  const projBenefit = selectedYear === 0
    ? portfolioProjections.reduce((s, p) => s + p.totalBenefit, 0)
    : proj?.totalBenefit ?? 0;
  const projCalls = selectedYear === 0
    ? portfolioProjections.reduce((sum, p) => sum + p.customers.reduce((s, c) => s + c.volume, 0), 0)
    : proj?.customers.reduce((s, c) => s + c.volume, 0) ?? 0;
  const projPeak = selectedYear === 0
    ? portfolioProjections.reduce((peak, p) => Math.max(peak, p.totalPeakConcurrency), combinedPeak)
    : proj?.totalPeakConcurrency ?? combinedPeak;
  const displayCustomers = selectedYear === 0
    ? (() => {
        const map = new Map<string, { customer: Customer; volume: number; tco: number; drCost: number; resolution: number; baselineCost: number }>();
        for (const p of portfolioProjections) {
          for (const c of p.customers) {
            const entry = map.get(c.customer.id);
            if (entry) {
              entry.volume += c.volume;
              entry.tco += c.tco;
              entry.drCost += c.drCost;
            } else {
              map.set(c.customer.id, { ...c });
            }
          }
        }
        return [...map.values()];
      })()
    : (proj?.customers ?? []);

  if (portfolioProjections.length === 0) {
    return (
      <p className="text-sm text-muted">
        No customers added yet. Go to the <strong>Customers</strong> tab to add customers and build a portfolio.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {/* Year selector */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted">Forecast year:</span>
        {portfolioProjections.map((p) => (
          <button
            key={p.year}
            onClick={() => setSelectedYear(p.year)}
            className={`figure rounded-lg px-3 py-1 text-xs transition-colors ${
              selectedYear === p.year ? "bg-signal text-ground" : "border hairline text-muted hover:text-ink"
            }`}
          >
            {p.label}
          </button>
        ))}
        <button
          onClick={() => setSelectedYear(0)}
          className={`figure rounded-lg px-3 py-1 text-xs transition-colors ${
            selectedYear === 0 ? "bg-signal text-ground" : "border hairline text-muted hover:text-ink"
          }`}
        >
          Total
        </button>
      </div>

      {/* Cumulative row */}
      {selectedYear === 0 && (
        <div className="rounded-xl border border-signalDim bg-panel2 p-4">
          <div className="grid grid-cols-3 gap-4">
            <div>
              <div className="text-[10px] text-faint">Total TCO ({growth.years}yr)</div>
              <div className="figure text-lg text-coral">{gbp(projTCO, { compact: true })}</div>
            </div>
            <div>
              <div className="text-[10px] text-faint">Total DR overhead</div>
              <div className="figure text-lg text-amber">{gbp(projDR, { compact: true })}</div>
            </div>
            <div>
              <div className="text-[10px] text-faint">Cumulative net benefit</div>
              <div className="figure text-lg text-signal">{gbp(projBenefit, { compact: true })}</div>
            </div>
          </div>
        </div>
      )}

      {/* Headline metrics */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <AggMetric
          label="Customers"
          value={String(
            selectedYear === 0
              ? new Set(portfolioProjections.flatMap((p) => p.customers.map((c) => c.customer.id))).size
              : displayCustomers.length
          )}
        />
        <AggMetric label="Combined calls/yr" value={num(projCalls)} />
        <AggMetric label="Combined peak" value={num(projPeak)} accent="amber" />
        <AggMetric label="DR overhead" value={gbp(projDR, { compact: true })} accent="amber" />
        <AggMetric label="Combined TCO" value={gbp(projTCO, { compact: true })} accent="coral" />
      </div>


      {/* Per-customer breakdown */}
      {displayCustomers.length > 0 && (
        <div>
          <div className="eyebrow mb-2 text-[10px]">
            Per-customer breakdown — {selectedYear === 0 ? `All years (total)` : proj?.label ?? `Year ${selectedYear}`}
          </div>
          <div className="overflow-hidden rounded-xl border hairline">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b hairline bg-panel2 text-left">
                  <th className="px-4 py-2.5 eyebrow font-normal">Customer</th>
                  <th className="px-4 py-2.5 eyebrow font-normal text-right">Calls/yr</th>
                  <th className="px-4 py-2.5 eyebrow font-normal text-right">Resolution</th>
                  <th className="px-4 py-2.5 eyebrow font-normal text-right">Baseline</th>
                  <th className="px-4 py-2.5 eyebrow font-normal text-right">DR cost</th>
                  <th className="px-4 py-2.5 eyebrow font-normal text-right">TCO</th>
                </tr>
              </thead>
              <tbody>
                {displayCustomers.map((c) => (
                  <tr key={c.customer.id} className="border-b hairline hover:bg-panel2">
                    <td className="px-4 py-2.5 text-ink text-xs">{c.customer.name}</td>
                    <td className="px-4 py-2.5 text-right figure text-xs text-muted">{num(c.volume)}</td>
                    <td className="px-4 py-2.5 text-right figure text-xs text-muted">{pct(c.resolution)}</td>
                    <td className="px-4 py-2.5 text-right figure text-xs text-muted">£{c.baselineCost.toFixed(2)}</td>
                    <td className="px-4 py-2.5 text-right figure text-xs text-amber">{gbp(c.drCost, { compact: true })}</td>
                    <td className="px-4 py-2.5 text-right figure text-xs text-ink">{gbp(c.tco, { compact: true })}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-panel2">
                  <td className="px-4 py-3 text-xs font-semibold text-ink">Grand total</td>
                  <td className="px-4 py-3 text-right figure text-xs text-ink">
                    {num(displayCustomers.reduce((s, c) => s + c.volume, 0))}
                  </td>
                  <td className="px-4 py-3" colSpan={2} />
                  <td className="px-4 py-3 text-right figure text-xs text-amber">
                    {gbp(displayCustomers.reduce((s, c) => s + c.drCost, 0), { compact: true })}
                  </td>
                  <td className="px-4 py-3 text-right figure text-sm text-signal">
                    {gbp(displayCustomers.reduce((s, c) => s + c.tco, 0), { compact: true })}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function AggMetric({ label, value, accent }: { label: string; value: string; accent?: "coral" | "amber" }) {
  const color = accent === "coral" ? "text-coral" : accent === "amber" ? "text-amber" : "text-ink";
  return (
    <div className="rounded-xl border hairline bg-panel px-4 py-3">
      <div className="text-[10px] text-faint">{label}</div>
      <div className={`figure text-lg ${color}`}>{value}</div>
    </div>
  );
}
