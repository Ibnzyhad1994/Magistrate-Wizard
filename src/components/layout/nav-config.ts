import { LayoutDashboard, Gavel } from "lucide-react";
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
];
