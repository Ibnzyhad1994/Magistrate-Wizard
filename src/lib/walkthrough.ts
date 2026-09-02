import { ROUTES } from "@/routes/paths";
import type { UserRole } from "@/lib/constants";

export const WALKTHROUGH_VERSION = 1;
export const FIRST_MATTER_TOUR_ID = "docket-first-matter";

const autoPlaySessions = new Set<string>();

export type WalkthroughRecord = {
  version: number;
  completedAt?: string;
  autoStartedAt?: string;
  awaitingAssignment?: boolean;
};

export const walkthroughStorageKey = (userId: string): string =>
  `magistrate-wizard-walkthrough:${userId}`;

export type WalkthroughChapter = "sitting" | "rest";

export type WalkthroughStep = {
  id: string;
  title: string;
  body: string;
  target: string;
  fallbackTarget?: string;
  route?: string;
  chapter?: WalkthroughChapter;
  requiresMatter?: boolean;
  kind?: "spotlight" | "choice" | "page";
  navTarget?: string;
};

export const docketMatterPathFromLocation = (pathname: string): string | null => {
  if (pathname === ROUTES.docket) return null;
  if (pathname === ROUTES.docketBin || pathname.startsWith(`${ROUTES.docketBin}/`)) return null;
  const match = pathname.match(/^\/docket\/([^/]+)$/);
  return match ? pathname : null;
};

export const visibleWalkthroughSteps = (
  steps: WalkthroughStep[],
  chapter: WalkthroughChapter,
  hasMatter: boolean,
): WalkthroughStep[] => {
  if (chapter === "rest") return steps.filter((step) => step.chapter === "rest");
  return steps.filter((step) => {
    if (step.chapter === "rest") return false;
    if (step.requiresMatter && !hasMatter) return false;
    return true;
  });
};

export const walkthroughStepRoute = (
  step: WalkthroughStep,
  matterPath: string | null,
): string | undefined => {
  if (step.requiresMatter && matterPath) return matterPath;
  return step.route;
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

  const sitting: WalkthroughStep[] = [
    {
      id: "home",
      title: "Your week starts here",
      body: "New matter opens a file on the working sheet. Browse docket lists every matter you sit.",
      target: "home-billboard",
      route: ROUTES.dashboard,
      chapter: "sitting",
    },
    {
      id: "docket",
      title: "Docket and New matter",
      body: "Docket is the sheet you work from. Use New matter to open a file without leaving the list.",
      target: "docket-new-matter",
      fallbackTarget: "docket-board",
      route: ROUTES.docket,
      chapter: "sitting",
    },
    {
      id: "board",
      title: "Procedure board",
      body: "Empty cells say + Set arraignment and the rest. Click a cell to record that stage.",
      target: "docket-board",
      route: ROUTES.docket,
      chapter: "sitting",
    },
    {
      id: "next",
      title: "Next date",
      body: "Set the next hearing from this column. Capacity colours on the calendar show how full that day is.",
      target: "docket-next-date",
      fallbackTarget: "docket-board",
      route: ROUTES.docket,
      chapter: "sitting",
    },
    {
      id: "open-file",
      title: "Open a file",
      body: "Tap a case to open the file. Overview holds the charge, procedure, and hearing record.",
      target: "matter-header",
      fallbackTarget: "docket-first-matter",
      route: ROUTES.docket,
      chapter: "sitting",
      requiresMatter: true,
    },
    {
      id: "hearing",
      title: "Hearing progress",
      body: "Record witnesses and sitting notes here. That is the hearing record.",
      target: "hearing-progress",
      fallbackTarget: "matter-header",
      route: ROUTES.docket,
      chapter: "sitting",
      requiresMatter: true,
    },
    {
      id: "file",
      title: "The file",
      body: "Hearing dates, parties, documents, and judgments live on this page, not on the board.",
      target: "matter-tabs",
      fallbackTarget: "matter-header",
      route: ROUTES.docket,
      chapter: "sitting",
      requiresMatter: true,
    },
    {
      id: "chapter-rest",
      title: "Sitting day",
      body: "That is the sheet you work from. Continue for Calendar, research, and notes, or Done to finish.",
      target: "",
      chapter: "sitting",
      kind: "choice",
    },
  ];

  const rest: WalkthroughStep[] = [
    {
      id: "calendar",
      title: "Calendar",
      body: "Hearings you can already see on the Docket appear here. Capacity still lives on the Docket week strip.",
      target: "page-calendar",
      navTarget: "nav-calendar",
      fallbackTarget: "nav-more",
      route: ROUTES.calendar,
      chapter: "rest",
      kind: "page",
    },
    {
      id: "case-law",
      title: "Case Law",
      body: "The shared library and your own research live here. Pin an authority onto a file from the file itself.",
      target: "page-case-law",
      navTarget: "nav-case-law",
      fallbackTarget: "nav-more",
      route: ROUTES.caseLaw,
      chapter: "rest",
      kind: "page",
    },
    {
      id: "legislation",
      title: "Legislation",
      body: "Acts and other instruments every magistrate can read. Open one to search inside the text.",
      target: "page-legislation",
      navTarget: "nav-legislation",
      fallbackTarget: "nav-more",
      route: ROUTES.legislation,
      chapter: "rest",
      kind: "page",
    },
    {
      id: "bench-notes",
      title: "Bench Notes",
      body: "Your notes stay yours. Attach them to a file, a judgment, or an authority when you need them later.",
      target: "page-bench-notes",
      navTarget: "nav-bench-notes",
      fallbackTarget: "nav-more",
      route: ROUTES.benchNotes,
      chapter: "rest",
      kind: "page",
    },
    {
      id: "search",
      title: "Search",
      body:
        role === "admin"
          ? "Find a matter, judgment, or statute without leaving the page you are on. Administration lives under More."
          : "Find a matter, judgment, or statute without leaving the page you are on.",
      target: "page-search",
      navTarget: "nav-search",
      fallbackTarget: "nav-more",
      route: ROUTES.search,
      chapter: "rest",
      kind: "page",
    },
  ];

  return [...sitting, ...rest];
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
