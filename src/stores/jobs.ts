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

interface JobsStore {
  jobs: Record<string, JobState>;
  ids: string[];
  logs: Record<string, LogLine[]>;

  upsert: (job: JobState) => void;
  patchProgress: (id: string, progress: JobProgress) => void;
  patchStatus: (id: string, status: JobStatus, error: string | null) => void;
  appendLog: (id: string, log: LogLine) => void;
  remove: (id: string) => void;
  hydrate: (list: JobState[]) => void;
  clearTerminal: () => void;
}

const TERMINAL: ReadonlyArray<JobStatus> = ["completed", "failed", "cancelled"];

export const useJobsStore = create<JobsStore>((set) => ({
  jobs: {},
  ids: [],
  logs: {},

  upsert: (job) =>
    set((s) => {
      const exists = s.jobs[job.id] != null;
      return {
        jobs: { ...s.jobs, [job.id]: job },
        ids: exists ? s.ids : [...s.ids, job.id],
      };
    }),

  patchProgress: (id, progress) =>
    set((s) => {
      const current = s.jobs[id];
      if (!current) return s;
      return { jobs: { ...s.jobs, [id]: { ...current, progress } } };
    }),

  patchStatus: (id, status, error) =>
    set((s) => {
      const current = s.jobs[id];
      if (!current) return s;
      return { jobs: { ...s.jobs, [id]: { ...current, status, error } } };
    }),

  appendLog: (id, log) =>
    set((s) => {
      const cur = s.logs[id] ?? [];
      const next =
        cur.length < LOG_BUFFER_CAP ? [...cur, log] : [...cur.slice(1), log];
      return { logs: { ...s.logs, [id]: next } };
    }),

  remove: (id) =>
    set((s) => {
      if (s.jobs[id] == null) return s;
      const nextJobs = { ...s.jobs };
      delete nextJobs[id];
      const nextLogs = { ...s.logs };
      delete nextLogs[id];
      return { jobs: nextJobs, ids: s.ids.filter((x) => x !== id), logs: nextLogs };
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
      return { jobs, ids, logs };
    }),
}));

export function isActive(status: JobStatus): boolean {
  // Paused counts as active: the OS process still exists, the queue
  // permit is still held, and the job belongs in the running set.
  return status === "queued" || status === "downloading" || status === "paused";
}
