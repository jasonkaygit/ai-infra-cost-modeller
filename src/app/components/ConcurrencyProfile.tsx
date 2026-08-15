"use client";

import React, { useState } from "react";

const DEFAULT_PROFILE = [
  500, 300, 200, 150, 150, 200, 500, 1000, 4000, 8000, 10000, 12000,
  12000, 11000, 10000, 9000, 8000, 6000, 4000, 2000, 1500, 1200, 1000, 800,
];

function currentPeak(profile: number[] | undefined): number {
  return Math.max(...(profile && profile.length === 24 ? profile : DEFAULT_PROFILE), 1);
}

function scaleProfile(profile: number[] | undefined, targetPeak: number): number[] {
  const base = profile && profile.length === 24 ? profile : DEFAULT_PROFILE;
  const factor = Math.max(1, targetPeak) / currentPeak(base);
  return base.map((v) => Math.round(v * factor));
}

export function ConcurrencyProfile({
  profile,
  onChange,
  steppedComponents,
  onUpdateComponent,
}: {
  profile: number[] | undefined;
  onChange: (p: number[]) => void;
  steppedComponents?: { id: string; label: string; capacityPerUnit: number; unitPrice: number }[];
  onUpdateComponent?: (id: string, capacityPerUnit: number) => void;
}) {
  const ec2 = steppedComponents?.find((c) => c.id === "ec2-nitro-inference") ?? steppedComponents?.[0];
  const peak = currentPeak(profile);
  const [peakDraft, setPeakDraft] = useState(String(peak));

  if (!ec2 || !onUpdateComponent) {
    return (
      <p className="text-xs text-muted">
        Add an enabled stepped EC2 inference component to calculate node capacity.
      </p>
    );
  }

  const sessionsPerNode = Math.max(1, ec2.capacityPerUnit);
  const requiredNodes = Math.max(1, Math.ceil(peak / sessionsPerNode));
  const monthlyCost = requiredNodes * ec2.unitPrice;
  const annualCost = monthlyCost * 12;
  const utilization = peak / (requiredNodes * sessionsPerNode);

  const setPeak = (targetPeak: number) => {
    onChange(scaleProfile(profile, Math.max(1, targetPeak)));
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <NodeSizingMetric label="Peak concurrency" value={peak.toLocaleString("en-GB")} />
        <NodeSizingMetric label="Sessions / node" value={sessionsPerNode.toLocaleString("en-GB")} />
        <NodeSizingMetric label="EC2 nodes required" value={requiredNodes.toLocaleString("en-GB")} accent />
        <NodeSizingMetric label="Estimated annual EC2" value={`£${annualCost.toLocaleString("en-GB")}`} />
      </div>

      <div className="rounded-lg border hairline bg-panel2 p-4">
        <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <label>
            <span className="mb-1.5 block text-xs text-muted">Peak concurrent calls</span>
            <input
              type="number"
              min={1}
              value={peakDraft}
              onChange={(e) => setPeakDraft(e.target.value)}
              onBlur={() => {
                const next = Number(peakDraft);
                if (Number.isFinite(next) && next > 0) setPeak(next);
                else setPeakDraft(String(peak));
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const next = Number(peakDraft);
                  if (Number.isFinite(next) && next > 0) setPeak(next);
                }
              }}
              className="figure w-full rounded-lg border hairline bg-panel px-3 py-2 text-sm text-ink outline-none focus:border-signalDim"
            />
          </label>

          <label>
            <span className="mb-1.5 block text-xs text-muted">Concurrent calls per EC2 node</span>
            <input
              type="number"
              min={1}
              value={sessionsPerNode}
              onChange={(e) => {
                const next = Number(e.target.value);
                if (Number.isFinite(next) && next > 0) onUpdateComponent(ec2.id, next);
              }}
              className="figure w-full rounded-lg border hairline bg-panel px-3 py-2 text-sm text-ink outline-none focus:border-signalDim"
            />
          </label>
        </div>

        <div className="h-3 overflow-hidden rounded-full bg-line">
          <div
            className="h-full bg-signal"
            style={{ width: `${Math.min(100, utilization * 100)}%` }}
          />
        </div>
        <div className="mt-2 flex items-center justify-between text-[10px] text-faint">
          <span>
            Formula: ceil({peak.toLocaleString("en-GB")} / {sessionsPerNode.toLocaleString("en-GB")}) ={" "}
            {requiredNodes.toLocaleString("en-GB")} nodes
          </span>
          <span>{Math.round(utilization * 100)}% peak utilization</span>
        </div>
      </div>

      <p className="text-[10px] leading-relaxed text-faint">
        This capacity calculation is intentionally simple: peak concurrent calls divided by tested
        concurrent-call capacity per EC2 node. Change the sessions-per-node value when load testing gives
        a better capacity figure for the chosen instance type.
      </p>
    </div>
  );
}

function NodeSizingMetric({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-lg border hairline bg-panel2 px-3 py-2">
      <div className="text-[10px] text-faint">{label}</div>
      <div className={`figure text-sm ${accent ? "text-signal" : "text-ink"}`}>{value}</div>
    </div>
  );
}
