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

/**
 * The tour is built per role, from the same nav each role actually sees
 * (nav-config.ts). Two rules keep it honest:
 *
 *   Never point at something the role cannot reach. A clerk has no
 *   Callovers, Judgments, Case Law, or Search item, so a step for any of
 *   those would ring an empty space and then fall back to the More menu,
 *   teaching nothing. Conversely the clerk's own My Court Access page
 *   sits in the nav for clerks alone and is the single thing a new clerk
 *   most needs to find.
 *
 *   The board is shared ground. Clerks and magistrates both work the
 *   same sheet, so the docket steps are one list used by both, and only
 *   the surrounding chapters differ.
 */
export const walkthroughStepsFor = (
  role: UserRole | null | undefined,
  isPendingMagistrate: boolean,
): WalkthroughStep[] => {
  if (!role || isPendingMagistrate) return [];

  /** Worked by clerks and magistrates alike, so written for both. */
  const board: WalkthroughStep[] = [
    {
      id: "board",
      title: "Procedure board",
      body: "Each column is one stage; click a cell on a real file to record it. Arraignment also takes Not Found, To Be Summoned, so a file where service failed reads as stalled rather than untouched.",
      target: "docket-board",
      route: ROUTES.docket,
      chapter: "sitting",
    },
    {
      id: "outcome",
      title: "Outcome",
      body: "Closes a file at any stage: Dismissed in red, Completed in blue. Setting it also updates the matter's status, so reports stay accurate.",
      target: "docket-outcome",
      fallbackTarget: "docket-board",
      route: ROUTES.docket,
      chapter: "sitting",
    },
    {
      id: "next",
      title: "Next date",
      body: "Set the next hearing from this column. Capacity colours on the week strip show how full a day already is before you pick it.",
      target: "docket-next-date",
      fallbackTarget: "docket-board",
      route: ROUTES.docket,
      chapter: "sitting",
    },
  ];

  if (role === "clerk") {
    return [
      {
        id: "home",
        title: "Home",
        body: "Your docket work starts here. Open Docket when you are ready to handle files.",
        target: "home-billboard",
        route: ROUTES.dashboard,
        chapter: "sitting",
      },
      {
        id: "docket",
        title: "Docket",
        body: "The working sheet for every court you have been granted access to. Matters you cannot edit are still readable.",
        target: "docket-board",
        fallbackTarget: "docket-new-matter",
        route: ROUTES.docket,
        chapter: "sitting",
      },
      {
        id: "new-matter",
        title: "New matter",
        body: "Open a file on this court's sheet without leaving the list.",
        target: "docket-new-matter",
        fallbackTarget: "docket-board",
        route: ROUTES.docket,
        chapter: "sitting",
      },
      ...board,
      {
        id: "open-file",
        title: "Open a file",
        body: "Tap a case to open it. Parties, documents, and the hearing record live on the file, not on the board.",
        target: "matter-header",
        fallbackTarget: "docket-first-matter",
        route: ROUTES.docket,
        chapter: "sitting",
        requiresMatter: true,
      },
      {
        id: "chapter-rest",
        title: "That is the sheet",
        body: "Continue to see where court access and notifications live, or Done to finish.",
        target: "",
        chapter: "sitting",
        kind: "choice",
      },
      {
        id: "clerk-access",
        title: "My Court Access",
        body: "Request access to a court here. A magistrate or admin approves it, and the court then appears on your Docket.",
        target: "page-clerk-access",
        navTarget: "nav-clerk-access",
        fallbackTarget: "nav-more",
        route: ROUTES.clerkAccess,
        chapter: "rest",
        kind: "page",
      },
      {
        id: "notifications",
        title: "Notifications",
        body: "Approvals, assignments, and anything else needing your attention land here. The bell in the top bar shows the unread count.",
        target: "page-notifications",
        navTarget: "nav-notifications",
        fallbackTarget: "nav-more",
        route: ROUTES.notifications,
        chapter: "rest",
        kind: "page",
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
    ...board,
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
      body: "That is the sheet you work from. Continue for callovers, the calendar, research, and notes, or Done to finish.",
      target: "",
      chapter: "sitting",
      kind: "choice",
    },
  ];

  const rest: WalkthroughStep[] = [
    {
      id: "callovers",
      title: "Callovers",
      body: "For a batch sitting where matters are called over ahead of the usual flow. Build the running sheet, record each appearance, then export the report.",
      target: "page-callovers",
      navTarget: "nav-callovers",
      fallbackTarget: "nav-more",
      route: ROUTES.callovers,
      chapter: "rest",
      kind: "page",
    },
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
      id: "judgments",
      title: "Judgments",
      body: "Every judgment you have written, with version history. Draft one from a file so it stays attached to that matter.",
      target: "page-judgments",
      navTarget: "nav-judgments",
      fallbackTarget: "nav-more",
      route: ROUTES.judgments,
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
      id: "clerk-access-requests",
      title: "Clerk Access",
      body: "Clerks request access to a court; you approve or decline it here. Until you do, they cannot see that court's sheet.",
      target: "page-clerk-access-requests",
      navTarget: "nav-clerk-access-requests",
      fallbackTarget: "nav-more",
      route: ROUTES.clerkAccessRequests,
      chapter: "rest",
      kind: "page",
    },
    {
      id: "court-assignments",
      title: "Court Assignments",
      body: "The courts you sit, and where to request another. Your Docket and Callovers only ever show courts listed here.",
      target: "page-court-assignments",
      navTarget: "nav-court-assignments",
      fallbackTarget: "nav-more",
      route: ROUTES.courtAssignments,
      chapter: "rest",
      kind: "page",
    },
    {
      id: "search",
      title: "Search",
      body: "Find a matter, judgment, or statute without leaving the page you are on.",
      target: "page-search",
      navTarget: "nav-search",
      fallbackTarget: "nav-more",
      route: ROUTES.search,
      chapter: "rest",
      kind: "page",
    },
  ];

  if (role !== "admin") return [...sitting, ...rest];

  /**
   * An admin sees everything above plus a whole Administration group.
   * That group has seven destinations, and a step per destination would
   * double the tour to point at a menu the admin will open anyway. So:
   * the two with real workflow depth get a step, and the rest are named
   * in the step that rings the More menu they all live under.
   */
  const administration: WalkthroughStep[] = [
    {
      id: "legal-library",
      title: "Legal Library",
      body: "Where uploaded case law and legislation are reviewed before anyone else can read them. Drafts stay in the Review Queue until published.",
      target: "page-legal-library",
      navTarget: "nav-legal-library",
      fallbackTarget: "nav-more",
      route: ROUTES.adminLegalLibrary,
      chapter: "rest",
      kind: "page",
    },
    {
      id: "people",
      title: "People",
      body: "Accounts and roles. Changing someone's role changes what they see everywhere, so it takes effect on their next sign-in.",
      target: "page-people",
      navTarget: "nav-people",
      fallbackTarget: "nav-more",
      route: ROUTES.adminPeople,
      chapter: "rest",
      kind: "page",
    },
    {
      id: "administration",
      title: "The rest of Administration",
      body: "Court assignments, unresolved clerk access, issue reports, activity, and operations all live under More — grouped under Administration.",
      target: "nav-more",
      navTarget: "nav-more",
      fallbackTarget: "nav-search",
      route: ROUTES.adminOperations,
      chapter: "rest",
      kind: "page",
    },
  ];

  return [...sitting, ...rest, ...administration];
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
