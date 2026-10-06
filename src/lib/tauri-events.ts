// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Leon Kasdorf

import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  useJobsStore,
  type LogLine,
  type LogStream,
  type StatusPatch,
} from "@/stores/jobs";
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

// Backend events are buffered and applied to the store in one update
// per FLUSH_MS instead of one update (and one React render) per event.
// With several parallel downloads each emitting progress a few times a
// second, plus "Cancel all" producing thousands of status events at
// once, per-event updates kept the UI busy re-rendering. A timer rather
// than requestAnimationFrame so batches (and OS notifications) keep
// flowing while the window is hidden in the tray.
const FLUSH_MS = 100;

let pendingProgress = new Map<string, JobProgress>();
let pendingStatuses: StatusPatch[] = [];
let pendingLogs = new Map<string, LogLine[]>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleFlush() {
  if (flushTimer == null) flushTimer = setTimeout(flush, FLUSH_MS);
}

function flush() {
  flushTimer = null;
  const progress = pendingProgress;
  const statuses = pendingStatuses;
  const logs = pendingLogs;
  pendingProgress = new Map();
  pendingStatuses = [];
  pendingLogs = new Map();

  // Status side effects compare against the status before this batch;
  // `seen` tracks it across several patches for the same job.
  const store = useJobsStore.getState();
  const seen = new Map<string, JobStatus>();
  for (const { id, status } of statuses) {
    const prev = seen.get(id) ?? store.jobs[id]?.status;
    seen.set(id, status);
    const job = store.jobs[id];
    if (job != null && prev !== status) onStatusChange(id, status, job.spec.url);
  }

  store.applyBatch({ progress, statuses, logs });
}

// Fire OS notification only on actual transition into a terminal state.
// Each terminal status is gated by its own opt-in toggle so a user who
// wants failure-only toasts can have exactly that.
function onStatusChange(id: string, status: JobStatus, url: string) {
  const s = useSettingsStore.getState();
  const shouldNotify =
    (status === "completed" && s.notifyOnSuccess) ||
    (status === "failed" && s.notifyOnFailure) ||
    (status === "cancelled" && s.notifyOnCancel);
  if (shouldNotify) {
    void notifyJobFinished(status, url);
  }

  // Schedule auto-clear of a successful download. Failed and cancelled
  // stay around so the user can review the error or retry the URL. Both
  // backend and frontend stores are cleared so the on-disk queue.json
  // drops the entry too — otherwise the auto-cleared job would reappear
  // on the next app start.
  if (status === "completed" && s.autoClearSuccess && s.autoClearSuccessAfterSeconds > 0) {
    setTimeout(() => {
      void removeJob(id).catch(() => {
        // Backend removal can fail if the queue manager has already
        // evicted the entry (e.g. via Clear completed racing the
        // timer). Frontend remove is still safe.
      });
      useJobsStore.getState().remove(id);
    }, s.autoClearSuccessAfterSeconds * 1000);
  }
}

// Wires the global Tauri event listeners for job updates. Idempotent —
// safe to call multiple times (e.g. under React StrictMode double-mount).
export async function startJobListeners(): Promise<void> {
  if (started) return;
  started = true;

  unlisten.push(
    await listen<ProgressPayload>("job-progress", (e) => {
      const { id, ...progress } = e.payload;
      pendingProgress.set(id, progress);
      scheduleFlush();
    }),
  );

  unlisten.push(
    await listen<StatusPayload>("job-status", (e) => {
      const { id, status, error } = e.payload;
      pendingStatuses.push({ id, status, error: error ?? null });
      scheduleFlush();
    }),
  );

  unlisten.push(
    await listen<boolean>("queue-paused", (e) => {
      useJobsStore.getState().setQueuePaused(e.payload);
    }),
  );

  unlisten.push(
    await listen<LogPayload>("job-log-line", (e) => {
      const { id, line, stream } = e.payload;
      const buf = pendingLogs.get(id);
      if (buf) buf.push({ line, stream });
      else pendingLogs.set(id, [{ line, stream }]);
      scheduleFlush();
    }),
  );
}

export function stopJobListeners(): void {
  for (const fn of unlisten) fn();
  unlisten = [];
  started = false;
  if (flushTimer != null) {
    clearTimeout(flushTimer);
    flush();
  }
}
