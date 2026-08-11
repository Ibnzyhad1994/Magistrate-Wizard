import { useMemo, useState } from "react";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";

const OTHER_VALUE = "__other__";
const NONE_VALUE = "__none__";

interface ControlledVocabSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: readonly string[];
  placeholder?: string;
  otherLabel?: string;
  /** Underlying DB column is unconstrained free text, so this is a UI
   * convenience only — any pre-existing value not in `options` (including
   * legacy free-text data from before this control existed) is preserved
   * exactly as-is by defaulting into "Other" mode with the original text,
   * never silently dropped or coerced onto the nearest canonical term. */
  disabled?: boolean;
}

/**
 * A canonical-list Select with an "Other" escape hatch that reveals a
 * free-text input — the shared pattern for Part D's controlled
 * vocabularies (Event Type, Stage at Event) and reusable anywhere else a
 * curated-but-not-rigid category is needed. Does NOT enforce a DB CHECK
 * constraint; the column stays plain `text` so no existing value can be
 * rejected or lost. Encourages canonical terms without making them
 * mandatory.
 */
export function ControlledVocabSelect({
  value,
  onChange,
  options,
  placeholder = "Select…",
  otherLabel = "Other (specify)",
  disabled,
}: ControlledVocabSelectProps) {
  const isCanonical = value !== "" && options.includes(value);
  const [customMode, setCustomMode] = useState(value !== "" && !isCanonical);

  const selectValue = useMemo(() => {
    if (customMode) return OTHER_VALUE;
    if (!value) return NONE_VALUE;
    return isCanonical ? value : OTHER_VALUE;
  }, [customMode, value, isCanonical]);

  return (
    <div className="space-y-2">
      <Select
        disabled={disabled}
        value={selectValue}
        onChange={(e) => {
          const next = e.target.value;
          if (next === OTHER_VALUE) {
            setCustomMode(true);
            // Keep any existing custom text; otherwise start blank so the
            // text input below appears ready for input.
            if (isCanonical) onChange("");
            return;
          }
          setCustomMode(false);
          onChange(next === NONE_VALUE ? "" : next);
        }}
      >
        <option value={NONE_VALUE}>{placeholder}</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
        <option value={OTHER_VALUE}>{otherLabel}</option>
      </Select>
      {customMode && (
        <Input
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Enter a custom value…"
          maxLength={200}
        />
      )}
    </div>
  );
}
