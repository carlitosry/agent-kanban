export type Theme = "light" | "dark";
export const THEME_KEY = "ak-theme";

export function resolveTheme(stored: string | null | undefined, prefersDark: boolean): Theme {
  if (stored === "light" || stored === "dark") return stored;
  return prefersDark ? "dark" : "light";
}

export function toggleTheme(t: Theme): Theme {
  return t === "dark" ? "light" : "dark";
}

export function readStored(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

export function writeStored(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
}

export function applyTheme(t: Theme): void {
  document.documentElement.classList.toggle("dark", t === "dark");
}
