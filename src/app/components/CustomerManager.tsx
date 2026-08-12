"use client";

import React from "react";
import type { Customer, Scenario } from "../../domain/types";
import { gbp, num } from "../format";

export function CustomerManager({
  customers,
  scenarios,
  onAdd,
  onUpdate,
  onRemove,
  portfolioProjections,
}: {
  customers: Customer[];
  scenarios: Scenario[];
  onAdd: () => void;
  onUpdate: (id: string, patch: Partial<Customer>) => void;
  onRemove: (id: string) => void;
  portfolioProjections: {
    year: number;
    customers: { customer: Customer; tco: number }[];
  }[];
}) {
  // Build customer → year TCO map
  const customerTCOs = new Map<string, number[]>();
  for (const p of portfolioProjections) {
    for (const c of p.customers) {
      const arr = customerTCOs.get(c.customer.id) ?? [];
      arr[p.year - 1] = c.tco;
      customerTCOs.set(c.customer.id, arr);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">
          {customers.length === 0
            ? "No customers yet. Add customers to build a portfolio."
            : `${customers.length} customer${customers.length > 1 ? "s" : ""} — each assigned a scenario and optional concurrency profile.`}
        </p>
        <button
          onClick={onAdd}
          className="figure rounded-lg border border-signalDim px-3 py-1.5 text-sm text-signal hover:bg-panel2"
        >
          + add customer
        </button>
      </div>

      {customers.length > 0 && portfolioProjections.length > 0 && (
        <div className="overflow-hidden rounded-xl border hairline">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b hairline bg-panel2 text-left">
                <th className="px-3 py-2.5 eyebrow font-normal">Customer</th>
                <th className="px-3 py-2.5 eyebrow font-normal">Scenario</th>
                {portfolioProjections.map((p) => (
                  <th key={p.year} className="px-3 py-2.5 eyebrow font-normal text-right">
                    Yr {p.year}
                  </th>
                ))}
                <th className="px-3 py-2.5 eyebrow font-normal text-right">Total</th>
                <th className="px-3 py-2.5 eyebrow font-normal" />
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => {
                const tcos = customerTCOs.get(c.id) ?? [];
                const total = tcos.reduce((s, v) => s + (v || 0), 0);
                return (
                  <tr key={c.id} className="border-b hairline hover:bg-panel2">
                    <td className="px-3 py-2.5">
                      <input
                        type="text"
                        value={c.name}
                        onChange={(e) => onUpdate(c.id, { name: e.target.value })}
                        className="figure w-full bg-transparent text-sm text-ink outline-none"
                      />
                    </td>
                    <td className="px-3 py-2.5">
                      <select
                        value={c.scenarioId}
                        onChange={(e) => onUpdate(c.id, { scenarioId: e.target.value })}
                        className="figure rounded border hairline bg-panel2 px-2 py-1 text-xs text-ink outline-none cursor-pointer min-w-[160px]"
                      >
                        {scenarios.map((s) => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                    </td>
                    {portfolioProjections.map((p) => (
                      <td key={p.year} className="px-3 py-2.5 text-right figure text-xs text-muted">
                        {tcos[p.year - 1] != null ? gbp(tcos[p.year - 1], { compact: true }) : "—"}
                      </td>
                    ))}
                    <td className="px-3 py-2.5 text-right figure text-xs text-ink">
                      {gbp(total, { compact: true })}
                    </td>
                    <td className="px-3 py-2.5">
                      <button
                        onClick={() => onRemove(c.id)}
                        className="figure text-[10px] text-faint hover:text-coral"
                      >
                        remove
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
