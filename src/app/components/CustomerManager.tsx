"use client";

import React from "react";
import type { Customer, Scenario } from "../../domain/types";
import { gbp, num } from "../format";

export function CustomerManager({
  customers,
  scenarios,
  portfolio,
  onAdd,
  onUpdate,
  onRemove,
}: {
  customers: Customer[];
  scenarios: Scenario[];
  portfolio: { customer: Customer; scenario: Scenario; result: any }[];
  onAdd: () => void;
  onUpdate: (id: string, patch: Partial<Customer>) => void;
  onRemove: (id: string) => void;
}) {
  const getResult = (customerId: string) =>
    portfolio.find((p) => p.customer.id === customerId)?.result;

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

      {customers.length > 0 && (
        <div className="overflow-hidden rounded-xl border hairline">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b hairline bg-panel2 text-left">
                <th className="px-4 py-2.5 eyebrow font-normal">Customer</th>
                <th className="px-4 py-2.5 eyebrow font-normal">Scenario</th>
                <th className="px-4 py-2.5 eyebrow font-normal text-right">Calls/yr</th>
                <th className="px-4 py-2.5 eyebrow font-normal text-right">Peak conc.</th>
                <th className="px-4 py-2.5 eyebrow font-normal text-right">TCO</th>
                <th className="px-4 py-2.5 eyebrow font-normal" />
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => {
                const r = getResult(c.id);
                const cp = c.concurrencyProfile;
                const peak = cp ? Math.max(...cp) : r?.volumes.peakConcurrentCalls ?? 0;
                return (
                  <tr key={c.id} className="border-b hairline hover:bg-panel2">
                    <td className="px-4 py-2.5">
                      <input
                        type="text"
                        value={c.name}
                        onChange={(e) => onUpdate(c.id, { name: e.target.value })}
                        className="figure w-full bg-transparent text-sm text-ink outline-none"
                      />
                    </td>
                    <td className="px-4 py-2.5">
                      <select
                        value={c.scenarioId}
                        onChange={(e) => onUpdate(c.id, { scenarioId: e.target.value })}
                        className="figure rounded border hairline bg-panel2 px-2 py-1 text-xs text-ink outline-none cursor-pointer"
                      >
                        {scenarios.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-2.5 text-right figure text-xs text-muted">
                      {r ? num(r.volumes.annualIncomingCalls) : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right figure text-xs text-muted">
                      {peak.toLocaleString()}
                      {cp && cp.length === 24 ? (
                        <span className="text-amber ml-1">*</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5 text-right figure text-xs text-ink">
                      {r ? gbp(r.breakdown.totalAnnual, { compact: true }) : "—"}
                    </td>
                    <td className="px-4 py-2.5">
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

      {customers.length > 0 && (
        <p className="text-[10px] text-faint">
          * Has custom concurrency profile. Edit on the <strong>Concurrency</strong> tab after selecting the
          customer in the Scenario tab.
        </p>
      )}
    </div>
  );
}
