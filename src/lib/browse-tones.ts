import type { LucideIcon } from "lucide-react";
import {
  Bookmark,
  BookOpen,
  Braces,
  Gavel,
  Scale,
  ScrollText,
  StickyNote,
} from "lucide-react";

export type TitleCardTone =
  | "docket"
  | "judgment"
  | "case-law"
  | "legislation"
  | "note"
  | "code"
  | "bookmark";

/** Cinematic poster fills used when there is no artwork. */
export const TONE_GRADIENT: Record<TitleCardTone, string> = {
  docket: "from-[#4a0d14] via-[#8b1530] to-[#1a0508]",
  judgment: "from-[#12182b] via-[#1c3a5f] to-[#0a1220]",
  "case-law": "from-[#0b2a1c] via-[#1a5c3a] to-[#05150d]",
  legislation: "from-[#1c1917] via-[#57534e] to-[#0c0a09]",
  note: "from-[#2a1a08] via-[#92400e] to-[#0c0804]",
  code: "from-[#1e1b4b] via-[#4338ca] to-[#0f0a1a]",
  bookmark: "from-[#3f1d0a] via-[#c2410c] to-[#1c0a05]",
};

/**
 * Welcome / detail heroes on the light canvas. Tiles keep TONE_GRADIENT
 * so posters stay cinematic; the billboard is a page surface and has to
 * follow the theme.
 */
export const TONE_GRADIENT_HERO: Record<TitleCardTone, string> = {
  docket:
    "from-[#f3e2e5] via-[#f7eef0] to-[hsl(var(--background))] dark:from-[#4a0d14] dark:via-[#8b1530] dark:to-[#1a0508]",
  judgment:
    "from-[#d9e4f2] via-[#eaf0f6] to-[hsl(var(--background))] dark:from-[#12182b] dark:via-[#1c3a5f] dark:to-[#0a1220]",
  "case-law":
    "from-[#dceee4] via-[#eaf4ee] to-[hsl(var(--background))] dark:from-[#0b2a1c] dark:via-[#1a5c3a] dark:to-[#05150d]",
  legislation:
    "from-[#e8e4df] via-[#f1eee9] to-[hsl(var(--background))] dark:from-[#1c1917] dark:via-[#57534e] dark:to-[#0c0a09]",
  note: "from-[#f3e6d4] via-[#f7f0e4] to-[hsl(var(--background))] dark:from-[#2a1a08] dark:via-[#92400e] dark:to-[#0c0804]",
  code: "from-[#e4e2f6] via-[#eeedf7] to-[hsl(var(--background))] dark:from-[#1e1b4b] dark:via-[#4338ca] dark:to-[#0f0a1a]",
  bookmark:
    "from-[#f3e0d4] via-[#f7ebe4] to-[hsl(var(--background))] dark:from-[#3f1d0a] dark:via-[#c2410c] dark:to-[#1c0a05]",
};

export const TONE_ICON: Record<TitleCardTone, LucideIcon> = {
  docket: Gavel,
  judgment: Scale,
  "case-law": BookOpen,
  legislation: ScrollText,
  note: StickyNote,
  code: Braces,
  bookmark: Bookmark,
};

export const TONE_LABEL: Record<TitleCardTone, string> = {
  docket: "Docket",
  judgment: "Judgment",
  "case-law": "Case Law",
  legislation: "Legislation",
  note: "Bench Note",
  code: "Quick Code",
  bookmark: "Bookmark",
};
