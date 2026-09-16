"use client";

import { useEffect, useState } from "react";

import { currentTheme, subscribeTheme, type Theme } from "./theme";

/// Reads the theme the head script already applied.
///
/// Starts at "dark" so the server and the first client render agree, then syncs
/// from the DOM — same shape as the language preference in i18n.
export function useTheme(): Theme {
  const [theme, setThemeState] = useState<Theme>("dark");

  useEffect(() => {
    const sync = () => setThemeState(currentTheme());
    sync();
    return subscribeTheme(sync);
  }, []);

  return theme;
}
