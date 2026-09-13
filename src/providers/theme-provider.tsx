import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { LOCAL_STORAGE_KEYS } from "@/lib/constants";
import {
  DEFAULT_THEME,
  applyResolvedTheme,
  prefersDarkScheme,
  prefersMoreContrast,
  readStoredTheme,
  resolveTheme,
  type Theme,
} from "@/lib/theme";
import { ThemeContext } from "@/providers/use-theme";

interface ThemeProviderProps {
  children: ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
}

export function ThemeProvider({
  children,
  defaultTheme = DEFAULT_THEME,
  storageKey = LOCAL_STORAGE_KEYS.theme,
}: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(() =>
    readStoredTheme(storageKey, defaultTheme),
  );
  const [systemIsDark, setSystemIsDark] = useState(prefersDarkScheme);
  const [systemWantsContrast, setSystemWantsContrast] = useState(prefersMoreContrast);

  const resolvedTheme = useMemo(
    () => resolveTheme(theme, systemIsDark, systemWantsContrast),
    [theme, systemIsDark, systemWantsContrast],
  );

  useEffect(() => {
    applyResolvedTheme(resolvedTheme);
  }, [resolvedTheme]);

  useEffect(() => {
    const schemeQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const contrastQuery = window.matchMedia("(prefers-contrast: more)");
    const onScheme = () => setSystemIsDark(schemeQuery.matches);
    const onContrast = () => setSystemWantsContrast(contrastQuery.matches);
    schemeQuery.addEventListener("change", onScheme);
    contrastQuery.addEventListener("change", onContrast);
    return () => {
      schemeQuery.removeEventListener("change", onScheme);
      contrastQuery.removeEventListener("change", onContrast);
    };
  }, []);

  const setTheme = useCallback(
    (next: Theme) => {
      try {
        window.localStorage.setItem(storageKey, next);
      } catch {
        /* Private mode or blocked storage: still apply for this session. */
      }
      setThemeState(next);
    },
    [storageKey],
  );

  const value = useMemo(
    () => ({ theme, resolvedTheme, setTheme }),
    [theme, resolvedTheme, setTheme],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}
