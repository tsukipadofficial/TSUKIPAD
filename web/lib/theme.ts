import { STORAGE_PREFIX } from "./brand";

export type Theme = "dark" | "light";

const STORAGE_KEY = `${STORAGE_PREFIX}.theme`;

/// Runs in the document head, before the first paint.
///
/// The theme has to be on <html> before any pixel is drawn, otherwise a light
/// reader gets a black flash on every navigation that touches the server. That
/// rules out doing it in an effect, so it is a blocking inline script — the one
/// place in the app where that is worth the cost.
///
/// Dark is the default, full stop: it is what the site is, and a first visit
/// opens on it whatever the OS prefers. Light is only ever an explicit choice,
/// made with the toggle and remembered from then on.
///
/// This file stays free of React so the server layout can import the string.
export const THEME_INIT_SCRIPT = `(function(){var t=null;try{t=localStorage.getItem(${JSON.stringify(
  STORAGE_KEY,
)})}catch(e){}if(t!=="light"&&t!=="dark"){t="dark"}document.documentElement.dataset.theme=t})()`;

/// Subscribers live outside React so the header's toggle and the sign-in
/// modal's appearance can share one value without a provider around both.
const listeners = new Set<() => void>();

export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

export function subscribeTheme(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function setTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* private window or blocked storage -- the choice just won't outlive the tab */
  }
  for (const fn of listeners) fn();
}
