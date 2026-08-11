"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";

export function Slider({
  label,
  description,
  value,
  min,
  max,
  step,
  onChange,
  format,
}: {
  label: string;
  description?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format: (v: number) => string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      setDraft(String(value));
      inputRef.current?.select();
    }
  }, [editing, value]);

  const commit = useCallback(() => {
    const n = Number(draft);
    if (!isNaN(n)) {
      onChange(Math.min(max, Math.max(min, n)));
    }
    setEditing(false);
  }, [draft, min, max, onChange]);

  const cancel = useCallback(() => {
    setDraft(String(value));
    setEditing(false);
  }, [value]);

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <label className="text-xs text-muted">{label}</label>
        {editing ? (
          <input
            ref={inputRef}
            type="number"
            min={min}
            max={max}
            step={step}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") cancel();
            }}
            className="figure w-24 rounded border border-signalDim bg-panel2 px-2 py-0.5 text-sm text-signal outline-none"
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="figure text-sm text-signal cursor-pointer hover:text-signal/80 transition-colors"
            title="Click to edit"
          >
            {format(value)}
          </button>
        )}
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-line accent-signal"
        aria-label={label}
      />
      {description && (
        <p className="mt-1 text-[10px] leading-relaxed text-ink/70">{description}</p>
      )}
    </div>
  );
}

export function NumberField({
  label,
  value,
  onChange,
  suffix,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  suffix?: string;
  step?: number;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs text-muted">{label}</label>
      <div className="flex items-center rounded-lg border hairline bg-panel2 px-3">
        <input
          type="number"
          value={value}
          step={step}
          onChange={(e) => onChange(Number(e.target.value))}
          className="figure w-full bg-transparent py-2 text-sm text-ink outline-none"
        />
        {suffix && <span className="text-xs text-faint">{suffix}</span>}
      </div>
    </div>
  );
}
