// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Leon Kasdorf

import { invoke } from "@tauri-apps/api/core";

// Wire shapes — must match Rust serde structs (rename_all = "camelCase").

export interface Format {
  formatId: string;
  container: string;
  width: number | null;
  height: number | null;
  fps: number | null;
  vcodec: string;
  acodec: string;
  filesizeBytes: number | null;
  bitrateKbps: number | null;
}

export interface ProbeResult {
  id: string;
  title: string;
  uploader: string | null;
  durationSecs: number | null;
  thumbnail: string | null;
  formats: Format[];
}

export type JobStatus =
  | "queued"
  | "downloading"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export interface JobSpec {
  url: string;
  /// Raw yt-dlp `-f` argument. May be a single format id, a composite
  /// selector ("137+bestaudio/best"), or a preset expression.
  formatId: string | null;
  /// Pretty label for QueueView. `null` falls back to `formatId`.
  formatLabel?: string | null;
  outputDir: string;
  outputTemplate?: string;
  /// yt-dlp `--cookies-from-browser` value, or `null` for no cookies.
  cookiesFromBrowser?: string | null;
  /// yt-dlp `--cookies` file path. Mutually exclusive with
  /// `cookiesFromBrowser`; the runner picks file first if both are set
  /// (the store enforces single-source on the frontend already).
  cookiesFile?: string | null;
  /// Path that overrides the bundled ffmpeg sidecar. `null` uses the bundle.
  ffmpegLocation?: string | null;
  /// Per-format yt-dlp toggles. All default to `false` server-side.
  writeSubs?: boolean;
  /// yt-dlp `--sub-langs`. Only consulted when `writeSubs` is on.
  /// Frontend sends a non-empty string ("en" by default); empty / null
  /// makes the runner skip the flag entirely (so yt-dlp's default kicks
  /// in, which is currently "all" — usually not what users want).
  subLangs?: string | null;
  writeAutoSubs?: boolean;
  embedSubs?: boolean;
  embedThumbnail?: boolean;
  embedMetadata?: boolean;
  /// yt-dlp `--write-thumbnail`. Sidecar `.jpg`/`.webp`.
  writeThumbnail?: boolean;
  /// yt-dlp `--write-info-json`. Sidecar `.info.json`.
  writeInfoJson?: boolean;
  /// Enables `--download-archive` against the app config dir's archive.txt.
  downloadArchive?: boolean;
  /// yt-dlp `--restrict-filenames`. ASCII-only / safe-on-FAT32 file names.
  restrictFilenames?: boolean;
  /// yt-dlp `--limit-rate` value (e.g. "500K", "1.5M"). Empty/null skips.
  rateLimit?: string | null;
  /// yt-dlp `--proxy` URL. Empty/null skips.
  proxy?: string | null;
  /// yt-dlp `--concurrent-fragments N` for HLS/DASH fragment downloads.
  /// Omitted or 1 means single-fragment (yt-dlp default). Range 1–8.
  concurrentFragments?: number | null;
  /// yt-dlp `--retries N`. Omitted or 10 (yt-dlp default) skips the flag.
  retries?: number | null;
  /// yt-dlp `--fragment-retries N`. Same skip rule as `retries`.
  fragmentRetries?: number | null;
  /// Drives yt-dlp `--extract-audio --audio-format <fmt>`. The frontend
  /// only sets this for audio-only downloads — applying it to a video
  /// selector would strip the video track. `null` or "default" means
  /// no recode (yt-dlp picks whatever the source publishes).
  audioFormat?: string | null;
  /// SponsorBlock mode. `null` or "off" emits no flag. "mark" adds
  /// chapter markers via `--sponsorblock-mark`; "remove" cuts segments
  /// via `--sponsorblock-remove` (requires ffmpeg, which we bundle).
  sponsorblockMode?: "off" | "mark" | "remove" | null;
  /// Comma-joined category list applied to whichever flag the mode
  /// selects. Empty list means yt-dlp's default set; we always pass
  /// an explicit list so the user's settings are authoritative.
  sponsorblockCategories?: string[] | null;
}

export interface JobProgress {
  percent: number;
  speedBps: number | null;
  etaSecs: number | null;
  downloadedBytes: number | null;
  totalBytes: number | null;
}

export interface JobState {
  id: string;
  spec: JobSpec;
  status: JobStatus;
  progress: JobProgress | null;
  error: string | null;
}

// ---------- commands ----------

export function probeUrl(url: string): Promise<ProbeResult> {
  return invoke<ProbeResult>("probe_url", { url });
}

export interface PlaylistEntries {
  /// Playlist title, or `null` for single-video URLs.
  title: string | null;
  /// Watch URLs for each entry. Always at least one element on success.
  entries: string[];
}

export function expandPlaylist(url: string): Promise<PlaylistEntries> {
  return invoke<PlaylistEntries>("expand_playlist", { url });
}

export function ytdlpVersion(): Promise<string> {
  return invoke<string>("ytdlp_version");
}

export function ffmpegVersion(): Promise<string> {
  return invoke<string>("ffmpeg_version");
}

export interface UpdateOutcome {
  installed: string;
  from: string | null;
  replaced: boolean;
}

export function updateYtdlp(): Promise<UpdateOutcome> {
  return invoke<UpdateOutcome>("update_ytdlp");
}

export interface AppUpdateCheck {
  current: string;
  latest: string;
  isNewer: boolean;
  releaseUrl: string;
}

export function checkAppUpdate(): Promise<AppUpdateCheck> {
  return invoke<AppUpdateCheck>("check_app_update");
}

export function revealInFolder(path: string): Promise<void> {
  return invoke<void>("reveal_in_folder", { path });
}

export function enqueueJob(spec: JobSpec): Promise<string> {
  return invoke<string>("enqueue_job", { spec });
}

export function cancelJob(id: string): Promise<void> {
  return invoke<void>("cancel_job", { id });
}

export function pauseJob(id: string): Promise<void> {
  return invoke<void>("pause_job", { id });
}

export function resumeJob(id: string): Promise<void> {
  return invoke<void>("resume_job", { id });
}

export function listJobs(): Promise<JobState[]> {
  return invoke<JobState[]>("list_jobs");
}

export function clearCompletedJobs(): Promise<void> {
  return invoke<void>("clear_completed_jobs");
}

export function removeJob(id: string): Promise<void> {
  return invoke<void>("remove_job", { id });
}

export function pickOutputDir(): Promise<string | null> {
  return invoke<string | null>("pick_output_dir");
}

export function pickCookiesFile(): Promise<string | null> {
  return invoke<string | null>("pick_cookies_file");
}

// Push the parallel-download limit to the Rust queue. Returns the
// clamped limit the backend accepted (1..=MAX_PARALLEL_LIMIT).
export function setParallelLimit(limit: number): Promise<number> {
  return invoke<number>("set_parallel_limit", { limit });
}
