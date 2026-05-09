// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Leon Kasdorf

export type FormatKind = "video+audio" | "video" | "audio" | "none";

export function classifyFormat(vcodec: string, acodec: string): FormatKind {
  const hasVideo = vcodec !== "none" && vcodec !== "";
  const hasAudio = acodec !== "none" && acodec !== "";
  if (hasVideo && hasAudio) return "video+audio";
  if (hasVideo) return "video";
  if (hasAudio) return "audio";
  return "none";
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"] as const;
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  const decimals = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(decimals)} ${units[i]}`;
}

export function formatBitrate(kbps: number | null | undefined): string {
  if (kbps == null) return "—";
  if (kbps >= 1000) return `${(kbps / 1000).toFixed(1)} Mbps`;
  return `${Math.round(kbps)} kbps`;
}

export function formatResolution(
  width: number | null | undefined,
  height: number | null | undefined,
): string {
  if (width == null || height == null) return "—";
  return `${width}×${height}`;
}

export function formatFps(fps: number | null | undefined): string {
  if (fps == null) return "—";
  return Number.isInteger(fps) ? String(fps) : fps.toFixed(2);
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function shortCodec(codec: string): string {
  if (codec === "none" || codec === "") return "—";
  // Strip the `.profileinfo` suffix for tighter table cells.
  const dot = codec.indexOf(".");
  return dot === -1 ? codec : codec.slice(0, dot);
}
