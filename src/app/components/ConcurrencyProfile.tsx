"use client";

import React, { useState, useCallback, useRef } from "react";

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const W = 700;
const H = 200;
const PAD = { top: 20, right: 10, bottom: 30, left: 40 };
const CHART_W = W - PAD.left - PAD.right;
const CHART_H = H - PAD.top - PAD.bottom;
const BAR_W = CHART_W / 24 - 2;
const PEAK_COLOR = "#38E1B0";
const BAR_COLOR = "#5CD0E8";
const DRAG_COLOR = "#FFB347";

function defaultProfile(): number[] {
  // Business-hours peak ~12k: low at night, ramps up 8am-6pm, drops off
  return [500, 300, 200, 150, 150, 200, 500, 1000, 4000, 8000, 10000, 12000, 12000, 11000, 10000, 9000, 8000, 6000, 4000, 2000, 1500, 1200, 1000, 800];
}

function scaleProfile(shape: number[], targetPeak: number): number[] {
  const currentMax = Math.max(...shape);
  if (currentMax === 0) return shape;
  const factor = targetPeak / currentMax;
  return shape.map((v) => Math.round(v * factor));
}

const PRESETS: Record<string, { label: string; shape: number[] }> = {
  business: {
    label: "Business hours (9–5)",
    shape: defaultProfile(),
  },
  flat: {
    label: "Flat (24/7)",
    shape: Array(24).fill(8000),
  },
  bimodal: {
    label: "Bimodal (morning + afternoon)",
    shape: (() => {
      const p = Array(24).fill(1000);
      for (let i = 7; i <= 10; i++) p[i] = 8000;
      for (let i = 11; i <= 13; i++) p[i] = 5500;
      for (let i = 14; i <= 17; i++) p[i] = 7500;
      for (let i = 18; i <= 20; i++) p[i] = 4000;
      return p;
    })(),
  },
};

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
  const values = profile && profile.length === 24 ? profile : defaultProfile();
  const peak = Math.max(...values);
  const [dragging, setDragging] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const getY = useCallback(
    (v: number) => PAD.top + CHART_H - (v / Math.max(peak, 1)) * CHART_H,
    [peak]
  );

  const handleMouseDown = (hour: number) => (e: React.MouseEvent) => {
    setDragging(hour);
  };

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (dragging === null || !svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const scaleX = rect.width / W;
      const scaleY = rect.height / H;
      const chartY = (y / scaleY) - PAD.top;
      const v = Math.max(0, Math.round(((CHART_H - chartY) / CHART_H) * peak));
      const next = [...values];
      next[dragging] = v;
      onChange(next);
    },
    [dragging, values, peak, onChange]
  );

  const handleMouseUp = useCallback(() => setDragging(null), []);

  const [scaleInput, setScaleInput] = useState(String(peak));

  return (
    <div className="space-y-4">
      {/* Presets + scale */}
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-[10px] text-faint">Presets:</span>
        {Object.entries(PRESETS).map(([key, { label, shape }]) => (
          <button
            key={key}
            onClick={() => {
              const p = [...shape];
              onChange(p);
              setScaleInput(String(Math.max(...p)));
            }}
            className="figure rounded border hairline px-2 py-0.5 text-[11px] text-muted hover:text-ink hover:border-signalDim"
          >
            {label}
          </button>
        ))}
        <span className="text-[10px] text-faint ml-2">Target peak:</span>
        <input
          type="number"
          value={scaleInput}
          onChange={(e) => setScaleInput(e.target.value)}
          onBlur={() => {
            const target = Number(scaleInput);
            if (target > 0 && Number.isFinite(target)) {
              onChange(scaleProfile(values, target));
            } else {
              setScaleInput(String(peak));
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const target = Number(scaleInput);
              if (target > 0 && Number.isFinite(target)) {
                onChange(scaleProfile(values, target));
              }
            }
          }}
          className="figure w-24 rounded border hairline bg-panel2 px-2 py-0.5 text-xs text-ink outline-none focus:border-signalDim"
          placeholder="peak"
        />
        <button
          onClick={() => {
            onChange(defaultProfile());
            setScaleInput("12000");
          }}
          className="figure rounded border hairline px-2 py-0.5 text-[11px] text-muted hover:text-ink hover:border-signalDim"
        >
          reset
        </button>
      </div>

      {/* Chart */}
      <div className="rounded-lg border hairline bg-panel2 p-3">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          style={{ touchAction: "none" }}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          {/* Grid lines */}
          {[0.25, 0.5, 0.75, 1].map((frac) => (
            <line
              key={frac}
              x1={PAD.left}
              y1={getY(peak * frac)}
              x2={W - PAD.right}
              y2={getY(peak * frac)}
              stroke="#1e2833"
              strokeWidth={1}
            />
          ))}

          {/* Bars */}
          {HOURS.map((hour) => {
            const v = values[hour];
            const barH = (v / Math.max(peak, 1)) * CHART_H;
            const x = PAD.left + hour * (CHART_W / 24) + 1;
            const y = PAD.top + CHART_H - barH;
            const isDragging = dragging === hour;

            return (
              <g key={hour}>
                <rect
                  x={x}
                  y={y}
                  width={BAR_W}
                  height={Math.max(1, barH)}
                  rx={2}
                  fill={isDragging ? DRAG_COLOR : v === peak ? PEAK_COLOR : BAR_COLOR}
                  opacity={isDragging ? 1 : 0.7}
                  className="cursor-ns-resize transition-colors"
                  onMouseDown={handleMouseDown(hour)}
                />
                {/* Hour label (every 6 hours) */}
                {hour % 6 === 0 && (
                  <text
                    x={x + BAR_W / 2}
                    y={H - 6}
                    textAnchor="middle"
                    className="figure"
                    fill="#5b6673"
                    fontSize={9}
                  >
                    {String(hour).padStart(2, "0") + ":00"}
                  </text>
                )}
              </g>
            );
          })}

          {/* Y-axis labels */}
          <text x={PAD.left - 8} y={getY(peak) + 4} textAnchor="end" className="figure" fill="#5b6673" fontSize={9}>
            {peak >= 10000 ? (peak / 1000).toFixed(0) + "k" : peak}
          </text>
          <text x={PAD.left - 8} y={getY(peak / 2) + 4} textAnchor="end" className="figure" fill="#5b6673" fontSize={9}>
            {peak >= 10000 ? (peak / 2000).toFixed(0) + "k" : Math.round(peak / 2)}
          </text>
        </svg>
      </div>

      {/* Summary */}
      <div className="flex gap-4 text-[10px] text-faint">
        <span>
          Peak: <span className="figure text-amber">{peak.toLocaleString()}</span> concurrent
        </span>
        <span>
          Avg:{" "}
          <span className="figure text-muted">
            {Math.round(values.reduce((s, v) => s + v, 0) / 24).toLocaleString()}
          </span>{" "}
          concurrent
        </span>
        <span>
          Total concurrency-hours:{" "}
          <span className="figure text-muted">
            {values.reduce((s, v) => s + v, 0).toLocaleString()}
          </span>
        </span>
      </div>

      {/* Infrastructure sizing */}
      {steppedComponents && steppedComponents.length > 0 && onUpdateComponent && (
        <div className="rounded-lg border hairline bg-panel2 p-3">
          <div className="eyebrow mb-2 text-[10px]">Infrastructure sizing (profile-based)</div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {steppedComponents.map((sc) => {
              const totalUnits = values.reduce((sum, v) => {
                const cap = Math.max(1, sc.capacityPerUnit);
                // Match engine: floor of 1 per hour (minUnits from the actual component is not accessible here)
                return sum + Math.max(1, Math.ceil(v / cap));
              }, 0);
              const avgNodes = Math.round(totalUnits / 24);
              const monthlyCost = sc.unitPrice * avgNodes;
              return (
                <div key={sc.id} className="rounded border hairline bg-panel px-3 py-2">
                  <div className="text-[10px] text-faint">{sc.label}</div>
                  <div className="mt-1 flex items-center gap-1">
                    <span className="text-[10px] text-faint">1 node per</span>
                    <input
                      type="number"
                      value={sc.capacityPerUnit}
                      min={1}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        if (v > 0) onUpdateComponent(sc.id, v);
                      }}
                      className="figure w-12 rounded border hairline bg-panel2 px-1 py-0.5 text-[11px] text-ink outline-none focus:border-signalDim"
                    />
                    <span className="text-[10px] text-faint">sessions</span>
                  </div>
                  <div className="mt-1.5 figure text-xs text-ink">
                    {avgNodes.toLocaleString()} nodes
                  </div>
                  <div className="text-[10px] text-faint">
                    £{monthlyCost.toLocaleString()}/mo
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-[10px] text-faint">
            Time-weighted average across 24h, floor of 1 node/hr. Adjust concurrency-per-node
            to match your instance type. More capacity per node = fewer nodes = lower cost.
          </p>
        </div>
      )}

      <p className="text-[10px] text-faint">
        Drag bars up/down to shape the 24-hour concurrency curve. The peak value replaces the Erlang formula
        for PEAK_CONCURRENCY — stepped infrastructure scales to this maximum. Presets provide common patterns.
      </p>
    </div>
  );
}
