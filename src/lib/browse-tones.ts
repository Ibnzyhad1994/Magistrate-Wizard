import type { LucideIcon } from "lucide-react";
import { Bookmark, BookOpen, Braces, Gavel, Scale, ScrollText, StickyNote } from "lucide-react";

export type TitleCardTone =
  "docket" | "judgment" | "case-law" | "legislation" | "note" | "code" | "bookmark";

/**
 * A poster's words sit on its art, so they sit on a scrim: a short fade,
 * then a gradient that never drops below 80% black under any line of text.
 * White words keep their contrast over the lightest tone, the tone icon
 * and a cover inset alike (npm run test:tile-style computes each ink).
 */
export const POSTER_SCRIM_FADE_CLASS = "bg-gradient-to-t from-black/80 to-transparent";
export const POSTER_SCRIM_CLASS = "bg-gradient-to-t from-black/90 to-black/80";
export const POSTER_INK = {
  kicker: "text-primary-foreground/80",
  title: "text-primary-foreground",
  subtitle: "text-primary-foreground/85",
  meta: "text-primary-foreground/75",
} as const;

/**
 * The tone's hue as a CSS custom-property reference (index.css defines
 * `--tone-*` once, theme-invariant). Set it as `--band` on an element
 * carrying `.tone-band` (a page header wash, at the palette's `--tone-alpha`)
 * or `.tone-art` (a browse tile's or the Home hero's art, at the palette's
 * `--art-*` stops), so both follow the palette rather than a fixed hex.
 */
export const TONE_HSL_VAR: Record<TitleCardTone, string> = {
  docket: "var(--tone-docket)",
  judgment: "var(--tone-judgment)",
  "case-law": "var(--tone-case-law)",
  legislation: "var(--tone-legislation)",
  note: "var(--tone-note)",
  code: "var(--tone-code)",
  bookmark: "var(--tone-bookmark)",
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
