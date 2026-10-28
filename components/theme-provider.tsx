"use client";

import * as React from "react";

export type ThemePreference = "light" | "dark" | "system";
type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "anisync-theme";

/**
 * Runs before paint (inlined in <head>) to avoid a theme flash.
 * Dark by default: only an explicit light preference (stored or from the OS) switches to light.
 */
export const themeScript = `(function(){try{var t=localStorage.getItem("${THEME_STORAGE_KEY}")||"system";var d=t==="dark"||(t==="system"&&!window.matchMedia("(prefers-color-scheme: light)").matches);var e=document.documentElement;e.classList.toggle("dark",d);e.style.colorScheme=d?"dark":"light"}catch(_){document.documentElement.classList.add("dark")}})()`;

interface ThemeContextValue {
  theme: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: ThemePreference) => void;
}

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

function systemTheme(): ResolvedTheme {
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function readStored(): ThemePreference {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return value === "light" || value === "dark" || value === "system" ? value : "system";
  } catch {
    return "system";
  }
}

function apply(resolved: ResolvedTheme) {
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.style.colorScheme = resolved;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", resolved === "dark" ? "#0b0c10" : "#f7f7f8");
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // null until the stored preference is read, so the pre-paint choice is never overridden.
  const [stored, setThemeState] = React.useState<ThemePreference | null>(null);
  const [resolvedTheme, setResolved] = React.useState<ResolvedTheme>("dark");
  const theme = stored ?? "system";

  React.useEffect(() => {
    setThemeState(readStored());
  }, []);

  React.useEffect(() => {
    if (stored === null) return;
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const update = () => {
      const resolved = theme === "system" ? systemTheme() : theme;
      setResolved(resolved);
      apply(resolved);
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [stored, theme]);

  const setTheme = React.useCallback((next: ThemePreference) => {
    setThemeState(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // storage unavailable: the choice lasts for this visit only
    }
  }, []);

  const value = React.useMemo(() => ({ theme, resolvedTheme, setTheme }), [theme, resolvedTheme, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = React.useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme doit être utilisé dans <ThemeProvider>");
  return ctx;
}
