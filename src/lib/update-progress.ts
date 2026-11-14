// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Leon Kasdorf

import { formatBytes, formatEta } from "@/lib/format-utils";

// How far the download of an app update has come.
export interface DownloadProgress {
  received: number;
  /// Null when the server sent no Content-Length.
  total: number | null;
  /// Current rate in bytes per second; null until enough data has
  /// arrived to tell.
  speedBps: number | null;
  /// Whole seconds since the last data arrived; 0 while it flows.
  idleSecs: number;
}

// After this long without data the detail line says so instead of
// showing a rate. The updater has no timeout of its own: a dead
// connection would otherwise look exactly like a slow one.
export const STALL_HINT_SECS = 20;

// 0..1, or null when the total size is unknown (the bar then runs in
// its indeterminate mode).
export function downloadFraction(p: DownloadProgress): number | null {
  if (p.total == null || p.total <= 0) return null;
  return Math.min(1, Math.max(0, p.received / p.total));
}

// Seconds left at the current rate, or null when that can't be told.
export function downloadEtaSecs(p: DownloadProgress): number | null {
  if (p.total == null || p.speedBps == null || p.speedBps <= 0) return null;
  return Math.max(0, (p.total - p.received) / p.speedBps);
}

// Text on the install button while downloading.
export function downloadButtonLabel(p: DownloadProgress): string {
  const fraction = downloadFraction(p);
  return fraction == null ? "Downloading…" : `Downloading… ${Math.floor(fraction * 100)}%`;
}

// "42.0 MB of 109 MB · 1.20 MB/s · 55s left". The installer is over
// 100 MB; on a slow line the rate and the time left are what tell a
// long download from a stuck one.
export function downloadDetail(p: DownloadProgress): string {
  const parts = [
    p.total != null && p.total > 0
      ? `${formatBytes(p.received)} of ${formatBytes(p.total)}`
      : formatBytes(p.received),
  ];
  if (p.idleSecs >= STALL_HINT_SECS) {
    parts.push(`no data for ${formatEta(p.idleSecs)}`);
  } else if (p.speedBps != null && p.speedBps > 0) {
    parts.push(`${formatBytes(p.speedBps)}/s`);
    const eta = downloadEtaSecs(p);
    if (eta != null) parts.push(`${formatEta(eta)} left`);
  }
  return parts.join(" · ");
}

// Download rate over the last few seconds. An average since the start
// would hide a line that slowed down or recovered.
export class SpeedMeter {
  private samples: { at: number; received: number }[] = [];

  constructor(
    private readonly windowMs = 5000,
    private readonly minSpanMs = 1000,
  ) {}

  add(atMs: number, received: number): void {
    this.samples.push({ at: atMs, received });
    // Keep one sample older than the window as the reference point.
    while (this.samples.length > 2 && atMs - this.samples[1].at >= this.windowMs) {
      this.samples.shift();
    }
  }

  // Bytes per second, or null before `minSpanMs` of data exists.
  rate(): number | null {
    if (this.samples.length < 2) return null;
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    const span = last.at - first.at;
    if (span < this.minSpanMs) return null;
    return ((last.received - first.received) / span) * 1000;
  }
}
