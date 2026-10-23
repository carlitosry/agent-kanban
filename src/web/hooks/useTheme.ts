import { useEffect, useState } from "preact/hooks";
import { applyTheme, readStored, resolveTheme, THEME_KEY, toggleTheme, writeStored, type Theme } from "../lib/theme.js";

export function useTheme() {
  const media = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;
  const [theme, setTheme] = useState<Theme>(() => resolveTheme(readStored(THEME_KEY), !!media?.matches));

  useEffect(() => applyTheme(theme), [theme]);

  // Follow the system only while the user has not chosen explicitly.
  useEffect(() => {
    if (!media) return;
    const on = (e: MediaQueryListEvent) => { if (!readStored(THEME_KEY)) setTheme(e.matches ? "dark" : "light"); };
    media.addEventListener("change", on);
    return () => media.removeEventListener("change", on);
  }, []);

  const toggle = () => setTheme((t) => { const n = toggleTheme(t); writeStored(THEME_KEY, n); return n; });
  return { theme, toggle };
}
