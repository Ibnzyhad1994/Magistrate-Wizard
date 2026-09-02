import {
  LayoutDashboard,
  ClipboardList,
  Scale,
  BookOpen,
  ScrollText,
  Braces,
  StickyNote,
  Bookmark,
  Search,
  Landmark,
  LibraryBig,
  CalendarDays,
  UserCheck,
  ShieldAlert,
  Bug,
  History,
  Users,
} from "lucide-react";
import { ROUTES } from "@/routes/paths";
import type { UserRole } from "@/lib/constants";
import type { NavItem } from "@/types";

export type NavGroupId = "court" | "research" | "workbench" | "admin";

export interface AppNavItem extends NavItem {
  group?: NavGroupId;
  /**
   * Stays visible even to a magistrate pending court approval (zero
   * currently-active magistrate_courts assignments — the locked-down
   * state routed everywhere else to /court-assignments). Only the Court
   * Assignments item itself should ever set this; every other item is
   * hidden for a pending magistrate, matching the route-level gate
   * (requireApprovedMagistrateCourt, router.tsx) so the nav never offers
   * a link that just bounces the user right back.
   */
  visibleWhilePending?: boolean;
}

export const NAV_GROUP_ORDER: NavGroupId[] = [
  "court",
  "research",
  "workbench",
  "admin",
];

export const NAV_GROUP_LABELS: Record<NavGroupId, string> = {
  court: "Court",
  research: "Research",
  workbench: "My work",
  admin: "Administration",
};

/**
 * Primary navigation. Sidebar, top bar, and the mobile hamburger all
 * render from this list. `group` is how the hamburger (and the desktop
 * More menu) clusters destinations so a magistrate can scan by job,
 * not by a flat dump of every route.
 */
export const NAV_ITEMS: AppNavItem[] = [
  {
    label: "Dashboard",
    href: ROUTES.dashboard,
    icon: LayoutDashboard,
  },
  {
    label: "Docket",
    href: ROUTES.docket,
    icon: ClipboardList,
    group: "court",
  },
  {
    label: "Calendar",
    href: ROUTES.calendar,
    icon: CalendarDays,
    roles: ["magistrate", "admin"],
    group: "court",
  },
  {
    label: "Clerk Access",
    href: ROUTES.clerkAccessRequests,
    icon: UserCheck,
    roles: ["magistrate", "admin"],
    group: "court",
  },
  {
    label: "Court Assignments",
    href: ROUTES.courtAssignments,
    icon: Landmark,
    roles: ["magistrate", "admin"],
    group: "court",
    visibleWhilePending: true,
  },
  {
    label: "Judgments",
    href: ROUTES.judgments,
    icon: Scale,
    roles: ["magistrate", "admin"],
    group: "court",
  },
  {
    label: "Case Law",
    href: ROUTES.caseLaw,
    icon: BookOpen,
    roles: ["magistrate", "admin"],
    group: "research",
  },
  {
    label: "Legislation",
    href: ROUTES.legislation,
    icon: ScrollText,
    roles: ["magistrate", "admin"],
    group: "research",
  },
  {
    label: "Bench Notes",
    href: ROUTES.benchNotes,
    icon: StickyNote,
    roles: ["magistrate", "admin"],
    group: "workbench",
  },
  {
    label: "Quick Codes",
    href: ROUTES.quickCodes,
    icon: Braces,
    roles: ["magistrate", "admin"],
    group: "workbench",
  },
  {
    label: "Bookmarks",
    href: ROUTES.bookmarks,
    icon: Bookmark,
    roles: ["magistrate", "admin"],
    group: "workbench",
  },
  {
    label: "Search",
    href: ROUTES.search,
    icon: Search,
    roles: ["magistrate", "admin"],
    group: "workbench",
  },
  {
    label: "Manage Court Assignments",
    href: ROUTES.adminCourtAssignments,
    icon: Landmark,
    roles: ["admin"],
    group: "admin",
  },
  {
    label: "Legal Library",
    href: ROUTES.adminLegalLibrary,
    icon: LibraryBig,
    roles: ["admin"],
    group: "admin",
  },
  {
    label: "Clerk Access: Unresolved",
    href: ROUTES.adminClerkAccess,
    icon: ShieldAlert,
    roles: ["admin"],
    group: "admin",
  },
  {
    label: "Issue Reports",
    href: ROUTES.adminIssueReports,
    icon: Bug,
    roles: ["admin"],
    group: "admin",
  },
  {
    label: "People",
    href: ROUTES.adminPeople,
    icon: Users,
    roles: ["admin"],
    group: "admin",
  },
  {
    label: "Activity",
    href: ROUTES.adminActivity,
    icon: History,
    roles: ["admin"],
    group: "admin",
  },
];

export const navItemLabel = (item: AppNavItem) =>
  item.label === "Dashboard" ? "Home" : item.label;

export const navTourIdForHref = (href: string): string | undefined => {
  if (href === ROUTES.dashboard) return "nav-home";
  if (href === ROUTES.docket) return "nav-docket";
  if (href === ROUTES.calendar) return "nav-calendar";
  if (href === ROUTES.judgments) return "nav-judgments";
  if (href === ROUTES.caseLaw) return "nav-case-law";
  if (href === ROUTES.legislation) return "nav-legislation";
  if (href === ROUTES.benchNotes) return "nav-bench-notes";
  if (href === ROUTES.search) return "nav-search";
  return undefined;
};

export const visibleNavItems = (
  items: AppNavItem[],
  role?: UserRole | null,
  isPendingMagistrate?: boolean,
) =>
  items.filter((item) => {
    if (item.roles && (role == null || !item.roles.includes(role))) return false;
    // Self-defending, matching resolveProtectedRouteGate's own pattern:
    // the pending-lockdown only ever applies when role is ACTUALLY
    // 'magistrate', regardless of what a caller passes for
    // isPendingMagistrate -- a caller mistake (e.g. forgetting its own
    // role check) can never over-restrict a clerk or admin.
    if (isPendingMagistrate && role === "magistrate" && !item.visibleWhilePending) return false;
    return true;
  });

export interface NavSection {
  id: NavGroupId;
  label: string;
  items: AppNavItem[];
}

export const groupNavItems = (items: AppNavItem[]) => {
  const ungrouped = items.filter((item) => !item.group);
  const groups: NavSection[] = NAV_GROUP_ORDER.map((id) => ({
    id,
    label: NAV_GROUP_LABELS[id],
    items: items.filter((item) => item.group === id),
  })).filter((section) => section.items.length > 0);

  return { ungrouped, groups };
};
