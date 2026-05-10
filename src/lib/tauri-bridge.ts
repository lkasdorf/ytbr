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
  | "completed"
  | "failed"
  | "cancelled";

export interface JobSpec {
  url: string;
  formatId: string | null;
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

export function ytdlpVersion(): Promise<string> {
  return invoke<string>("ytdlp_version");
}

export function enqueueJob(spec: JobSpec): Promise<string> {
  return invoke<string>("enqueue_job", { spec });
}

export function cancelJob(id: string): Promise<void> {
  return invoke<void>("cancel_job", { id });
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
