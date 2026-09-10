/** Truncated epoch-second window used by enforce_rpc_rate_limit (0137). */
export function rpcRateLimitWindowStart(nowMs: number, windowSeconds: number): number {
  const epoch = Math.floor(nowMs / 1000)
  return Math.floor(epoch / windowSeconds) * windowSeconds
}

/** After incrementing, a count above p_max is blocked. */
export function rpcRateLimitWouldBlock(hitCountAfterIncrement: number, max: number): boolean {
  return hitCountAfterIncrement > max
}
