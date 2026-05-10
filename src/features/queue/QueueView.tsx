// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Leon Kasdorf

import { useMemo, useState } from "react";
import {
  CheckCircle2,
  CircleDashed,
  Loader2,
  Pause,
  Play,
  StopCircle,
  Trash2,
  XCircle,
} from "lucide-react";
import {
  cancelJob,
  clearCompletedJobs,
  pauseJob,
  resumeJob,
  type JobState,
  type JobStatus,
} from "@/lib/tauri-bridge";
import { isActive, useJobsStore } from "@/stores/jobs";
import { formatBytes } from "@/lib/format-utils";
import { cn } from "@/lib/utils";

type SortMode =
  | "newest"
  | "oldest"
  | "status"
  | "progress-desc"
  | "progress-asc";

interface SortOption {
  id: SortMode;
  label: string;
}

const SORT_OPTIONS: readonly SortOption[] = [
  { id: "newest", label: "Newest first" },
  { id: "oldest", label: "Oldest first" },
  { id: "status", label: "Status (active first)" },
  { id: "progress-desc", label: "Progress (high → low)" },
  { id: "progress-asc", label: "Progress (low → high)" },
];

// Lower rank surfaces sooner. Active jobs first, then queued, then
// failures (likely to need attention), then completed, then cancelled.
const STATUS_RANK: Record<JobStatus, number> = {
  downloading: 0,
  paused: 1,
  queued: 2,
  failed: 3,
  completed: 4,
  cancelled: 5,
};

export function QueueView() {
  const jobs = useJobsStore((s) => s.jobs);
  const ids = useJobsStore((s) => s.ids);
  const [sort, setSort] = useState<SortMode>("newest");

  // `ids` is insertion order — earlier index means older. Used both as
  // a created-at proxy and as the deterministic tie-breaker for sorts
  // that have ties (status, progress).
  const ordered = useMemo(() => {
    const indexOf = new Map(ids.map((id, i) => [id, i]));
    const list = ids
      .map((id) => jobs[id])
      .filter((j): j is JobState => j != null);

    const newer = (a: JobState, b: JobState) =>
      (indexOf.get(b.id) ?? 0) - (indexOf.get(a.id) ?? 0);

    switch (sort) {
      case "newest":
        return list.sort(newer);
      case "oldest":
        return list.sort((a, b) => -newer(a, b));
      case "status":
        return list.sort(
          (a, b) =>
            STATUS_RANK[a.status] - STATUS_RANK[b.status] || newer(a, b),
        );
      case "progress-desc":
        return list.sort(
          (a, b) =>
            (b.progress?.percent ?? 0) - (a.progress?.percent ?? 0) ||
            newer(a, b),
        );
      case "progress-asc":
        return list.sort(
          (a, b) =>
            (a.progress?.percent ?? 0) - (b.progress?.percent ?? 0) ||
            newer(a, b),
        );
    }
  }, [ids, jobs, sort]);

  const hasTerminal = ordered.some(
    (j) => j.status === "completed" || j.status === "failed" || j.status === "cancelled",
  );

  if (ordered.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-card-foreground">
        <p className="text-sm text-muted-foreground">
          No downloads yet. Probe a URL and click the download icon next to a format.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Sort</span>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortMode)}
            className={cn(
              "rounded-md border border-border bg-input px-2 py-1 text-xs",
              "text-foreground focus:outline-none focus:ring-1 focus:ring-ring",
            )}
            aria-label="Sort queue"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        {hasTerminal && (
          <button
            onClick={() => {
              void clearCompletedJobs();
              useJobsStore.getState().clearTerminal();
            }}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground hover:bg-secondary/80"
          >
            <Trash2 className="size-3.5" />
            Clear completed
          </button>
        )}
      </div>
      {ordered.map((job) => (
        <JobCard key={job.id} job={job} />
      ))}
    </div>
  );
}

function JobCard({ job }: { job: JobState }) {
  const p = job.progress;
  const percent = p?.percent ?? 0;
  const showBar = isActive(job.status) || job.status === "completed";

  return (
    <div className="rounded-lg border border-border bg-card p-4 text-card-foreground">
      <div className="flex items-start gap-3">
        <StatusIcon status={job.status} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <p className="truncate text-sm font-medium" title={job.spec.url}>
              {job.spec.url}
            </p>
            <StatusBadge status={job.status} />
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            <span>format </span>
            <code className="font-mono">{job.spec.formatId ?? "default"}</code>
            <span> · → </span>
            <span className="font-mono">{job.spec.outputDir}</span>
          </p>

          {showBar && (
            <div className="mt-3">
              <ProgressBar percent={percent} indeterminate={p?.totalBytes == null && job.status === "downloading"} />
              <div className="mt-1.5 flex items-center justify-between text-xs text-muted-foreground tabular-nums">
                <span>{formatBytesPair(p?.downloadedBytes, p?.totalBytes)}</span>
                <span>
                  {job.status === "downloading" && p
                    ? `${formatSpeed(p.speedBps)} · ETA ${etaDisplay(p.etaSecs)}`
                    : job.status === "paused"
                      ? "paused"
                      : job.status === "completed"
                        ? "done"
                        : ""}
                </span>
              </div>
            </div>
          )}

          {job.status === "failed" && job.error && (
            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md border border-destructive/40 bg-destructive/10 p-2 font-mono text-xs">
              {job.error}
            </pre>
          )}
        </div>

        {isActive(job.status) && (
          <div className="flex shrink-0 flex-col gap-1.5">
            {job.status === "downloading" && (
              <IconButton
                title="Pause"
                onClick={() => void pauseJob(job.id)}
                icon={Pause}
              />
            )}
            {job.status === "paused" && (
              <IconButton
                title="Resume"
                onClick={() => void resumeJob(job.id)}
                icon={Play}
              />
            )}
            <button
              onClick={() => void cancelJob(job.id)}
              className="rounded-md border border-border bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground hover:bg-destructive hover:text-destructive-foreground"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function IconButton({
  title,
  onClick,
  icon: Icon,
}: {
  title: string;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      className="flex items-center justify-center rounded-md border border-border bg-secondary px-2.5 py-1 text-secondary-foreground transition-colors hover:bg-secondary/80"
    >
      <Icon className="size-3.5" />
    </button>
  );
}

function ProgressBar({ percent, indeterminate }: { percent: number; indeterminate?: boolean }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
      <div
        className={cn(
          "h-full rounded-full bg-primary transition-[width] duration-200 ease-out",
          indeterminate && "animate-pulse",
        )}
        style={{ width: indeterminate ? "30%" : `${Math.min(100, Math.max(0, percent)).toFixed(1)}%` }}
      />
    </div>
  );
}

function StatusIcon({ status }: { status: JobStatus }) {
  const cls = "mt-0.5 size-4 shrink-0";
  switch (status) {
    case "queued":      return <CircleDashed className={cn(cls, "text-muted-foreground")} />;
    case "downloading": return <Loader2 className={cn(cls, "animate-spin text-primary")} />;
    case "paused":      return <Pause className={cn(cls, "text-amber-500")} />;
    case "completed":   return <CheckCircle2 className={cn(cls, "text-emerald-500")} />;
    case "failed":      return <XCircle className={cn(cls, "text-destructive")} />;
    case "cancelled":   return <StopCircle className={cn(cls, "text-muted-foreground")} />;
  }
}

function StatusBadge({ status }: { status: JobStatus }) {
  const styles: Record<JobStatus, string> = {
    queued:      "bg-muted text-muted-foreground",
    downloading: "bg-primary/15 text-primary",
    paused:      "bg-amber-500/15 text-amber-500",
    completed:   "bg-emerald-500/15 text-emerald-500",
    failed:      "bg-destructive/15 text-destructive",
    cancelled:   "bg-muted text-muted-foreground",
  };
  return (
    <span className={cn("rounded-md px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide", styles[status])}>
      {status}
    </span>
  );
}

function formatBytesPair(downloaded: number | null | undefined, total: number | null | undefined): string {
  const d = formatBytes(downloaded);
  const t = total != null ? formatBytes(total) : "?";
  return `${d} / ${t}`;
}

function etaDisplay(secs: number | null | undefined): string {
  if (secs == null) return "—";
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatSpeed(bytesPerSec: number | null | undefined): string {
  if (bytesPerSec == null) return "—";
  return `${formatBytes(bytesPerSec)}/s`;
}
