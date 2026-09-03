/**
 * Queue a hearing save only when the device could not reach the API.
 * Permission and validation failures must surface, not retry forever.
 * Expired JWTs are neither dropped nor treated as offline — they pause
 * until the user re-enters their password.
 */

const PERMISSION_CODES = new Set([
  "403",
  "42501",
  "PGRST116",
  "22P02",
  "23502",
  "23505",
  "23514",
])

const AUTH_EXPIRED_CODES = new Set(["401", "PGRST301"])

const AUTH_EXPIRED_MESSAGE =
  /jwt expired|invalid jwt|session expired|not authenticated|auth session missing|jwt.*expired/i

const NETWORK_MESSAGE =
  /failed to fetch|networkerror|network request failed|load failed|fetch failed|you appear to be offline/i

const readCode = (error: unknown): string | undefined => {
  if (!error || typeof error !== "object") return undefined
  const rec = error as { code?: unknown; status?: unknown }
  if (typeof rec.code === "string" && rec.code) return rec.code
  if (typeof rec.code === "number") return String(rec.code)
  if (typeof rec.status === "number") return String(rec.status)
  if (typeof rec.status === "string" && rec.status) return rec.status
  return undefined
}

const readMessage = (error: unknown): string => {
  if (!error) return ""
  if (typeof error === "string") return error
  if (error instanceof Error) return error.message
  if (error && typeof error === "object" && "message" in error && typeof (error as { message: unknown }).message === "string") {
    return (error as { message: string }).message
  }
  return ""
}

export const isAuthExpiredError = (error: unknown): boolean => {
  const code = readCode(error)
  if (code && AUTH_EXPIRED_CODES.has(code)) return true
  if (Number(code) === 401) return true
  return AUTH_EXPIRED_MESSAGE.test(readMessage(error))
}

export const isPermissionOrValidationError = (error: unknown): boolean => {
  if (isAuthExpiredError(error)) return false
  const code = readCode(error)
  if (code && PERMISSION_CODES.has(code)) return true
  const status = Number(code)
  if (status === 403 || status === 422) return true
  return false
}

export const isQueueableError = (
  error: unknown,
  online = typeof navigator === "undefined" ? true : navigator.onLine,
): boolean => {
  if (isAuthExpiredError(error)) return false
  if (isPermissionOrValidationError(error)) return false
  if (!online) return true
  if (error instanceof TypeError) return true
  if (error && typeof error === "object" && "name" in error) {
    const name = String((error as { name: unknown }).name)
    if (/RetryableFetch|NetworkError/i.test(name)) return true
  }
  return NETWORK_MESSAGE.test(readMessage(error))
}

export const MATTER_UNAVAILABLE_OFFLINE =
  "This matter is not available offline yet. Open it once while you are online."
