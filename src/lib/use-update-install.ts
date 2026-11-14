// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Leon Kasdorf

import { useState } from "react";
import { relaunch } from "@tauri-apps/plugin-process";
import type { Update } from "@tauri-apps/plugin-updater";
import { formatBytes } from "@/lib/format-utils";
import { prepareForUpdate, resumeAfterFailedUpdate } from "@/lib/tauri-bridge";

export interface UpdateInstall {
  /// Button label while the install is in flight, `null` when idle.
  installing: string | null;
  /// The installer ran; the app is about to restart.
  installed: boolean;
  error: string | null;
  install: () => Promise<void>;
}

// Download + install flow for a signed update, shared by the update
// banner and the About dialog.
export function useUpdateInstall(update: Update | null): UpdateInstall {
  const [installing, setInstalling] = useState<string | null>(null);
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
      if (queueStopped) await resumeAfterFailedUpdate().catch(() => {});
      setError(String(e));
      setInstalling(null);
      setInstalled(false);
    };
    try {
      await update.download((event) => {
        if (event.event === "Started") {
          setInstalling(
            event.data.contentLength != null
              ? `Downloading (${formatBytes(event.data.contentLength)})…`
              : "Downloading…",
          );
        } else if (event.event === "Finished") {
          setInstalling("Installing…");
        }
      });
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

  return { installing, installed, error, install };
}
