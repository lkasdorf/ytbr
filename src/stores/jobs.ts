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
  // Insert a whole batch in one store update. Adding N jobs one by one
  // copied the job map and id list N times.
  upsertMany: (list: JobState[]) => void;
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

export const useJobsStore = create<JobsStore>((set, get) => ({
  jobs: {},
  ids: [],
  logs: {},
  early: {},
  queuePaused: false,
  statusVersion: 0,
  progressVersion: 0,

  upsert: (job) => get().upsertMany([job]),

  upsertMany: (list) =>
    set((s) => {
      if (list.length === 0) return s;
      const jobs = { ...s.jobs };
      const ids = s.ids.slice();
      let early = s.early;
      for (const job of list) {
        if (jobs[job.id] == null) ids.push(job.id);
        const pending = early[job.id];
        if (pending) {
          if (early === s.early) early = { ...s.early };
          delete early[job.id];
          jobs[job.id] = { ...job, ...pending };
        } else {
          jobs[job.id] = job;
        }
      }
      return { jobs, ids, early, statusVersion: s.statusVersion + 1 };
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

      // A progress line means yt-dlp is running. If the job still reads
      // "queued", its "downloading" event got lost (e.g. jobs resumed at
      // startup before the listeners were registered) — fix it up.
      let inferred = false;
      for (const [id, p] of progress) {
        if (jobs[id]?.status === "queued") {
          touchJob(id, { progress: p, status: "downloading" });
          inferred = true;
        } else {
          touchJob(id, { progress: p });
        }
      }
      for (const { id, status, error } of statuses) {
        // Back to "queued" means the job starts over (requeued after an
        // aborted update install): its old progress no longer applies.
        touchJob(id, status === "queued" ? { status, error, progress: null } : { status, error });
      }

      let nextLogs = s.logs;
      if (logs.size > 0) {
        nextLogs = { ...s.logs };
        for (const [id, add] of logs) nextLogs[id] = appendCapped(nextLogs[id], add);
      }

      return {
        jobs,
        early,
        logs: nextLogs,
        statusVersion: s.statusVersion + (statuses.length > 0 || inferred ? 1 : 0),
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
      // Events that arrived while the snapshot was in flight sit in
      // `early` (their ids were unknown until now). They are newer than
      // the snapshot or equal to it, so they go on top — discarding
      // them left a job that finished in that window stuck on its
      // snapshot status forever.
      const jobs: Record<string, JobState> = {};
      const early: Record<string, EarlyEvents> = {};
      for (const j of list) {
        const pending = s.early[j.id];
        jobs[j.id] = pending ? { ...j, ...pending } : j;
      }
      for (const id of Object.keys(s.early)) {
        if (!surviving.has(id)) early[id] = s.early[id];
      }
      return {
        jobs,
        ids: list.map((j) => j.id),
        logs: nextLogs,
        early,
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

export interface JobCounts {
  /// queued + downloading + paused
  active: number;
  queued: number;
  /// completed + failed + cancelled
  done: number;
}

// One pass over the job map. Callers recompute on `statusVersion`, not
// on every store update — progress ticks don't change any count.
export function countJobs(jobs: Record<string, JobState>): JobCounts {
  const counts: JobCounts = { active: 0, queued: 0, done: 0 };
  for (const id in jobs) {
    const { status } = jobs[id];
    if (isActive(status)) counts.active += 1;
    else counts.done += 1;
    if (status === "queued") counts.queued += 1;
  }
  return counts;
}

export function isActive(status: JobStatus): boolean {
  // Paused counts as active: the OS process still exists, the queue
  // permit is still held, and the job belongs in the running set.
  return status === "queued" || status === "downloading" || status === "paused";
}
