import { ROUTES } from "@/routes/paths";
import type { UserRole } from "@/lib/constants";

export const WALKTHROUGH_VERSION = 1;

const autoPlaySessions = new Set<string>();

export type WalkthroughRecord = {
  version: number;
  completedAt?: string;
  autoStartedAt?: string;
  awaitingAssignment?: boolean;
};

export const walkthroughStorageKey = (userId: string): string =>
  `magistrate-wizard-walkthrough:${userId}`;

export type WalkthroughStep = {
  id: string;
  title: string;
  body: string;
  target: string;
  fallbackTarget?: string;
  route?: string;
};

export const walkthroughStepsFor = (
  role: UserRole | null | undefined,
  isPendingMagistrate: boolean,
): WalkthroughStep[] => {
  if (!role || isPendingMagistrate) return [];

  if (role === "clerk") {
    return [
      {
        id: "home",
        title: "Home",
        body: "Your docket work starts here. Open Docket when you are ready to handle files.",
        target: "home-billboard",
        route: ROUTES.dashboard,
      },
      {
        id: "docket",
        title: "Docket",
        body: "This is the working sheet for the courts you can access. Create and update matters from here.",
        target: "docket-board",
        fallbackTarget: "docket-new-matter",
        route: ROUTES.docket,
      },
    ];
  }

  return [
    {
      id: "home",
      title: "Your week starts here",
      body: "New matter opens a file on the working sheet. Browse docket lists every matter you sit.",
      target: "home-billboard",
      route: ROUTES.dashboard,
    },
    {
      id: "docket",
      title: "Docket and New matter",
      body: "Docket is the sheet you work from. Use New matter to open a file without leaving the list.",
      target: "docket-new-matter",
      fallbackTarget: "docket-board",
      route: ROUTES.docket,
    },
    {
      id: "board",
      title: "Procedure board",
      body: "Empty cells say + Set arraignment and the rest. Click a cell to record that stage.",
      target: "docket-board",
      route: ROUTES.docket,
    },
    {
      id: "next",
      title: "Next date",
      body: "Set the next hearing from this column. Capacity colours on the calendar show how full that day is.",
      target: "docket-next-date",
      fallbackTarget: "docket-board",
      route: ROUTES.docket,
    },
    {
      id: "hearing",
      title: "Hearing progress",
      body: "Open a file to record witnesses and sitting notes on Overview. That is the hearing record.",
      target: "hearing-progress",
      fallbackTarget: "docket-board",
      route: ROUTES.docket,
    },
    {
      id: "more",
      title: "More",
      body:
        role === "admin"
          ? "Calendar, research, and Administration live under More."
          : "Calendar, research, and your notes live under More.",
      target: "nav-more",
    },
    {
      id: "search",
      title: "Search",
      body: "Find a matter, judgment, or statute without leaving the page you are on.",
      target: "nav-search",
    },
  ];
};

/**
 * Auto-play only for a magistrate who waited without a court on this
 * device, then received an assignment. Clerks, admins, and already-seated
 * magistrates never auto-start. Skip/complete or a prior auto-start
 * blocks later sessions; Settings and the account menu still replay.
 */
export function shouldAutoStartWalkthrough(args: {
  role: UserRole | null | undefined;
  isPendingMagistrate: boolean;
  record: WalkthroughRecord | null;
  sessionAutoPlay?: boolean;
}): boolean {
  if (args.role !== "magistrate") return false;
  if (args.isPendingMagistrate) return false;
  if (args.record?.completedAt) return false;
  if (args.record?.awaitingAssignment === true && !args.record.autoStartedAt) return true;
  return Boolean(args.sessionAutoPlay && args.record?.autoStartedAt);
}

export function walkthroughRecordForPending(
  existing: WalkthroughRecord | null,
): WalkthroughRecord {
  if (existing?.completedAt || existing?.autoStartedAt) {
    return existing;
  }
  if (existing?.awaitingAssignment) return existing;
  return {
    version: WALKTHROUGH_VERSION,
    awaitingAssignment: true,
  };
}

export function walkthroughRecordAfterAutoStart(
  existing: WalkthroughRecord | null,
  at: string,
): WalkthroughRecord {
  return {
    version: WALKTHROUGH_VERSION,
    completedAt: existing?.completedAt,
    awaitingAssignment: false,
    autoStartedAt: existing?.autoStartedAt ?? at,
  };
}

export function walkthroughRecordAfterComplete(
  existing: WalkthroughRecord | null,
  at: string,
): WalkthroughRecord {
  return {
    version: WALKTHROUGH_VERSION,
    completedAt: at,
    autoStartedAt: existing?.autoStartedAt,
    awaitingAssignment: false,
  };
}

export function markWalkthroughAutoPlaySession(userId: string): void {
  autoPlaySessions.add(userId);
}

export function hasWalkthroughAutoPlaySession(userId: string): boolean {
  return autoPlaySessions.has(userId);
}

export function clearWalkthroughAutoPlaySessions(): void {
  autoPlaySessions.clear();
}
