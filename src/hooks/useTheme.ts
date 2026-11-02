import { useCallback, useEffect, useState } from "react";

export type ThemePreference = "light" | "dark" | "system";
const storageKey = "codex-web:theme";
const isTheme = (value: string | null): value is ThemePreference =>
  value === "light" || value === "dark" || value === "system";

function readTheme(): ThemePreference {
  try {
    const stored = localStorage.getItem(storageKey);
    if (isTheme(stored)) return stored;
  } catch {
    // Theme selection remains available when browser storage is blocked.
  }
  return "system";
}

export function useTheme() {
  const [theme, setTheme] = useState<ThemePreference>(readTheme);

  useEffect(() => {
    const system = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const resolved = theme === "system" ? (system.matches ? "dark" : "light") : theme;
      document.documentElement.dataset.theme = resolved;
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute("content", resolved === "dark" ? "#161715" : "#f5f5f2");
    };
    apply();
    if (theme === "system") system.addEventListener("change", apply);
    return () => system.removeEventListener("change", apply);
  }, [theme]);

  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === storageKey || event.key === null) setTheme(readTheme());
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);

  const changeTheme = useCallback((next: ThemePreference) => {
    setTheme(next);
    try {
      localStorage.setItem(storageKey, next);
    } catch {
      // The current page can still use the preference without persistence.
    }
  }, []);

  return { theme, changeTheme };
}
