"use client";

import React from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Cell,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import type { CostBreakdown } from "../../domain/types";
import { COST_CATEGORY_LABELS } from "../../domain/types";
import { gbp } from "../format";

const CATEGORY_COLOR: Record<string, string> = {
  VOICE_SERVICE: "#38E1B0",
  TELEPHONY_AND_INTEGRATION: "#2FBF9B",
  AI_AND_COMPUTE: "#5CD0E8",
  KNOWLEDGE: "#6FA8DC",
  AUDIO_TRANSCRIPT_STORAGE: "#8B7CF6",
  EVALUATION_AND_ASSURANCE: "#B78CF6",
  OPERATIONS_AND_OBSERVABILITY: "#E9B949",
  DATA_AND_ANALYTICS: "#E9976A",
  HUMAN_ESCALATION: "#E06C75",
  FIXED_OPERATIONAL: "#8A97A6",
};

export function CostWaterfall({
  breakdown,
  annualCalls,
  mode,
}: {
  breakdown: CostBreakdown;
  annualCalls: number;
  mode: "total" | "perCall";
}) {
  const data = breakdown.byCategory.map((c) => ({
    key: c.category,
    name: COST_CATEGORY_LABELS[c.category],
    value: mode === "total" ? c.annualCost : c.perCall,
  }));

  return (
    <div className="h-[340px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 64 }}>
          <CartesianGrid strokeDasharray="2 4" stroke="#1E2833" vertical={false} />
          <XAxis
            dataKey="name"
            angle={-38}
            textAnchor="end"
            interval={0}
            tick={{ fill: "#8A97A6", fontSize: 10, fontFamily: "JetBrains Mono" }}
            stroke="#1E2833"
          />
          <YAxis
            tick={{ fill: "#5B6673", fontSize: 10, fontFamily: "JetBrains Mono" }}
            stroke="#1E2833"
            tickFormatter={(v) => gbp(v, { compact: mode === "total", decimals: mode === "perCall" ? 2 : 0 })}
            width={70}
          />
          <Tooltip
            cursor={{ fill: "rgba(56,225,176,0.06)" }}
            contentStyle={{
              background: "#0F141B",
              border: "1px solid #1E2833",
              borderRadius: 10,
              fontFamily: "JetBrains Mono",
              fontSize: 12,
            }}
            labelStyle={{ color: "#E6EDF3" }}
            formatter={(v: number) => [
              mode === "total" ? gbp(v, { compact: true }) : gbp(v, { decimals: 4 }),
              mode === "total" ? "Annual" : "Per incoming call",
            ]}
          />
          <Bar dataKey="value" radius={[3, 3, 0, 0]} maxBarSize={44}>
            {data.map((d) => (
              <Cell key={d.key} fill={CATEGORY_COLOR[d.key] ?? "#38E1B0"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
