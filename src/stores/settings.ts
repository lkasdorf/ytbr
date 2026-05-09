// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Leon Kasdorf

import { create } from "zustand";
import { persist } from "zustand/middleware";

// yt-dlp's --cookies-from-browser supports more entries (whale, brave-private,
// etc.). The list below is the subset we expose in the UI; bump it if a
// requested browser shows up.
export type CookieBrowser =
  | "brave"
  | "chrome"
  | "chromium"
  | "edge"
  | "firefox"
  | "opera"
  | "safari"
  | "vivaldi";

export const COOKIE_BROWSERS: readonly CookieBrowser[] = [
  "brave",
  "chrome",
  "chromium",
  "edge",
  "firefox",
  "opera",
  "safari",
  "vivaldi",
];

export type PresetId = "audio-best" | "video-720" | "video-1080" | "video-4k";

export const DEFAULT_OUTPUT_TEMPLATE = "%(title)s.%(ext)s";
export const DEFAULT_PARALLEL_LIMIT = 2;
export const MIN_PARALLEL_LIMIT = 1;
export const MAX_PARALLEL_LIMIT = 8;

interface SettingsStore {
  outputDir: string | null;
  parallelLimit: number;
  cookiesFromBrowser: CookieBrowser | null;
  ffmpegPath: string | null;
  outputTemplate: string;
  defaultPreset: PresetId | null;

  setOutputDir: (dir: string | null) => void;
  setParallelLimit: (n: number) => void;
  setCookiesFromBrowser: (browser: CookieBrowser | null) => void;
  setFfmpegPath: (path: string | null) => void;
  setOutputTemplate: (template: string) => void;
  setDefaultPreset: (id: PresetId | null) => void;
}

function clampParallel(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_PARALLEL_LIMIT;
  return Math.max(MIN_PARALLEL_LIMIT, Math.min(MAX_PARALLEL_LIMIT, Math.floor(n)));
}

// Persisted in localStorage via zustand-persist. Existing keys survive new
// fields because zustand merges persisted state on top of the default state
// at hydration; new fields fall back to the defaults defined here.
export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      outputDir: null,
      parallelLimit: DEFAULT_PARALLEL_LIMIT,
      cookiesFromBrowser: null,
      ffmpegPath: null,
      outputTemplate: DEFAULT_OUTPUT_TEMPLATE,
      defaultPreset: null,

      setOutputDir: (dir) => set({ outputDir: dir }),
      setParallelLimit: (n) => set({ parallelLimit: clampParallel(n) }),
      setCookiesFromBrowser: (browser) => set({ cookiesFromBrowser: browser }),
      setFfmpegPath: (path) => set({ ffmpegPath: path && path.trim() !== "" ? path : null }),
      setOutputTemplate: (template) =>
        set({
          outputTemplate:
            template.trim() === "" ? DEFAULT_OUTPUT_TEMPLATE : template,
        }),
      setDefaultPreset: (id) => set({ defaultPreset: id }),
    }),
    { name: "ytbr.settings.v1" },
  ),
);
