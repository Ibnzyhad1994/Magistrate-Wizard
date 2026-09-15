import { useId } from "react";
import { Label } from "@/components/ui/label";
import {
  occupiedResolutionHint,
  occupiedResolutionLabel,
  type OccupiedCourtResolution,
} from "@/lib/occupied-court-exception";

export function OccupiedCourtResolutionFields(props: {
  value: OccupiedCourtResolution | "";
  onChange: (value: OccupiedCourtResolution) => void;
  disabled?: boolean;
  legend?: string;
  name?: string;
}) {
  const autoName = useId();
  const name = props.name ?? autoName;
  const legend = props.legend ?? "This court already has a signed-in primary magistrate.";
  return (
    <fieldset className="space-y-3 rounded-sm border border-[hsl(var(--notice-action)/0.35)] bg-[hsl(var(--notice-action)/0.08)] p-3">
      <legend className="px-1 text-sm font-medium text-foreground">{legend}</legend>
      <p className="text-xs text-muted-foreground">
        Only you can grant this exception. The request does not fill the court until you
        decide.
      </p>
      {(["replace", "co_sit"] as const).map((option) => (
        <label key={option} className="flex cursor-pointer items-start gap-2 text-sm">
          <input
            type="radio"
            name={name}
            className="mt-1"
            checked={props.value === option}
            disabled={props.disabled}
            onChange={() => props.onChange(option)}
          />
          <span>
            <span className="block font-medium text-foreground">
              {occupiedResolutionLabel(option)}
            </span>
            <span className="block text-xs text-muted-foreground">
              {occupiedResolutionHint(option)}
            </span>
          </span>
        </label>
      ))}
      <Label className="sr-only">Occupied-court resolution</Label>
    </fieldset>
  );
}
