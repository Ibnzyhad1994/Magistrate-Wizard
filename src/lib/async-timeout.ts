/**
 * Per-call timeouts and abort helpers for extraction/OCR.
 * A hung pdf.js render or Tesseract recognize must fail that file
 * honestly instead of stalling the whole bulk batch.
 */

export class TimeoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "TimeoutError"
  }
}

export const isTimeoutError = (error: unknown): boolean =>
  !!error && typeof error === "object" && "name" in error && (error as { name: string }).name === "TimeoutError"

export const isAbortError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") return false
  const name = "name" in error ? String((error as { name: unknown }).name) : ""
  return name === "AbortError" || name === "AbortError"
}

export const throwIfAborted = (signal?: AbortSignal): void => {
  if (!signal?.aborted) return
  const err = new Error("Cancelled")
  err.name = "AbortError"
  throw err
}

export const withTimeout = async <T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(message)), ms)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
