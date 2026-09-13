export const AUTH_SPLASH_HOLD_MS = 2000;
export const AUTH_SPLASH_FADE_MS = 400;

/** Skip the timed brand splash when the OS asks for reduced motion. */
export function shouldPlayAuthSplash() {
  if (typeof window === "undefined") return false;
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
