// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Leon Kasdorf

import { useEffect } from "react";
import { useSettingsStore, type ThemeMode } from "@/stores/settings";

const SYSTEM_QUERY = "(prefers-color-scheme: dark)";

function applyDarkClass(dark: boolean): void {
  const root = document.documentElement;
  if (dark) root.classList.add("dark");
  else root.classList.remove("dark");
}

function resolve(theme: ThemeMode, systemDark: boolean): boolean {
  if (theme === "dark") return true;
  if (theme === "light") return false;
  return systemDark;
}

export function useThemeEffect(): void {
  const theme = useSettingsStore((s) => s.theme);

  useEffect(() => {
    const mql = window.matchMedia(SYSTEM_QUERY);
    applyDarkClass(resolve(theme, mql.matches));

    if (theme !== "system") return;

    const onChange = (e: MediaQueryListEvent) => applyDarkClass(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [theme]);
}
