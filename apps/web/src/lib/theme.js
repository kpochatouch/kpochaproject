//apps/web/src/lib/theme.js
export const THEME_KEY = "kpocha-theme";

export function getTheme() {
  try {
    return localStorage.getItem(THEME_KEY) || "dark";
  } catch {
    return "dark";
  }
}

export function setTheme(theme) {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {}
  try {
    document.documentElement.setAttribute("data-theme", theme);
  } catch {}
  try {
    window.dispatchEvent(
      new CustomEvent("kpocha:theme-change", { detail: theme }),
    );
  } catch {}
}

export function initTheme() {
  const theme = getTheme();
  try {
    document.documentElement.setAttribute("data-theme", theme);
  } catch {}
  return theme;
}

export function toggleTheme() {
  const next = getTheme() === "light" ? "dark" : "light";
  setTheme(next);
  return next;
}
