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

export type ThemeMode = "system" | "light" | "dark";

// "default" means yt-dlp's own selection (no recode). The other options
// drive yt-dlp `--extract-audio --audio-format <fmt>` and only kick in
// for audio-only downloads — see App.tsx / BatchView.tsx.
export type AudioFormat = "default" | "mp3" | "opus" | "flac" | "wav";

export const AUDIO_FORMATS: readonly AudioFormat[] = [
  "default",
  "mp3",
  "opus",
  "flac",
  "wav",
];

export const DEFAULT_OUTPUT_TEMPLATE = "%(title)s.%(ext)s";
export const DEFAULT_PARALLEL_LIMIT = 2;
export const MIN_PARALLEL_LIMIT = 1;
export const MAX_PARALLEL_LIMIT = 8;
export const DEFAULT_CONCURRENT_FRAGMENTS = 1;
export const MIN_CONCURRENT_FRAGMENTS = 1;
export const MAX_CONCURRENT_FRAGMENTS = 8;

interface SettingsStore {
  outputDir: string | null;
  parallelLimit: number;
  cookiesFromBrowser: CookieBrowser | null;
  ffmpegPath: string | null;
  outputTemplate: string;
  defaultPreset: PresetId | null;
  // Per-format options (yt-dlp flags). Defaults all off — opt-in is
  // safer for first-time downloads.
  writeSubs: boolean;
  embedThumbnail: boolean;
  embedMetadata: boolean;
  useDownloadArchive: boolean;
  theme: ThemeMode;
  notifyOnFinish: boolean;
  watchClipboard: boolean;
  concurrentFragments: number;
  audioFormat: AudioFormat;

  setOutputDir: (dir: string | null) => void;
  setParallelLimit: (n: number) => void;
  setCookiesFromBrowser: (browser: CookieBrowser | null) => void;
  setFfmpegPath: (path: string | null) => void;
  setOutputTemplate: (template: string) => void;
  setDefaultPreset: (id: PresetId | null) => void;
  setWriteSubs: (v: boolean) => void;
  setEmbedThumbnail: (v: boolean) => void;
  setEmbedMetadata: (v: boolean) => void;
  setUseDownloadArchive: (v: boolean) => void;
  setTheme: (theme: ThemeMode) => void;
  setNotifyOnFinish: (v: boolean) => void;
  setWatchClipboard: (v: boolean) => void;
  setConcurrentFragments: (n: number) => void;
  setAudioFormat: (fmt: AudioFormat) => void;
}

function clampParallel(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_PARALLEL_LIMIT;
  return Math.max(MIN_PARALLEL_LIMIT, Math.min(MAX_PARALLEL_LIMIT, Math.floor(n)));
}

function clampConcurrentFragments(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_CONCURRENT_FRAGMENTS;
  return Math.max(
    MIN_CONCURRENT_FRAGMENTS,
    Math.min(MAX_CONCURRENT_FRAGMENTS, Math.floor(n)),
  );
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
      writeSubs: false,
      embedThumbnail: false,
      embedMetadata: false,
      useDownloadArchive: false,
      theme: "system",
      notifyOnFinish: true,
      watchClipboard: true,
      concurrentFragments: DEFAULT_CONCURRENT_FRAGMENTS,
      audioFormat: "default",

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
      setWriteSubs: (v) => set({ writeSubs: v }),
      setEmbedThumbnail: (v) => set({ embedThumbnail: v }),
      setEmbedMetadata: (v) => set({ embedMetadata: v }),
      setUseDownloadArchive: (v) => set({ useDownloadArchive: v }),
      setTheme: (theme) => set({ theme }),
      setNotifyOnFinish: (v) => set({ notifyOnFinish: v }),
      setWatchClipboard: (v) => set({ watchClipboard: v }),
      setConcurrentFragments: (n) =>
        set({ concurrentFragments: clampConcurrentFragments(n) }),
      setAudioFormat: (fmt) => set({ audioFormat: fmt }),
    }),
    { name: "ytbr.settings.v1" },
  ),
);
