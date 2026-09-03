/**
 * Idle lock and Remember-me timings. Pure functions so tests can pin `now`.
 *
 * Idle is client-side on purpose: GoTrue `inactivity_timeout` would kill
 * refresh tokens after an hour away and break 14-day Remember me.
 * Hosted JWT expiry should stay 3600s (access token); this module does
 * not change that.
 */

export const DEFAULT_IDLE_MS = 60 * 60 * 1000
export const WARN_BEFORE_MS = 5 * 60 * 1000
export const REMEMBER_MS = 14 * 24 * 60 * 60 * 1000
export const ACTIVITY_THROTTLE_MS = 30_000

export type IdlePhase = "ok" | "warn" | "lock"

export function resolveIdleTimeoutMs(raw: string | undefined): number {
  if (raw == null || raw === "") return DEFAULT_IDLE_MS
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed < 1_000) return DEFAULT_IDLE_MS
  return parsed
}

export function getIdleTimeoutMs(): number {
  const env = typeof import.meta !== "undefined" ? import.meta.env : undefined
  const raw =
    env && typeof env.VITE_IDLE_TIMEOUT_MS === "string"
      ? env.VITE_IDLE_TIMEOUT_MS
      : undefined
  return resolveIdleTimeoutMs(raw)
}

export function evaluateSessionIdle(args: {
  lastActivityAt: number
  now: number
  idleMs?: number
  warnBeforeMs?: number
}): IdlePhase {
  const idleMs = args.idleMs ?? DEFAULT_IDLE_MS
  const warnBeforeMs = args.warnBeforeMs ?? WARN_BEFORE_MS
  const elapsed = args.now - args.lastActivityAt
  if (elapsed >= idleMs) return "lock"
  if (elapsed >= idleMs - warnBeforeMs) return "warn"
  return "ok"
}

/**
 * Overnight Remember-me restore starts a fresh idle clock. Idle only
 * applies to an already-running tab/app, not wall time since last login.
 */
export function idlePhaseAfterRestore(args: {
  rememberMe: boolean
  lastActivityAt: number | null
  now: number
  idleMs?: number
  warnBeforeMs?: number
}): IdlePhase {
  if (args.lastActivityAt == null) return "ok"
  return evaluateSessionIdle({
    lastActivityAt: args.lastActivityAt,
    now: args.now,
    idleMs: args.idleMs,
    warnBeforeMs: args.warnBeforeMs,
  })
}

export function rememberUntilFrom(now: number, rememberMs = REMEMBER_MS): number {
  return now + rememberMs
}

export function isRememberExpired(rememberUntil: number | null, now: number): boolean {
  if (rememberUntil == null) return false
  return now > rememberUntil
}

/**
 * Open-redirect guard for post-login `location.state.from`.
 */
export function pathFromLoginRedirect(
  from:
    | { pathname?: string; search?: string; hash?: string }
    | null
    | undefined,
  fallback: string,
): string {
  const pathname = from?.pathname
  if (!pathname || !pathname.startsWith("/") || pathname.startsWith("//")) {
    return fallback
  }
  return `${pathname}${from.search ?? ""}${from.hash ?? ""}`
}
