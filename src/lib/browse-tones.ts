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
