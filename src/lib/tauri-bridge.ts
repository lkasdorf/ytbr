// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Leon Kasdorf

import { invoke } from "@tauri-apps/api/core";

// Wire shapes — must match Rust serde structs in src-tauri/src/ytdlp/format.rs
// (rename_all = "camelCase").

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

export function probeUrl(url: string): Promise<ProbeResult> {
  return invoke<ProbeResult>("probe_url", { url });
}

export function ytdlpVersion(): Promise<string> {
  return invoke<string>("ytdlp_version");
}
