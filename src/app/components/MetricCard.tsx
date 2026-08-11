"use client";

import React from "react";

export function MetricCard({
  label,
  value,
  sub,
  accent,
  onClick,
  active,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: "signal" | "coral" | "amber" | "violet" | "muted";
  onClick?: () => void;
  active?: boolean;
}) {
  const accentColor =
    accent === "signal"
      ? "text-signal"
      : accent === "coral"
      ? "text-coral"
      : accent === "amber"
      ? "text-amber"
      : accent === "violet"
      ? "text-violet"
      : "text-ink";

  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className={`group text-left rounded-xl border bg-panel px-4 py-3.5 transition-colors ${
        active ? "border-signal" : "hairline"
      } ${onClick ? "hover:border-signalDim cursor-pointer" : "cursor-default"}`}
    >
      <div className="eyebrow mb-2">{label}</div>
      <div className={`figure text-figure-lg ${accentColor}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-muted figure">{sub}</div>}
    </button>
  );
}
