import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { LOCAL_STORAGE_KEYS } from "@/lib/constants";

export type Theme = "light" | "dark" | "system";

interface ThemeProviderProps {
  children: ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
}

interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: "light" | "dark";
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function getSystemTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function readStoredTheme(storageKey: string, fallback: Theme): Theme {
  if (typeof window === "undefined") return fallback;
  const stored = window.localStorage.getItem(storageKey);
  return stored === "light" || stored === "dark" || stored === "system"
    ? stored
    : fallback;
}

export function ThemeProvider({
  children,
  defaultTheme = "system",
  storageKey = LOCAL_STORAGE_KEYS.theme,
}: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(() =>
    readStoredTheme(storageKey, defaultTheme),
  );

  const resolvedTheme = useMemo<"light" | "dark">(
    () => (theme === "system" ? getSystemTheme() : theme),
    [theme],
  );

  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(resolvedTheme);
    root.style.colorScheme = resolvedTheme;
  }, [resolvedTheme]);

  useEffect(() => {
    if (theme !== "system") return;
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      const root = window.document.documentElement;
      const next = getSystemTheme();
      root.classList.remove("light", "dark");
      root.classList.add(next);
      root.style.colorScheme = next;
    };
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [theme]);

  const setTheme = (next: Theme) => {
    window.localStorage.setItem(storageKey, next);
    setThemeState(next);
  };

  const value = useMemo(
    () => ({ theme, resolvedTheme, setTheme }),
    [theme, resolvedTheme],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
