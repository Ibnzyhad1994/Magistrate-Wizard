import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { DetailsHint } from "@/components/common/details-hint";
import { cn } from "@/lib/utils";
import {
  ACCESSIBLE_THEMES,
  APPEARANCE_THEMES,
  THEME_LABELS,
  isTheme,
} from "@/lib/theme";
import { useTheme } from "@/providers/use-theme";

const THEME_SUMMARY = "Dark is the default.";
const THEME_DETAILS =
  "System follows this device, including high contrast when the OS asks for it. Also available from the account menu.";

interface ThemeSelectProps {
  id: string;
  className?: string;
}

/**
 * Theme control for signed-in Settings. Pending magistrates who cannot
 * open Settings use the account menu instead.
 */
export function ThemeSelect({ id, className }: ThemeSelectProps) {
  const { theme, setTheme } = useTheme();

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-center gap-0.5">
        <Label htmlFor={id}>Theme</Label>
        <DetailsHint label="More about themes" details={THEME_DETAILS} />
      </div>
      <Select
        id={id}
        className="max-w-xs"
        value={theme}
        onChange={(e) => {
          if (isTheme(e.target.value)) setTheme(e.target.value);
        }}
        aria-label="Theme"
      >
        <optgroup label="Appearance">
          {APPEARANCE_THEMES.map((option) => (
            <option key={option} value={option}>
              {THEME_LABELS[option]}
            </option>
          ))}
        </optgroup>
        <optgroup label="Accessible">
          {ACCESSIBLE_THEMES.map((option) => (
            <option key={option} value={option}>
              {THEME_LABELS[option]}
            </option>
          ))}
        </optgroup>
      </Select>
      <p className="text-[11px] text-muted-foreground">{THEME_SUMMARY}</p>
    </div>
  );
}
