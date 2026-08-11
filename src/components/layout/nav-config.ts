import {
  LayoutDashboard,
  Gavel,
  Scale,
  BookOpen,
  Braces,
  StickyNote,
  Bookmark,
} from "lucide-react";
import { ROUTES } from "@/routes/paths";
import type { NavItem } from "@/types";

/**
 * Primary sidebar navigation. Extend this list as feature areas (Case
 * Law research, Bench Notes, Quick Codes, etc.) are built in later
 * phases — the sidebar and mobile nav both render from this single
 * source.
 */
export const NAV_ITEMS: NavItem[] = [
  {
    label: "Dashboard",
    href: ROUTES.dashboard,
    icon: LayoutDashboard,
  },
  {
    label: "Docket",
    href: ROUTES.docket,
    icon: Gavel,
  },
  {
    label: "Judgments",
    href: ROUTES.judgments,
    icon: Scale,
  },
  {
    label: "Case Law",
    href: ROUTES.caseLaw,
    icon: BookOpen,
  },
  {
    label: "Quick Codes",
    href: ROUTES.quickCodes,
    icon: Braces,
  },
  {
    label: "Bench Notes",
    href: ROUTES.benchNotes,
    icon: StickyNote,
  },
  {
    label: "Bookmarks",
    href: ROUTES.bookmarks,
    icon: Bookmark,
  },
];
