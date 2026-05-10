// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Leon Kasdorf

import { create } from "zustand";
import type { JobProgress, JobState, JobStatus } from "@/lib/tauri-bridge";

interface JobsStore {
  jobs: Record<string, JobState>;
  ids: string[];

  upsert: (job: JobState) => void;
  patchProgress: (id: string, progress: JobProgress) => void;
  patchStatus: (id: string, status: JobStatus, error: string | null) => void;
  remove: (id: string) => void;
  hydrate: (list: JobState[]) => void;
  clearTerminal: () => void;
}

const TERMINAL: ReadonlyArray<JobStatus> = ["completed", "failed", "cancelled"];

export const useJobsStore = create<JobsStore>((set) => ({
  jobs: {},
  ids: [],

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

  remove: (id) =>
    set((s) => {
      if (s.jobs[id] == null) return s;
      const next = { ...s.jobs };
      delete next[id];
      return { jobs: next, ids: s.ids.filter((x) => x !== id) };
    }),

  hydrate: (list) =>
    set(() => ({
      jobs: Object.fromEntries(list.map((j) => [j.id, j])),
      ids: list.map((j) => j.id),
    })),

  clearTerminal: () =>
    set((s) => {
      const ids = s.ids.filter((id) => !TERMINAL.includes(s.jobs[id].status));
      const jobs: Record<string, JobState> = {};
      for (const id of ids) jobs[id] = s.jobs[id];
      return { jobs, ids };
    }),
}));

export function isActive(status: JobStatus): boolean {
  // Paused counts as active: the OS process still exists, the queue
  // permit is still held, and the job belongs in the running set.
  return status === "queued" || status === "downloading" || status === "paused";
}
