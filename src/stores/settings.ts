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

// SponsorBlock category ids that yt-dlp accepts. We expose the six the
// SponsorBlock browser extension surfaces; yt-dlp supports more (`preview`,
// `filler`, `poi_highlight`) but they overlap or are too niche to clutter
// the settings panel. Bump the list if a user requests a missing one.
export type SponsorblockCategory =
  | "sponsor"
  | "intro"
  | "outro"
  | "selfpromo"
  | "interaction"
  | "music_offtopic";

export const SPONSORBLOCK_CATEGORIES: readonly SponsorblockCategory[] = [
  "sponsor",
  "intro",
  "outro",
  "selfpromo",
  "interaction",
  "music_offtopic",
];

// "off" disables the feature entirely; "mark" adds chapter markers without
// cutting (yt-dlp `--sponsorblock-mark`); "remove" cuts the segments via
// ffmpeg (yt-dlp `--sponsorblock-remove`).
export type SponsorblockMode = "off" | "mark" | "remove";

export const DEFAULT_OUTPUT_TEMPLATE = "%(title)s.%(ext)s";
// yt-dlp accepts a comma-separated list of BCP-47 ISO codes, "all", or a
// wildcard like "en.*". We default to English only — most users want
// captions in one language and pulling every available track wastes disk.
export const DEFAULT_SUB_LANGS = "en";
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
  /// Comma-separated yt-dlp `--sub-langs` value. Only consulted when
  /// `writeSubs` is on. Empty string falls back to yt-dlp's default
  /// (which is "all" — way too broad — so we always send something).
  subLangs: string;
  writeAutoSubs: boolean;
  embedSubs: boolean;
  embedThumbnail: boolean;
  embedMetadata: boolean;
  /// yt-dlp `--write-thumbnail`. Writes the cover art as a sidecar
  /// `.jpg`/`.webp` next to the video. Independent of `embedThumbnail`
  /// (which bakes it into the container).
  writeThumbnail: boolean;
  /// yt-dlp `--write-info-json`. Writes the full yt-dlp metadata JSON
  /// next to the video. Useful for archiving / debugging downloads.
  writeInfoJson: boolean;
  useDownloadArchive: boolean;
  /// yt-dlp `--restrict-filenames`. Strips Unicode + special chars from
  /// the filename so it stays safe across SMB / FAT32 / cross-OS shares.
  restrictFilenames: boolean;
  /// yt-dlp `--limit-rate` value, e.g. "500K", "1.5M". Empty string =
  /// no limit. The runner trusts the format and lets yt-dlp validate.
  rateLimit: string;
  /// yt-dlp `--proxy` URL (http://, https://, socks5://, socks4://).
  /// Empty string = no proxy.
  proxy: string;
  theme: ThemeMode;
  notifyOnFinish: boolean;
  watchClipboard: boolean;
  concurrentFragments: number;
  audioFormat: AudioFormat;
  sponsorblockMode: SponsorblockMode;
  sponsorblockCategories: SponsorblockCategory[];

  setOutputDir: (dir: string | null) => void;
  setParallelLimit: (n: number) => void;
  setCookiesFromBrowser: (browser: CookieBrowser | null) => void;
  setFfmpegPath: (path: string | null) => void;
  setOutputTemplate: (template: string) => void;
  setDefaultPreset: (id: PresetId | null) => void;
  setWriteSubs: (v: boolean) => void;
  setSubLangs: (v: string) => void;
  setWriteAutoSubs: (v: boolean) => void;
  setEmbedSubs: (v: boolean) => void;
  setEmbedThumbnail: (v: boolean) => void;
  setEmbedMetadata: (v: boolean) => void;
  setWriteThumbnail: (v: boolean) => void;
  setWriteInfoJson: (v: boolean) => void;
  setUseDownloadArchive: (v: boolean) => void;
  setRestrictFilenames: (v: boolean) => void;
  setRateLimit: (v: string) => void;
  setProxy: (v: string) => void;
  setTheme: (theme: ThemeMode) => void;
  setNotifyOnFinish: (v: boolean) => void;
  setWatchClipboard: (v: boolean) => void;
  setConcurrentFragments: (n: number) => void;
  setAudioFormat: (fmt: AudioFormat) => void;
  setSponsorblockMode: (mode: SponsorblockMode) => void;
  setSponsorblockCategories: (cats: SponsorblockCategory[]) => void;
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
      subLangs: DEFAULT_SUB_LANGS,
      writeAutoSubs: false,
      embedSubs: false,
      embedThumbnail: false,
      embedMetadata: false,
      writeThumbnail: false,
      writeInfoJson: false,
      useDownloadArchive: false,
      restrictFilenames: false,
      rateLimit: "",
      proxy: "",
      theme: "system",
      notifyOnFinish: true,
      watchClipboard: true,
      concurrentFragments: DEFAULT_CONCURRENT_FRAGMENTS,
      audioFormat: "default",
      sponsorblockMode: "off",
      sponsorblockCategories: [...SPONSORBLOCK_CATEGORIES],

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
      setSubLangs: (v) =>
        set({ subLangs: v.trim() === "" ? DEFAULT_SUB_LANGS : v }),
      setWriteAutoSubs: (v) => set({ writeAutoSubs: v }),
      setEmbedSubs: (v) => set({ embedSubs: v }),
      setEmbedThumbnail: (v) => set({ embedThumbnail: v }),
      setEmbedMetadata: (v) => set({ embedMetadata: v }),
      setWriteThumbnail: (v) => set({ writeThumbnail: v }),
      setWriteInfoJson: (v) => set({ writeInfoJson: v }),
      setUseDownloadArchive: (v) => set({ useDownloadArchive: v }),
      setRestrictFilenames: (v) => set({ restrictFilenames: v }),
      setRateLimit: (v) => set({ rateLimit: v.trim() }),
      setProxy: (v) => set({ proxy: v.trim() }),
      setTheme: (theme) => set({ theme }),
      setNotifyOnFinish: (v) => set({ notifyOnFinish: v }),
      setWatchClipboard: (v) => set({ watchClipboard: v }),
      setConcurrentFragments: (n) =>
        set({ concurrentFragments: clampConcurrentFragments(n) }),
      setAudioFormat: (fmt) => set({ audioFormat: fmt }),
      setSponsorblockMode: (mode) => set({ sponsorblockMode: mode }),
      setSponsorblockCategories: (cats) => set({ sponsorblockCategories: cats }),
    }),
    { name: "ytbr.settings.v1" },
  ),
);
