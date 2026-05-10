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
  /// Path that overrides the bundled ffmpeg sidecar. `null` uses the bundle.
  ffmpegLocation?: string | null;
  /// Per-format yt-dlp toggles. All default to `false` server-side.
  writeSubs?: boolean;
  embedThumbnail?: boolean;
  embedMetadata?: boolean;
  /// Enables `--download-archive` against the app config dir's archive.txt.
  downloadArchive?: boolean;
  /// yt-dlp `--concurrent-fragments N` for HLS/DASH fragment downloads.
  /// Omitted or 1 means single-fragment (yt-dlp default). Range 1–8.
  concurrentFragments?: number | null;
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

export function pickOutputDir(): Promise<string | null> {
  return invoke<string | null>("pick_output_dir");
}

// Push the parallel-download limit to the Rust queue. Returns the
// clamped limit the backend accepted (1..=MAX_PARALLEL_LIMIT).
export function setParallelLimit(limit: number): Promise<number> {
  return invoke<number>("set_parallel_limit", { limit });
}
