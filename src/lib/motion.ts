/**
 * The behaviour for a scripted scroll. The global reduced-motion rule in
 * index.css cannot reach an explicit `behavior: "smooth"` passed from
 * script, so every such call asks here instead.
 */
export function scrollBehavior(): ScrollBehavior {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "smooth";
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}
