// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Leon Kasdorf

import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import type { JobStatus } from "@/lib/tauri-bridge";

// Permission state is requested lazily on the first finish notification so
// the user never sees the OS prompt before any job has actually run. Cached
// after the first resolution to avoid re-asking on every event.
let permissionResolved: Promise<boolean> | null = null;

async function ensurePermission(): Promise<boolean> {
  if (permissionResolved == null) {
    permissionResolved = (async () => {
      if (await isPermissionGranted()) return true;
      const result = await requestPermission();
      return result === "granted";
    })().catch(() => false);
  }
  return permissionResolved;
}

export async function notifyJobFinished(
  status: JobStatus,
  url: string,
): Promise<void> {
  if (status !== "completed" && status !== "failed") return;
  if (!(await ensurePermission())) return;

  const title = status === "completed" ? "Download finished" : "Download failed";
  sendNotification({ title, body: url });
}
