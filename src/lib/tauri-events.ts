// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Leon Kasdorf

import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useJobsStore, type LogStream } from "@/stores/jobs";
import { useSettingsStore } from "@/stores/settings";
import type { JobProgress, JobStatus } from "@/lib/tauri-bridge";
import { notifyJobFinished } from "@/lib/notify";

let started = false;
let unlisten: UnlistenFn[] = [];

interface ProgressPayload extends JobProgress {
  id: string;
}
interface StatusPayload {
  id: string;
  status: JobStatus;
  error?: string | null;
}
interface LogPayload {
  id: string;
  line: string;
  stream: LogStream;
}

// Wires the global Tauri event listeners for job updates. Idempotent —
// safe to call multiple times (e.g. under React StrictMode double-mount).
export async function startJobListeners(): Promise<void> {
  if (started) return;
  started = true;

  unlisten.push(
    await listen<ProgressPayload>("job-progress", (e) => {
      const { id, ...progress } = e.payload;
      useJobsStore.getState().patchProgress(id, progress);
    }),
  );

  unlisten.push(
    await listen<StatusPayload>("job-status", (e) => {
      const { id, status, error } = e.payload;
      const prev = useJobsStore.getState().jobs[id];
      const url = prev?.spec.url ?? id;
      useJobsStore.getState().patchStatus(id, status, error ?? null);

      // Fire OS notification only on actual transition into a terminal
      // state and only if the user opted in. Cancelled is intentionally
      // excluded — the user just clicked Cancel, no need to toast back.
      if (
        prev != null &&
        prev.status !== status &&
        (status === "completed" || status === "failed") &&
        useSettingsStore.getState().notifyOnFinish
      ) {
        void notifyJobFinished(status, url);
      }
    }),
  );

  unlisten.push(
    await listen<LogPayload>("job-log-line", (e) => {
      const { id, line, stream } = e.payload;
      useJobsStore.getState().appendLog(id, { line, stream });
    }),
  );
}

export function stopJobListeners(): void {
  for (const fn of unlisten) fn();
  unlisten = [];
  started = false;
}
