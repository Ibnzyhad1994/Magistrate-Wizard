import * as Sentry from "@sentry/react";

/**
 * Read lazily and defensively: under plain Node (the scripts/tests
 * harness imports `@/lib/utils`, which imports this module) `import.meta.env`
 * is undefined, and this module must stay importable there.
 */
const env = (import.meta.env ?? {}) as Record<string, string | undefined>;

let initialised = false;

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// Three base64url segments separated by dots: a JWT (or anything shaped
// like one, which is the right side to err on).
const JWT_RE = /\b[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g;

export function scrubText(value: string): string {
  return value.replace(EMAIL_RE, "[email]").replace(JWT_RE, "[token]");
}

function scrubDeep<T>(value: T, depth = 0): T {
  if (depth > 6) return value;
  if (typeof value === "string") return scrubText(value) as T;
  if (Array.isArray(value)) return value.map((item) => scrubDeep(item, depth + 1)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = scrubDeep(item, depth + 1);
    }
    return out as T;
  }
  return value;
}

/** Strip emails and JWT-looking strings before an event leaves the device. */
export function scrubEvent<E extends Sentry.ErrorEvent>(event: E): E {
  if (event.message) event.message = scrubText(event.message);
  for (const exception of event.exception?.values ?? []) {
    if (exception.value) exception.value = scrubText(exception.value);
  }
  if (event.extra) event.extra = scrubDeep(event.extra);
  if (event.breadcrumbs) {
    for (const crumb of event.breadcrumbs) {
      if (crumb.message) crumb.message = scrubText(crumb.message);
      if (crumb.data) crumb.data = scrubDeep(crumb.data);
    }
  }
  if (event.request?.url) event.request.url = scrubText(event.request.url);
  return event;
}

/** No-op when `VITE_SENTRY_DSN` is unset so local/dev stays quiet. */
export function initSentry(): void {
  const dsn = env.VITE_SENTRY_DSN;
  if (!dsn) return;
  const configuredRate = Number(env.VITE_SENTRY_TRACES_SAMPLE_RATE);
  Sentry.init({
    dsn,
    environment: env.MODE,
    // Explicit so a future integration cannot silently switch tracing on
    // at 100 %. Performance tracing is not enabled today (no tracing
    // integration is registered); this only governs it once one is.
    tracesSampleRate: Number.isFinite(configuredRate) ? configuredRate : 0.1,
    sendDefaultPii: false,
    beforeSend: (event) => scrubEvent(event),
  });
  initialised = true;
}

export interface ReportErrorContext {
  /** Where the error was caught: a query, a mutation, a render boundary, a mapping fallback. */
  source: "query" | "mutation" | "render" | "error-message" | (string & {});
  /** Query/mutation key, constraint name, or another short identifier. */
  key?: unknown;
  [extra: string]: unknown;
}

/**
 * Single funnel for "something went wrong and a human should know about
 * it": captures to Sentry when it is initialised, otherwise logs so local
 * dev still sees the raw failure. Safe to call from anywhere, including
 * module scope and Node test harnesses.
 */
export function reportError(error: unknown, context: ReportErrorContext): void {
  const { source, ...extra } = context;
  if (initialised) {
    Sentry.captureException(error, {
      tags: { source },
      extra: scrubDeep(extra),
    });
    return;
  }
  console.error(`[${source}]`, error, extra);
}

/** Only the stable id is attached — never the email or name. */
export function setSentryUser(user: { id: string } | null): void {
  if (!initialised) return;
  Sentry.setUser(user ? { id: user.id } : null);
}

export function reportRenderError(
  error: Error,
  errorInfo: { componentStack?: string | null },
): void {
  reportError(error, { source: "render", componentStack: errorInfo.componentStack });
}
