/**
 * Display theme. Dark is the product default (the original cinematic
 * palette). Light is opt-in. System follows the device, and is never
 * assumed for a first visit. High-contrast and colourblind-safe palettes
 * are complete looks, not overlays on the current appearance.
 */

export const THEMES = [
  "dark",
  "light",
  "system",
  "high-contrast",
  "high-contrast-light",
  "colourblind",
  "colourblind-light",
] as const;
export type Theme = (typeof THEMES)[number];

export const RESOLVED_THEMES = [
  "dark",
  "light",
  "high-contrast",
  "high-contrast-light",
  "colourblind",
  "colourblind-light",
] as const;
export type ResolvedTheme = (typeof RESOLVED_THEMES)[number];

export const APPEARANCE_THEMES = ["dark", "light", "system"] as const;
export const ACCESSIBLE_THEMES = [
  "high-contrast",
  "high-contrast-light",
  "colourblind",
  "colourblind-light",
] as const;

export const DEFAULT_THEME: Theme = "dark";

export const THEME_LABELS: Record<Theme, string> = {
  dark: "Dark",
  light: "Light",
  system: "System",
  "high-contrast": "High contrast",
  "high-contrast-light": "High contrast light",
  colourblind: "Colourblind-safe",
  "colourblind-light": "Colourblind-safe light",
};

const THEME_SET = new Set<string>(THEMES);

/** Browser chrome / PWA status bar, matching index.css canvases. */
export const THEME_COLOR: Record<ResolvedTheme, string> = {
  dark: "#141414",
  light: "#f6f3ee",
  "high-contrast": "#000000",
  "high-contrast-light": "#ffffff",
  colourblind: "#141414",
  "colourblind-light": "#f6f3ee",
};

const PALETTE_CLASSES = ["light", "dark", "theme-high-contrast", "theme-colourblind"] as const;

export function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && THEME_SET.has(value);
}

export function isDarkPalette(resolved: ResolvedTheme): boolean {
  return resolved === "dark" || resolved === "high-contrast" || resolved === "colourblind";
}

export function canvasScheme(resolved: ResolvedTheme): "light" | "dark" {
  return isDarkPalette(resolved) ? "dark" : "light";
}

export function paletteModifierClass(resolved: ResolvedTheme): "theme-high-contrast" | "theme-colourblind" | null {
  if (resolved === "high-contrast" || resolved === "high-contrast-light") return "theme-high-contrast";
  if (resolved === "colourblind" || resolved === "colourblind-light") return "theme-colourblind";
  return null;
}

export function prefersDarkScheme(): boolean {
  if (typeof window === "undefined") return true;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function prefersMoreContrast(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-contrast: more)").matches;
}

export function resolveTheme(
  theme: Theme,
  systemIsDark = prefersDarkScheme(),
  systemWantsContrast = prefersMoreContrast(),
): ResolvedTheme {
  if (theme === "light") return "light";
  if (theme === "high-contrast") return "high-contrast";
  if (theme === "high-contrast-light") return "high-contrast-light";
  if (theme === "colourblind") return "colourblind";
  if (theme === "colourblind-light") return "colourblind-light";
  if (theme === "system") {
    if (systemWantsContrast) return systemIsDark ? "high-contrast" : "high-contrast-light";
    return systemIsDark ? "dark" : "light";
  }
  return "dark";
}

export function readStoredTheme(storageKey: string, fallback: Theme = DEFAULT_THEME): Theme {
  if (typeof window === "undefined") return fallback;
  try {
    const stored = window.localStorage.getItem(storageKey);
    return isTheme(stored) ? stored : fallback;
  } catch {
    return fallback;
  }
}

export function applyResolvedTheme(resolved: ResolvedTheme, root: HTMLElement = document.documentElement) {
  root.classList.remove(...PALETTE_CLASSES);
  const scheme = canvasScheme(resolved);
  root.classList.add(scheme);
  const modifier = paletteModifierClass(resolved);
  if (modifier) root.classList.add(modifier);
  root.style.colorScheme = scheme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", THEME_COLOR[resolved]);
  void syncNativeStatusBar(resolved);
}

async function syncNativeStatusBar(resolved: ResolvedTheme) {
  try {
    const cap = (window as Window & { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    if (!cap?.isNativePlatform?.()) return;
    const { StatusBar, Style } = await import("@capacitor/status-bar");
    await StatusBar.setBackgroundColor({ color: THEME_COLOR[resolved] });
    await StatusBar.setStyle({ style: isDarkPalette(resolved) ? Style.Dark : Style.Light });
  } catch {
    /* Browser, Electron, or plugin unavailable. */
  }
}
