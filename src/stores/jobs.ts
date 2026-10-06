// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Leon Kasdorf

import { create } from "zustand";
import type { JobProgress, JobState, JobStatus } from "@/lib/tauri-bridge";

export type LogStream = "stdout" | "stderr";

export interface LogLine {
  line: string;
  stream: LogStream;
}

// Per-job log ring buffer. yt-dlp + ffmpeg can be chatty on errors;
// 500 lines × ~200 B is bounded enough to keep all logs in memory
// without surprising users that have left a session running for a
// while. Logs are session-local — backend doesn't persist them.
const LOG_BUFFER_CAP = 500;

// Status / progress events that arrived for an id the store doesn't
// know yet. The backend emits from the spawned job task, so e.g.
// "downloading" can reach the webview before the enqueue_job invoke
// resolves and the caller upserts the job. Buffered here and applied by
// `upsert` so the optimistic "queued" insert can't clobber them.
type EarlyEvents = Partial<Pick<JobState, "status" | "error" | "progress">>;

export interface StatusPatch {
  id: string;
  status: JobStatus;
  error: string | null;
}

// One flush worth of backend events, applied in a single store update
// (see tauri-events.ts). Progress keeps only the latest value per job.
export interface EventBatch {
  progress: Map<string, JobProgress>;
  statuses: StatusPatch[];
  logs: Map<string, LogLine[]>;
}

interface JobsStore {
  jobs: Record<string, JobState>;
  ids: string[];
  logs: Record<string, LogLine[]>;
  early: Record<string, EarlyEvents>;
  // Queue-wide "Pause all" flag, mirrored from the backend via the
  // `queue-paused` event (and fetched once on mount).
  queuePaused: boolean;
  // Bumped whenever the job set or any job's status changes — but not
  // on progress. List views key their filtering / sorting on this so a
  // progress tick re-renders only the affected card, not thousands.
  statusVersion: number;
  // Bumped on progress changes; only progress-based sorts subscribe.
  progressVersion: number;

  upsert: (job: JobState) => void;
  applyBatch: (batch: EventBatch) => void;
  remove: (id: string) => void;
  hydrate: (list: JobState[]) => void;
  clearTerminal: () => void;
  setQueuePaused: (paused: boolean) => void;
}

const TERMINAL: ReadonlyArray<JobStatus> = ["completed", "failed", "cancelled"];

function appendCapped(cur: LogLine[] | undefined, add: LogLine[]): LogLine[] {
  const next = cur ? cur.concat(add) : add.slice();
  return next.length > LOG_BUFFER_CAP ? next.slice(next.length - LOG_BUFFER_CAP) : next;
}

export const useJobsStore = create<JobsStore>((set) => ({
  jobs: {},
  ids: [],
  logs: {},
  early: {},
  queuePaused: false,
  statusVersion: 0,
  progressVersion: 0,

  upsert: (job) =>
    set((s) => {
      const exists = s.jobs[job.id] != null;
      const pending = s.early[job.id];
      const ids = exists ? s.ids : [...s.ids, job.id];
      if (!pending) {
        return {
          jobs: { ...s.jobs, [job.id]: job },
          ids,
          statusVersion: s.statusVersion + 1,
        };
      }
      const early = { ...s.early };
      delete early[job.id];
      return {
        jobs: { ...s.jobs, [job.id]: { ...job, ...pending } },
        ids,
        early,
        statusVersion: s.statusVersion + 1,
      };
    }),

  applyBatch: ({ progress, statuses, logs }) =>
    set((s) => {
      // Copy-on-first-write so an empty part of the batch costs nothing.
      let jobs = s.jobs;
      let early = s.early;
      const touchJob = (id: string, patch: Partial<JobState>) => {
        const current = jobs[id];
        if (current) {
          if (jobs === s.jobs) jobs = { ...s.jobs };
          jobs[id] = { ...current, ...patch };
        } else {
          if (early === s.early) early = { ...s.early };
          early[id] = { ...early[id], ...patch };
        }
      };

      for (const [id, p] of progress) touchJob(id, { progress: p });
      for (const { id, status, error } of statuses) touchJob(id, { status, error });

      let nextLogs = s.logs;
      if (logs.size > 0) {
        nextLogs = { ...s.logs };
        for (const [id, add] of logs) nextLogs[id] = appendCapped(nextLogs[id], add);
      }

      return {
        jobs,
        early,
        logs: nextLogs,
        statusVersion: s.statusVersion + (statuses.length > 0 ? 1 : 0),
        progressVersion: s.progressVersion + (progress.size > 0 ? 1 : 0),
      };
    }),

  remove: (id) =>
    set((s) => {
      if (s.jobs[id] == null) return s;
      const nextJobs = { ...s.jobs };
      delete nextJobs[id];
      const nextLogs = { ...s.logs };
      delete nextLogs[id];
      return {
        jobs: nextJobs,
        ids: s.ids.filter((x) => x !== id),
        logs: nextLogs,
        statusVersion: s.statusVersion + 1,
      };
    }),

  hydrate: (list) =>
    set((s) => {
      // Logs are session-local: keep only those for jobs that survive
      // the rehydrate, drop the rest. Jobs not in the new list have
      // gone away from the backend and their buffers are dead memory.
      const surviving = new Set(list.map((j) => j.id));
      const nextLogs: Record<string, LogLine[]> = {};
      for (const id of Object.keys(s.logs)) {
        if (surviving.has(id)) nextLogs[id] = s.logs[id];
      }
      return {
        jobs: Object.fromEntries(list.map((j) => [j.id, j])),
        ids: list.map((j) => j.id),
        logs: nextLogs,
        early: {},
        statusVersion: s.statusVersion + 1,
      };
    }),

  clearTerminal: () =>
    set((s) => {
      const ids = s.ids.filter((id) => !TERMINAL.includes(s.jobs[id].status));
      const jobs: Record<string, JobState> = {};
      const logs: Record<string, LogLine[]> = {};
      for (const id of ids) {
        jobs[id] = s.jobs[id];
        if (s.logs[id]) logs[id] = s.logs[id];
      }
      return { jobs, ids, logs, statusVersion: s.statusVersion + 1 };
    }),

  setQueuePaused: (queuePaused) => set({ queuePaused }),
}));

export function isActive(status: JobStatus): boolean {
  // Paused counts as active: the OS process still exists, the queue
  // permit is still held, and the job belongs in the running set.
  return status === "queued" || status === "downloading" || status === "paused";
}
