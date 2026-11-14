// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Leon Kasdorf

import { useState } from "react";
import { relaunch } from "@tauri-apps/plugin-process";
import type { Update } from "@tauri-apps/plugin-updater";
import { prepareForUpdate, resumeAfterFailedUpdate } from "@/lib/tauri-bridge";
import {
  downloadButtonLabel,
  SpeedMeter,
  type DownloadProgress,
} from "@/lib/update-progress";

export interface UpdateInstall {
  /// Button label while the install is in flight, `null` when idle.
  installing: string | null;
  /// Set while the update is downloading; drives the progress bar.
  progress: DownloadProgress | null;
  /// The installer ran; the app is about to restart.
  installed: boolean;
  error: string | null;
  install: () => Promise<void>;
}

// How often the progress display is refreshed while downloading.
const PROGRESS_PAINT_MS = 500;

// Download + install flow for a signed update, shared by the update
// banner and the About dialog.
export function useUpdateInstall(update: Update | null): UpdateInstall {
  const [installing, setInstalling] = useState<string | null>(null);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [installed, setInstalled] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function install() {
    if (update == null) return;
    setInstalling("Downloading…");
    setError(null);
    let queueStopped = false;
    // The installer didn't take over (declined elevation prompt, bad
    // signature, ...) and the app keeps running: bring the queue back,
    // otherwise it stays shut down until the next start.
    const fail = async (e: unknown) => {
      stopPainting();
      if (queueStopped) await resumeAfterFailedUpdate().catch(() => {});
      setError(String(e));
      setInstalling(null);
      setProgress(null);
      setInstalled(false);
    };
    // Repaints on a timer rather than per chunk: the updater reports
    // every chunk it receives, and the timer also has to tick when no
    // chunk arrives at all — that is how a stalled download shows up.
    let painter: ReturnType<typeof setInterval> | null = null;
    const stopPainting = () => {
      if (painter != null) clearInterval(painter);
      painter = null;
    };
    try {
      let received = 0;
      let total: number | null = null;
      let lastChunkAt = Date.now();
      const meter = new SpeedMeter();
      const paint = () => {
        const now = Date.now();
        meter.add(now, received);
        const next = {
          received,
          total,
          speedBps: meter.rate(),
          idleSecs: Math.floor((now - lastChunkAt) / 1000),
        };
        setProgress(next);
        setInstalling(downloadButtonLabel(next));
      };
      await update.download((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? null;
          lastChunkAt = Date.now();
          paint();
          painter ??= setInterval(paint, PROGRESS_PAINT_MS);
        } else if (event.event === "Progress") {
          received += event.data.chunkLength;
          lastChunkAt = Date.now();
        } else if (event.event === "Finished") {
          stopPainting();
          setProgress(null);
          setInstalling("Installing…");
        }
      });
      stopPainting();
      // install() exits the app on Windows before RunEvent::Exit fires:
      // save the queue (it resumes after the update) and stop running
      // downloads first. Done after the download so a failed download
      // leaves the running jobs alone.
      queueStopped = true;
      await prepareForUpdate();
      await update.install();
      setInstalled(true);
      setInstalling(null);
      // A short pause so "Installed — restarting" is visible for a beat.
      setTimeout(() => void relaunch().catch(fail), 600);
    } catch (e: unknown) {
      await fail(e);
    }
  }

  return { installing, progress, installed, error, install };
}
