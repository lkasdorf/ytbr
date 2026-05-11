// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Leon Kasdorf
//
// History tab — terminal-state jobs (completed, failed, cancelled).
// The Queue tab is for live work; this tab is for review and retry.
// The job queue is the same store, so re-queued jobs from here pop up
// in the Queue immediately and finished ones flow back here.

import { useMemo, useState } from "react";
import { History, Search, Trash2 } from "lucide-react";
import { clearCompletedJobs, type JobState } from "@/lib/tauri-bridge";
import { useJobsStore } from "@/stores/jobs";
import { cn } from "@/lib/utils";
import { isTerminal, JobCard } from "@/features/queue/QueueView";

type StatusFilter = "all" | "completed" | "failed" | "cancelled";

const FILTERS: { id: StatusFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "completed", label: "Completed" },
  { id: "failed", label: "Failed" },
  { id: "cancelled", label: "Cancelled" },
];

export function HistoryView() {
  const jobs = useJobsStore((s) => s.jobs);
  const ids = useJobsStore((s) => s.ids);
  const clearTerminal = useJobsStore((s) => s.clearTerminal);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"newest" | "oldest">("newest");
  const [confirmClear, setConfirmClear] = useState(false);

  const terminal = useMemo(() => {
    const indexOf = new Map(ids.map((id, i) => [id, i]));
    const list = ids
      .map((id) => jobs[id])
      .filter((j): j is JobState => j != null)
      .filter((j) => isTerminal(j.status));

    const q = query.trim().toLowerCase();
    const filtered = list.filter((j) => {
      if (filter !== "all" && j.status !== filter) return false;
      if (q.length > 0) {
        const url = j.spec.url.toLowerCase();
        const label = (j.spec.formatLabel ?? "").toLowerCase();
        const fmt = (j.spec.formatId ?? "").toLowerCase();
        if (!url.includes(q) && !label.includes(q) && !fmt.includes(q)) {
          return false;
        }
      }
      return true;
    });

    return filtered.sort((a, b) => {
      const ia = indexOf.get(a.id) ?? 0;
      const ib = indexOf.get(b.id) ?? 0;
      return sort === "newest" ? ib - ia : ia - ib;
    });
  }, [ids, jobs, filter, query, sort]);

  const totalTerminal = useMemo(
    () =>
      ids.reduce((n, id) => {
        const j = jobs[id];
        return j != null && isTerminal(j.status) ? n + 1 : n;
      }, 0),
    [ids, jobs],
  );

  if (totalTerminal === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-card/40 px-6 py-12 text-card-foreground">
        <History
          className="size-10 text-muted-foreground/40"
          strokeWidth={1.5}
        />
        <p className="text-sm font-medium text-foreground">No history yet</p>
        <p className="max-w-xs text-center text-xs text-muted-foreground">
          Finished, failed, and cancelled downloads land here. Use the Retry
          button on any failed entry to re-queue with the same spec.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 items-center gap-2 rounded-md border border-border bg-card px-2 py-1 transition-colors focus-within:border-primary/60 focus-within:ring-1 focus-within:ring-ring">
          <Search className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search URL or format…"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent px-1 py-0.5 text-xs text-foreground outline-none placeholder:text-muted-foreground"
            aria-label="Search history"
          />
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Sort</span>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as "newest" | "oldest")}
            className={cn(
              "rounded-md border border-border bg-input px-2 py-1 text-xs",
              "text-foreground focus:outline-none focus:ring-1 focus:ring-ring",
              "[&>option]:bg-card [&>option]:text-foreground",
            )}
            aria-label="Sort history"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>
        </label>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <FilterChip
              key={f.id}
              label={f.label}
              count={countFor(jobs, ids, f.id)}
              active={filter === f.id}
              onClick={() => setFilter(f.id)}
            />
          ))}
        </div>
        {confirmClear ? (
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-muted-foreground">Clear all history?</span>
            <button
              onClick={() => {
                void clearCompletedJobs();
                clearTerminal();
                setConfirmClear(false);
              }}
              className="rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1 font-medium text-destructive hover:bg-destructive hover:text-destructive-foreground"
            >
              Confirm
            </button>
            <button
              onClick={() => setConfirmClear(false)}
              className="rounded-md border border-border bg-secondary px-2.5 py-1 font-medium text-secondary-foreground hover:bg-secondary/80"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmClear(true)}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground hover:bg-secondary/80"
          >
            <Trash2 className="size-3.5" />
            Clear history
          </button>
        )}
      </div>

      {terminal.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card/40 px-6 py-8 text-center text-xs text-muted-foreground">
          Nothing matches the current filter.
        </div>
      ) : (
        terminal.map((job) => <JobCard key={job.id} job={job} />)
      )}
    </div>
  );
}

function countFor(
  jobs: Record<string, JobState | undefined>,
  ids: string[],
  filter: StatusFilter,
): number {
  let n = 0;
  for (const id of ids) {
    const j = jobs[id];
    if (j == null || !isTerminal(j.status)) continue;
    if (filter === "all" || j.status === filter) n += 1;
  }
  return n;
}

function FilterChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors",
        active
          ? "border-primary bg-primary/10 text-foreground"
          : "border-border bg-card text-muted-foreground hover:border-primary/50 hover:text-foreground",
      )}
    >
      <span>{label}</span>
      <span
        className={cn(
          "rounded-full px-1.5 font-mono text-[10px] tabular-nums",
          active ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground/80",
        )}
      >
        {count}
      </span>
    </button>
  );
}

