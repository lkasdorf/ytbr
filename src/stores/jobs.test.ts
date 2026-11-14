// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Leon Kasdorf

import { beforeEach, describe, expect, it } from "vitest";
import type { JobProgress, JobState, JobStatus } from "@/lib/tauri-bridge";
import {
  countJobs,
  isActive,
  useJobsStore,
  type EventBatch,
  type LogLine,
} from "@/stores/jobs";

function job(id: string, status: JobStatus = "queued", patch: Partial<JobState> = {}): JobState {
  return {
    id,
    spec: { url: `https://example.com/${id}`, formatId: null, outputDir: "." },
    status,
    progress: null,
    error: null,
    ...patch,
  };
}

function progress(downloadedBytes: number, totalBytes = 1000): JobProgress {
  return {
    percent: (downloadedBytes / totalBytes) * 100,
    speedBps: null,
    etaSecs: null,
    downloadedBytes,
    totalBytes,
  };
}

function batch(part: Partial<EventBatch>): EventBatch {
  return { progress: new Map(), statuses: [], logs: new Map(), ...part };
}

const store = () => useJobsStore.getState();

beforeEach(() => {
  useJobsStore.setState(useJobsStore.getInitialState(), true);
});

describe("upsert", () => {
  it("keeps insertion order and replaces an existing job in place", () => {
    store().upsertMany([job("a"), job("b")]);
    store().upsert(job("a", "downloading"));
    expect(store().ids).toEqual(["a", "b"]);
    expect(store().jobs.a.status).toBe("downloading");
  });

  it("applies events that arrived before the job was known", () => {
    // The backend emits "downloading" from the job task; it can reach
    // the webview before enqueue_job resolves and the caller upserts.
    store().applyBatch(batch({ statuses: [{ id: "a", status: "downloading", error: null }] }));
    expect(store().jobs.a).toBeUndefined();

    store().upsert(job("a", "queued"));
    expect(store().jobs.a.status).toBe("downloading");
    expect(store().early).toEqual({});
  });
});

describe("applyBatch", () => {
  it("infers 'downloading' from a progress line on a queued job", () => {
    store().upsert(job("a", "queued"));
    const before = store().statusVersion;
    store().applyBatch(batch({ progress: new Map([["a", progress(100)]]) }));
    expect(store().jobs.a.status).toBe("downloading");
    expect(store().jobs.a.progress?.downloadedBytes).toBe(100);
    expect(store().statusVersion).toBe(before + 1);
  });

  it("does not bump statusVersion for a plain progress tick", () => {
    store().upsert(job("a", "downloading"));
    const { statusVersion, progressVersion } = store();
    store().applyBatch(batch({ progress: new Map([["a", progress(200)]]) }));
    expect(store().statusVersion).toBe(statusVersion);
    expect(store().progressVersion).toBe(progressVersion + 1);
  });

  it("clears the progress of a job that goes back to 'queued'", () => {
    store().upsert(job("a", "downloading", { progress: progress(500) }));
    store().applyBatch(batch({ statuses: [{ id: "a", status: "queued", error: null }] }));
    expect(store().jobs.a.progress).toBeNull();
  });

  it("keeps the progress of a job that finishes", () => {
    store().upsert(job("a", "downloading", { progress: progress(1000) }));
    store().applyBatch(batch({ statuses: [{ id: "a", status: "completed", error: null }] }));
    expect(store().jobs.a.status).toBe("completed");
    expect(store().jobs.a.progress?.downloadedBytes).toBe(1000);
  });

  it("caps each job's log buffer at 500 lines, keeping the newest", () => {
    store().upsert(job("a", "downloading"));
    const lines: LogLine[] = Array.from({ length: 620 }, (_, i) => ({
      line: `line ${i}`,
      stream: "stdout",
    }));
    store().applyBatch(batch({ logs: new Map([["a", lines]]) }));
    expect(store().logs.a).toHaveLength(500);
    expect(store().logs.a[499].line).toBe("line 619");
  });
});

describe("hydrate", () => {
  it("puts events that raced the snapshot on top of it", () => {
    // Listeners are registered before list_jobs is called: a job can
    // finish while the snapshot is in flight.
    store().applyBatch(batch({ statuses: [{ id: "a", status: "completed", error: null }] }));
    store().hydrate([job("a", "downloading"), job("b", "queued")]);
    expect(store().jobs.a.status).toBe("completed");
    expect(store().jobs.b.status).toBe("queued");
    expect(store().ids).toEqual(["a", "b"]);
  });

  it("drops jobs and logs the backend no longer has", () => {
    store().upsertMany([job("old"), job("kept")]);
    store().applyBatch(
      batch({
        logs: new Map([
          ["old", [{ line: "x", stream: "stdout" }]],
          ["kept", [{ line: "y", stream: "stdout" }]],
        ]),
      }),
    );
    store().hydrate([job("kept")]);
    expect(Object.keys(store().jobs)).toEqual(["kept"]);
    expect(Object.keys(store().logs)).toEqual(["kept"]);
  });
});

describe("setTitle", () => {
  it("sets the title on the spec and signals list views", () => {
    store().upsert(job("a"));
    const before = store().statusVersion;
    store().setTitle("a", "Big Buck Bunny");
    expect(store().jobs.a.spec.title).toBe("Big Buck Bunny");
    expect(store().statusVersion).toBe(before + 1);
  });

  it("is a no-op for an unchanged title or an unknown job", () => {
    store().upsert(job("a"));
    store().setTitle("a", "Same");
    const snapshot = store();
    store().setTitle("a", "Same");
    store().setTitle("missing", "Whatever");
    expect(useJobsStore.getState()).toBe(snapshot);
  });
});

describe("clearTerminal / remove", () => {
  it("clearTerminal keeps only active jobs", () => {
    store().upsertMany([job("a", "completed"), job("b", "downloading"), job("c", "failed")]);
    store().clearTerminal();
    expect(store().ids).toEqual(["b"]);
  });

  it("remove drops the job and its logs", () => {
    store().upsert(job("a", "completed"));
    store().applyBatch(batch({ logs: new Map([["a", [{ line: "x", stream: "stderr" }]]]) }));
    store().remove("a");
    expect(store().jobs.a).toBeUndefined();
    expect(store().logs.a).toBeUndefined();
    expect(store().ids).toEqual([]);
  });
});

describe("countJobs / isActive", () => {
  it("counts paused jobs as active and terminal ones as done", () => {
    const jobs = Object.fromEntries(
      (
        [
          ["a", "queued"],
          ["b", "queued"],
          ["c", "downloading"],
          ["d", "paused"],
          ["e", "completed"],
          ["f", "failed"],
          ["g", "cancelled"],
        ] as const
      ).map(([id, status]) => [id, job(id, status)]),
    );
    expect(countJobs(jobs)).toEqual({ active: 4, queued: 2, done: 3 });
    expect(isActive("paused")).toBe(true);
    expect(isActive("cancelled")).toBe(false);
  });
});
