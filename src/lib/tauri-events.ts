// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Leon Kasdorf

import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useJobsStore, type LogStream } from "@/stores/jobs";
import { useSettingsStore } from "@/stores/settings";
import { removeJob, type JobProgress, type JobStatus } from "@/lib/tauri-bridge";
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
      // state. Each terminal status is gated by its own opt-in toggle so
      // a user who wants failure-only toasts can have exactly that.
      if (prev != null && prev.status !== status) {
        const s = useSettingsStore.getState();
        const shouldNotify =
          (status === "completed" && s.notifyOnSuccess) ||
          (status === "failed" && s.notifyOnFailure) ||
          (status === "cancelled" && s.notifyOnCancel);
        if (shouldNotify) {
          void notifyJobFinished(status, url);
        }

        // Schedule auto-clear of a successful download. Failed and
        // cancelled stay around so the user can review the error or
        // retry the URL. Both backend and frontend stores are cleared
        // so the on-disk queue.json drops the entry too — otherwise
        // the auto-cleared job would reappear on the next app start.
        if (
          status === "completed" &&
          s.autoClearSuccess &&
          s.autoClearSuccessAfterSeconds > 0
        ) {
          setTimeout(() => {
            void removeJob(id).catch(() => {
              // Backend removal can fail if the queue manager has
              // already evicted the entry (e.g. via Clear completed
              // racing the timer). Frontend remove is still safe.
            });
            useJobsStore.getState().remove(id);
          }, s.autoClearSuccessAfterSeconds * 1000);
        }
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
