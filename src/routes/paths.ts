/**
 * Centralized route path constants. Import these instead of hardcoding
 * strings so route changes only need to happen in one place.
 */
export const ROUTES = {
  home: "/",
  dashboard: "/dashboard",
  docket: "/docket",
  docketMatter: (id: string) => `/docket/${id}`,
  judgments: "/judgments",
  judgmentDetail: (id: string) => `/judgments/${id}`,
  caseLaw: "/case-law",
  caseLawDetail: (id: string) => `/case-law/${id}`,
  quickCodes: "/quick-codes",
  benchNotes: "/bench-notes",
  benchNoteDetail: (id: string) => `/bench-notes/${id}`,
  bookmarks: "/bookmarks",
  search: "/search",
  login: "/login",
  register: "/register",
  forgotPassword: "/forgot-password",
  unauthorized: "/unauthorized",
  notFound: "*",
} as const;

export type RoutePath = (typeof ROUTES)[keyof typeof ROUTES];
