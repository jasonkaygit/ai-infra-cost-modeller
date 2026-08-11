"use client";

import React, { useState, useCallback, useMemo } from "react";
import type {
  CostBreakdown,
  ComponentCostLine,
  CostComponent,
  CostCategory,
  UsageDriver,
  FixedVariableClass,
  Environment,
  Frequency,
} from "../../domain/types";
import { COST_CATEGORY_LABELS, WATERFALL_ORDER } from "../../domain/types";
import { gbp, num } from "../format";
import { PricingEditor } from "./PricingEditor";

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

const CLASS_BADGE: Record<string, string> = {
  VARIABLE: "text-signal border-signalDim",
  SEMI_VARIABLE: "text-[#5CD0E8] border-[#2b5766]",
  STEPPED: "text-amber border-[#6b5a20]",
  FIXED: "text-muted border-line",
  ONE_OFF: "text-coral border-[#6b2f34]",
};

const CATEGORIES: CostCategory[] = [
  "VOICE_SERVICE", "AI_AND_COMPUTE", "TELEPHONY_AND_INTEGRATION",
  "KNOWLEDGE", "AUDIO_TRANSCRIPT_STORAGE", "EVALUATION_AND_ASSURANCE",
  "OPERATIONS_AND_OBSERVABILITY", "DATA_AND_ANALYTICS", "HUMAN_ESCALATION", "FIXED_OPERATIONAL",
];

const DRIVERS: UsageDriver[] = [
  "ANNUAL_CALLS", "AI_CALLS", "RESOLVED_CALLS", "ESCALATED_CALLS",
  "AI_MINUTES", "AI_SECONDS", "HUMAN_MINUTES", "TELEPHONY_MINUTES",
  "SESSIONS", "INPUT_TOKENS", "OUTPUT_TOKENS", "TOTAL_TOKENS", "REASONING_TOKENS",
  "LLM_REQUESTS", "TOOL_CALLS", "KNOWLEDGE_SEARCHES", "API_CALLS",
  "AUDIO_GB", "TRANSCRIPT_GB", "LOG_GB", "TRACE_GB", "STORED_GB_MONTHS", "EGRESS_GB",
  "EVALUATED_CALLS", "DEEP_EVALUATED_CALLS", "EVALUATION_TOKENS",
  "PEAK_CONCURRENCY", "COMPUTE_HOURS", "PROVISIONED_MONTHS", "NONE",
];

const CLASSIFICATIONS: FixedVariableClass[] = ["VARIABLE", "SEMI_VARIABLE", "STEPPED", "FIXED", "ONE_OFF"];
const ENVIRONMENTS: Environment[] = ["PROD", "NON_PROD", "SHARED"];
const FREQUENCIES: Frequency[] = ["MONTHLY", "ANNUAL", "ONE_OFF"];

export function BreakdownTable({
  breakdown,
  components,
  onUpdateComponent,
  onDeleteComponent,
}: {
  breakdown: CostBreakdown;
  components: CostComponent[];
  onUpdateComponent: (id: string, patch: Partial<CostComponent>) => void;
  onDeleteComponent: (id: string) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<"category" | "cost">("category");
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverCat, setDragOverCat] = useState<string | null>(null);
  const componentMap = new Map(components.map((c) => [c.id, c]));

  // Group lines by category
  const grouped = useMemo(() => {
    const groups = new Map<CostCategory, ComponentCostLine[]>();
    for (const l of breakdown.lines) {
      const arr = groups.get(l.category) ?? [];
      arr.push(l);
      groups.set(l.category, arr);
    }
    // Order by WATERFALL_ORDER
    return WATERFALL_ORDER
      .filter((cat) => groups.has(cat))
      .map((cat) => ({
        category: cat,
        label: COST_CATEGORY_LABELS[cat],
        color: CAT_COLORS[cat] ?? "#555",
        total: groups.get(cat)!.reduce((s, l) => s + l.annualCost, 0),
        lines: groups.get(cat)!.sort((a, b) => b.annualCost - a.annualCost),
      }));
  }, [breakdown.lines]);

  const sorted = sortMode === "cost"
    ? [...breakdown.lines].sort((a, b) => b.annualCost - a.annualCost)
    : null;

  return (
    <div className="overflow-hidden rounded-xl border hairline">
      {/* Sort toggle */}
      <div className="flex items-center gap-2 border-b hairline bg-panel2 px-4 py-2">
        <span className="text-[10px] text-faint mr-1">Group by:</span>
        {(["category", "cost"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setSortMode(m)}
            className={`figure rounded-md px-2.5 py-1 text-[11px] transition-colors ${
              sortMode === m ? "bg-signal text-ground" : "text-muted hover:text-ink"
            }`}
          >
            {m === "category" ? "category" : "cost ↓"}
          </button>
        ))}
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b hairline bg-panel2 text-left">
            <th className="px-4 py-2.5 eyebrow font-normal">Component</th>
            <th className="px-4 py-2.5 eyebrow font-normal">Class</th>
            <th className="px-4 py-2.5 eyebrow font-normal text-right">Annual</th>
            <th className="px-4 py-2.5 eyebrow font-normal text-right">Per call</th>
          </tr>
        </thead>

        {sortMode === "cost" && (
          <tbody>
            {sorted!.map((line) => (
              <React.Fragment key={line.componentId}>
                <tr
                  className="border-b hairline cursor-pointer hover:bg-panel2"
                  onClick={() => setOpen(open === line.componentId ? null : line.componentId)}
                >
                  <td className="px-4 py-2.5">
                    <div className="text-ink">{line.service}</div>
                    <div className="text-xs text-faint">
                      {line.provider} · {COST_CATEGORY_LABELS[line.category]}
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`figure rounded border px-1.5 py-0.5 text-[10px] ${
                        CLASS_BADGE[line.classification] ?? "text-muted border-line"
                      }`}
                    >
                      {line.classification.replace("_", "-")}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right figure text-ink">
                    {gbp(line.annualCost, { compact: true })}
                  </td>
                  <td className="px-4 py-2.5 text-right figure text-muted">
                    {gbp(line.perCall, { decimals: 4 })}
                  </td>
                </tr>
                {open === line.componentId && (
                  <ComponentEditor
                    line={line}
                    component={componentMap.get(line.componentId)}
                    onUpdateComponent={onUpdateComponent}
                    onDeleteComponent={onDeleteComponent}
                  />
                )}
              </React.Fragment>
            ))}
          </tbody>
        )}

        {sortMode === "category" &&
          grouped.map((group) => (
            <CategoryGroup
              key={group.category}
              group={group}
              breakdown={breakdown}
              componentMap={componentMap}
              open={open}
              setOpen={setOpen}
              onUpdateComponent={onUpdateComponent}
              onDeleteComponent={onDeleteComponent}
              dragId={dragId}
              setDragId={setDragId}
              dragOverCat={dragOverCat}
              setDragOverCat={setDragOverCat}
            />
          ))}

        <tfoot>
          <tr className="bg-panel2">
            <td className="px-4 py-3 eyebrow" colSpan={2}>
              Total cost of ownership
            </td>
            <td className="px-4 py-3 text-right figure text-signal text-base">
              {gbp(breakdown.totalAnnual, { compact: true })}
            </td>
            <td className="px-4 py-3" />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function CategoryGroup({
  group,
  breakdown,
  componentMap,
  open,
  setOpen,
  onUpdateComponent,
  onDeleteComponent,
  dragId,
  setDragId,
  dragOverCat,
  setDragOverCat,
}: {
  group: { category: CostCategory; label: string; color: string; total: number; lines: ComponentCostLine[] };
  breakdown: CostBreakdown;
  componentMap: Map<string, CostComponent>;
  open: string | null;
  setOpen: (id: string | null) => void;
  onUpdateComponent: (id: string, patch: Partial<CostComponent>) => void;
  onDeleteComponent: (id: string) => void;
  dragId: string | null;
  setDragId: (id: string | null) => void;
  dragOverCat: string | null;
  setDragOverCat: (cat: string | null) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const pct = ((group.total / breakdown.totalAnnual) * 100).toFixed(1);
  const isDragTarget = dragId && dragOverCat === group.category;
  const isDragSource = dragId && group.lines.some((l) => l.componentId === dragId);

  return (
    <tbody>
      {/* Category header */}
      <tr
        className={`border-b hairline cursor-pointer transition-colors ${
          isDragTarget
            ? "bg-signal/10 ring-1 ring-signal"
            : dragId
            ? "opacity-80"
            : "hover:bg-panel2"
        }`}
        onClick={() => setCollapsed(!collapsed)}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOverCat(group.category);
        }}
        onDragLeave={() => setDragOverCat(null)}
        onDrop={() => {
          if (dragId && dragId !== group.category) {
            onUpdateComponent(dragId, { category: group.category });
          }
          setDragId(null);
          setDragOverCat(null);
        }}
      >
        <td className="px-4 py-2.5" colSpan={4}>
          <div className="flex items-center gap-3">
            <span className="figure text-[10px] text-faint">{collapsed ? "▶" : "▼"}</span>
            <span className="h-3 w-3 rounded-sm shrink-0" style={{ backgroundColor: group.color }} />
            <span className="text-sm font-semibold text-ink">{group.label}</span>
            <span className="text-[10px] text-faint">{group.lines.length} components</span>
            {isDragTarget && (
              <span className="figure text-[10px] text-signal">drop here</span>
            )}
            <div className="ml-auto flex items-center gap-4">
              <span className="text-[10px] text-faint">{pct}%</span>
              <span className="figure text-sm text-signal">
                {gbp(group.total, { compact: true })}
              </span>
            </div>
          </div>
        </td>
      </tr>

      {/* Component rows (collapsed = hidden) */}
      {!collapsed &&
        group.lines.map((line) => (
          <React.Fragment key={line.componentId}>
            <tr
              className={`border-b hairline cursor-pointer transition-colors bg-ground/50 ${
                dragId === line.componentId ? "opacity-40" : "hover:bg-panel2"
              }`}
              draggable
              onDragStart={() => setDragId(line.componentId)}
              onDragEnd={() => { setDragId(null); setDragOverCat(null); }}
              onClick={() => setOpen(open === line.componentId ? null : line.componentId)}
            >
              <td className="px-4 py-2">
                <div className="flex items-center gap-2">
                  <span className="w-4" />
                  <span
                    className="figure cursor-grab text-[10px] text-faint hover:text-muted"
                    title="Drag to move category"
                  >
                    ⠿
                  </span>
                  <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: group.color }} />
                  <div>
                    <div className="text-xs text-ink">{line.service}</div>
                    <div className="text-[10px] text-faint">{line.provider}</div>
                  </div>
                </div>
              </td>
              <td className="px-4 py-2">
                <span
                  className={`figure rounded border px-1.5 py-0.5 text-[10px] ${
                    CLASS_BADGE[line.classification] ?? "text-muted border-line"
                  }`}
                >
                  {line.classification.replace("_", "-")}
                </span>
              </td>
              <td className="px-4 py-2 text-right figure text-xs text-ink">
                {gbp(line.annualCost, { compact: true })}
              </td>
              <td className="px-4 py-2 text-right figure text-xs text-muted">
                {gbp(line.perCall, { decimals: 4 })}
              </td>
            </tr>
            {open === line.componentId && (
              <ComponentEditor
                line={line}
                component={componentMap.get(line.componentId)}
                onUpdateComponent={onUpdateComponent}
                onDeleteComponent={onDeleteComponent}
              />
            )}
          </React.Fragment>
        ))}
    </tbody>
  );
}

function ComponentEditor({
  line,
  component,
  onUpdateComponent,
  onDeleteComponent,
}: {
  line: ComponentCostLine;
  component: CostComponent | undefined;
  onUpdateComponent: (id: string, patch: Partial<CostComponent>) => void;
  onDeleteComponent: (id: string) => void;
}) {
  if (!component) return null;
  const update = (patch: Partial<CostComponent>) => onUpdateComponent(line.componentId, patch);

  return (
    <tr className="border-b hairline bg-ground">
      <td colSpan={4} className="px-4 py-3">
        <div className="space-y-3">
          {/* Delete */}
          <div className="flex justify-end">
            <button
              onClick={() => onDeleteComponent(line.componentId)}
              className="figure rounded-lg border border-[#6b2f34] px-3 py-1 text-xs text-coral hover:bg-[#1a1015]"
            >
              delete component
            </button>
          </div>
          {/* Calculation trace */}
          <div className="rounded-lg border hairline bg-panel2 p-3">
            <div className="eyebrow mb-1.5">Calculation</div>
            <div className="figure text-xs text-muted">
              driver <span className="text-ink">{line.usageDriver}</span> ={" "}
              <span className="text-ink">{num(line.usageQuantity, 2)}</span>
            </div>
            <div className="figure mt-1 text-xs text-signal">{line.trace}</div>
            <div className="figure mt-1 text-xs text-ink">
              = {gbp(line.annualCost, { decimals: 2 })} / yr
            </div>
          </div>

          {/* Editable fields */}
          <div className="rounded-lg border hairline bg-panel2 p-3">
            <div className="eyebrow mb-2 text-[10px]">Component details</div>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              <InlineEdit
                label="Service"
                value={component.service}
                onChange={(v) => update({ service: v })}
              />
              <InlineEdit
                label="Provider"
                value={component.provider}
                onChange={(v) => update({ provider: v })}
              />
              <InlineEdit
                label="Description"
                value={component.description}
                onChange={(v) => update({ description: v })}
                full
              />
              <InlineSelect
                label="Category"
                value={component.category}
                onChange={(v) => update({ category: v as CostCategory })}
                options={CATEGORIES.map((c) => ({ value: c, label: COST_CATEGORY_LABELS[c] }))}
              />
              <InlineSelect
                label="Usage driver"
                value={component.usageDriver}
                onChange={(v) => update({ usageDriver: v as UsageDriver })}
                options={DRIVERS.map((d) => ({ value: d, label: d }))}
              />
              <InlineSelect
                label="Classification"
                value={component.classification}
                onChange={(v) => update({ classification: v as FixedVariableClass })}
                options={CLASSIFICATIONS.map((c) => ({ value: c, label: c.replace("_", "-") }))}
              />
              <InlineSelect
                label="Environment"
                value={component.environment}
                onChange={(v) => update({ environment: v as Environment })}
                options={ENVIRONMENTS.map((e) => ({ value: e, label: e.replace("_", " ") }))}
              />
              <InlineSelect
                label="Frequency"
                value={component.frequency}
                onChange={(v) => update({ frequency: v as Frequency })}
                options={FREQUENCIES.map((f) => ({ value: f, label: f.replace("_", " ") }))}
              />
              <InlineEdit
                label="Assumptions"
                value={component.assumptions}
                onChange={(v) => update({ assumptions: v })}
                full
              />
              <label className="flex items-center gap-2 text-xs text-muted cursor-pointer">
                <input
                  type="checkbox"
                  checked={component.enabled}
                  onChange={(e) => update({ enabled: e.target.checked })}
                  className="accent-signal"
                />
                Enabled
              </label>
            </div>
          </div>

          {/* Pricing */}
          <div className="rounded-lg border hairline bg-panel2 p-3">
            <PricingEditor
              pricing={component.pricing}
              onChange={(p) => update({ pricing: p })}
            />
          </div>
        </div>
      </td>
    </tr>
  );
}

/* ------------------------------------------------------------------ inline edit helpers */

function InlineEdit({
  label,
  value,
  onChange,
  full,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  full?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const commit = useCallback(() => {
    onChange(draft);
    setEditing(false);
  }, [draft, onChange]);

  const start = useCallback(() => {
    setDraft(value);
    setEditing(true);
  }, [value]);

  return (
    <div className={full ? "md:col-span-2" : ""}>
      <span className="text-[10px] text-faint">{label}</span>
      {editing ? (
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") { setDraft(value); setEditing(false); }
          }}
          className="figure ml-2 w-full max-w-xs rounded border border-signalDim bg-panel px-1.5 py-0.5 text-xs text-ink outline-none"
          autoFocus
        />
      ) : (
        <button
          type="button"
          onClick={start}
          className="ml-2 figure text-xs text-ink cursor-pointer hover:text-signal"
          title="Click to edit"
        >
          {value || <span className="text-faint">—</span>}
        </button>
      )}
    </div>
  );
}

function InlineSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div>
      <span className="text-[10px] text-faint">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="figure ml-2 rounded border hairline bg-panel px-1.5 py-0.5 text-xs text-ink outline-none focus:border-signalDim cursor-pointer max-w-[200px]"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}
