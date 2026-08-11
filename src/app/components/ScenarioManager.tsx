"use client";

import React, { useState, useCallback } from "react";
import type { Scenario } from "../../domain/types";

export function ScenarioManager({
  scenarios,
  activeId,
  onLoad,
  onNew,
  onSave,
  onDelete,
}: {
  scenarios: Scenario[];
  activeId: string;
  onLoad: (id: string) => void;
  onNew: () => void;
  onSave: (name: string) => void;
  onDelete: (id: string) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");

  const handleSave = useCallback(() => {
    if (name.trim()) {
      onSave(name.trim());
      setName("");
      setSaving(false);
    }
  }, [name, onSave]);

  return (
    <div className="space-y-3">
      {/* Scenario selector */}
      <div className="flex gap-2">
        <select
          value={activeId}
          onChange={(e) => onLoad(e.target.value)}
          className="figure flex-1 rounded-lg border hairline bg-panel2 px-3 py-2 text-sm text-ink outline-none focus:border-signalDim cursor-pointer"
        >
          {scenarios.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <button
          onClick={onNew}
          className="figure shrink-0 rounded-lg border border-signalDim px-3 py-2 text-sm text-signal hover:bg-panel2"
          title="New blank scenario"
        >
          + new
        </button>
      </div>

      {/* Save */}
      {saving ? (
        <div className="flex gap-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Scenario name"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave();
              if (e.key === "Escape") { setSaving(false); setName(""); }
            }}
            className="figure flex-1 rounded-lg border border-signalDim bg-panel px-3 py-2 text-sm text-ink outline-none"
            autoFocus
          />
          <button
            onClick={handleSave}
            disabled={!name.trim()}
            className="figure rounded-lg bg-signal px-3 py-2 text-sm text-ground disabled:opacity-30"
          >
            save
          </button>
        </div>
      ) : (
        <button
          onClick={() => setSaving(true)}
          className="figure w-full rounded-lg border border-signalDim px-3 py-2 text-sm text-signal hover:bg-panel2"
        >
          save current as
        </button>
      )}

      {/* Delete */}
      {scenarios.length > 1 && (
        <button
          onClick={() => onDelete(activeId)}
          className="figure w-full rounded-lg border border-[#6b2f34] px-3 py-2 text-sm text-coral hover:bg-[#1a1015]"
        >
          delete "{scenarios.find((s) => s.id === activeId)?.name ?? "scenario"}"
        </button>
      )}
    </div>
  );
}
