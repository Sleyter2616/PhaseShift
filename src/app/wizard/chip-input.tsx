"use client";

import { useState } from "react";

interface ChipInputProps {
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  minItems?: number;
  maxItems?: number;
  getItemError?: (value: string) => string | null;
}

export function ChipInput({
  values,
  onChange,
  placeholder = "Type and press Enter",
  minItems,
  maxItems,
  getItemError,
}: ChipInputProps) {
  const [draft, setDraft] = useState("");

  function addChip() {
    const trimmed = draft.trim();
    if (!trimmed || values.includes(trimmed)) return;
    if (maxItems != null && values.length >= maxItems) return;
    onChange([...values, trimmed]);
    setDraft("");
  }

  function removeChip(index: number) {
    onChange(values.filter((_, i) => i !== index));
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {values.map((value, index) => {
          const error = getItemError?.(value) ?? null;
          return (
            <button
              key={`${value}-${index}`}
              type="button"
              onClick={() => removeChip(index)}
              className={`rounded-full border px-3 py-1 text-sm ${
                error
                  ? "border-red-500 text-red-800"
                  : "border-neutral-300 bg-neutral-50 text-neutral-800"
              }`}
              title={error ?? "Click to remove"}
            >
              {value}
              {error ? ` — ${error}` : " ×"}
            </button>
          );
        })}
      </div>
      <input
        type="text"
        value={draft}
        placeholder={placeholder}
        disabled={maxItems != null && values.length >= maxItems}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            addChip();
          }
        }}
        className="w-full rounded border border-neutral-300 px-3 py-2 text-sm"
      />
      {minItems != null || maxItems != null ? (
        <p className="text-xs text-neutral-500">
          {values.length} item{values.length === 1 ? "" : "s"}
          {minItems != null ? ` (min ${minItems}` : ""}
          {maxItems != null ? `${minItems != null ? ", " : " ("}max ${maxItems}` : ""}
          {minItems != null || maxItems != null ? ")" : ""}
        </p>
      ) : null}
    </div>
  );
}
