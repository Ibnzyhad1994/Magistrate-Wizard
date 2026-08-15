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
  legislation: "/legislation",
  legislationDetail: (id: string) => `/legislation/${id}`,
  legislationProvision: (statuteId: string, provisionId: string) =>
    `/legislation/${statuteId}/section/${provisionId}`,
  adminLegalLibrary: "/admin/legal-library",
  /** Deep link straight into the Review Queue tab for one specific draft — the correct destination for anything not yet published (see legal-library-admin-page.tsx's handling of the `tab`/`caseLaw` search params). Never use `caseLawDetail` for a draft/needs_review record — that route is the read-only canonical reader and cannot edit a canonical (owner_id IS NULL) row at all. `fromBatchId` (optional) carries the originating batch through so the Review Queue card can offer "Back to batch" instead of stranding the curator with only the generic Review Queue list to return to (Section 12). */
  adminLegalLibraryReviewCaseLaw: (caseLawId: string, fromBatchId?: string) =>
    `/admin/legal-library?tab=review&caseLaw=${caseLawId}${fromBatchId ? `&batch=${fromBatchId}` : ""}`,
  adminLegalLibraryReviewStatute: (statuteId: string, fromBatchId?: string) =>
    `/admin/legal-library?tab=review&statute=${statuteId}${fromBatchId ? `&batch=${fromBatchId}` : ""}`,
  adminLegalLibraryBatch: (batchId: string) => `/admin/legal-library?tab=batches&batch=${batchId}`,
  quickCodes: "/quick-codes",
  benchNotes: "/bench-notes",
  benchNoteDetail: (id: string) => `/bench-notes/${id}`,
  bookmarks: "/bookmarks",
  search: "/search",
  settings: "/settings",
  adminCourtAssignments: "/admin/court-assignments",
  login: "/login",
  register: "/register",
  forgotPassword: "/forgot-password",
  unauthorized: "/unauthorized",
  notFound: "*",
} as const;

export type RoutePath = (typeof ROUTES)[keyof typeof ROUTES];
