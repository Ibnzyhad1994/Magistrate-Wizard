import { Contrast, Eye, Monitor, Moon, Sun } from "lucide-react";
import {
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ACCESSIBLE_THEMES,
  APPEARANCE_THEMES,
  THEME_LABELS,
  isTheme,
  type Theme,
} from "@/lib/theme";
import { useTheme } from "@/providers/use-theme";

function ThemeIcon({ option }: { option: Theme }) {
  const className = "mr-2 inline size-4";
  if (option === "dark") return <Moon className={className} />;
  if (option === "light") return <Sun className={className} />;
  if (option === "system") return <Monitor className={className} />;
  if (option === "colourblind" || option === "colourblind-light") {
    return <Eye className={className} />;
  }
  return <Contrast className={className} />;
}

/**
 * Account-menu theme picker. Available to every signed-in role, including
 * a pending magistrate who cannot open Settings.
 */
export function ThemeMenuSub() {
  const { theme, setTheme } = useTheme();

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className="gap-2 [&_svg]:size-4 [&_svg]:shrink-0">
        <Sun className="dark:hidden" />
        <Moon className="hidden dark:block" />
        Theme
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <DropdownMenuRadioGroup
          value={theme}
          onValueChange={(value) => {
            if (isTheme(value)) setTheme(value);
          }}
        >
          <DropdownMenuLabel className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Appearance
          </DropdownMenuLabel>
          {APPEARANCE_THEMES.map((option) => (
            <DropdownMenuRadioItem key={option} value={option}>
              <ThemeIcon option={option} />
              {THEME_LABELS[option]}
            </DropdownMenuRadioItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Accessible
          </DropdownMenuLabel>
          {ACCESSIBLE_THEMES.map((option) => (
            <DropdownMenuRadioItem key={option} value={option}>
              <ThemeIcon option={option} />
              {THEME_LABELS[option]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
