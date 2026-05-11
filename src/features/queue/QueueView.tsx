// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Leon Kasdorf

import { useMemo, useState } from "react";
import {
  CheckCircle2,
  CircleDashed,
  FolderOpen,
  ListVideo,
  Loader2,
  Pause,
  Play,
  RotateCw,
  StopCircle,
  XCircle,
} from "lucide-react";
import {
  cancelJob,
  enqueueJob,
  pauseJob,
  resumeJob,
  revealInFolder,
  type JobState,
  type JobStatus,
} from "@/lib/tauri-bridge";
import { isActive, useJobsStore, type LogLine } from "@/stores/jobs";
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
    // Queue tab shows live work only. Terminal jobs live in the
    // History tab so the queue stays focused on what's in flight.
    const list = ids
      .map((id) => jobs[id])
      .filter((j): j is JobState => j != null)
      .filter((j) => !isTerminal(j.status));

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

  if (ordered.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-card/40 px-6 py-12 text-card-foreground">
        <ListVideo
          className="size-10 text-muted-foreground/40"
          strokeWidth={1.5}
        />
        <p className="text-sm font-medium text-foreground">No active jobs</p>
        <p className="max-w-xs text-center text-xs text-muted-foreground">
          Probe a URL on the Download tab and click the download icon next to a
          format, or paste a list on the Batch tab. Finished jobs move to the
          History tab.
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
              "[&>option]:bg-card [&>option]:text-foreground",
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
      </div>
      {ordered.map((job) => (
        <JobCard key={job.id} job={job} />
      ))}
    </div>
  );
}

export function isTerminal(status: JobStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

export function JobCard({ job }: { job: JobState }) {
  const p = job.progress;
  const percent = p?.percent ?? 0;
  const showBar = isActive(job.status) || job.status === "completed";

  return (
    <div
      className={cn(
        "rounded-lg border border-l-[3px] border-border bg-card p-4 text-card-foreground transition-colors",
        // Status-keyed left accent. Same trick the FormatTable uses
        // for the active filter chip — single-axis chromatic cue, no
        // change to layout. Cancelled stays neutral on purpose since
        // the user initiated it.
        job.status === "downloading" && "border-l-primary",
        job.status === "completed" && "border-l-emerald-500",
        job.status === "failed" && "border-l-destructive",
        job.status === "paused" && "border-l-amber-500",
        job.status === "cancelled" && "border-l-muted-foreground/40",
      )}
    >
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
            <code
              className="font-mono"
              title={job.spec.formatId ?? undefined}
            >
              {job.spec.formatLabel ?? job.spec.formatId ?? "default"}
            </code>
            <span> · → </span>
            <span className="font-mono">{job.spec.outputDir}</span>
          </p>

          {showBar && (
            <div className="mt-3">
              <ProgressBar
                percent={percent}
                indeterminate={p?.totalBytes == null && job.status === "downloading"}
                status={job.status}
              />
              <div className="mt-1.5 flex items-center justify-between font-mono text-xs text-muted-foreground tabular-nums">
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

          <LogsPanel id={job.id} />
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

        {!isActive(job.status) && (
          <div className="flex shrink-0 flex-col gap-1.5">
            <IconButton
              title="Open in folder"
              onClick={() => void revealInFolder(job.spec.outputDir)}
              icon={FolderOpen}
            />
            {(job.status === "failed" || job.status === "cancelled") && (
              <IconButton
                title="Retry — re-queue this job with the same spec"
                onClick={() => void retryJob(job)}
                icon={RotateCw}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Re-queue a previously failed or cancelled job with the same spec.
// The new job gets a fresh UUID from the backend; the original failed
// or cancelled row stays in the queue so the user keeps the error
// context (and can clear it manually via "Clear completed" once the
// retry has settled).
async function retryJob(job: JobState): Promise<void> {
  try {
    const id = await enqueueJob(job.spec);
    useJobsStore.getState().upsert({
      id,
      spec: job.spec,
      status: "queued",
      progress: null,
      error: null,
    });
  } catch (err) {
    console.error("retry failed", err);
  }
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
  // Custom hover/focus tooltip — the native `title` attribute waits
  // ~700ms before showing and renders as an OS popup that ignores the
  // app theme. The CSS-only popover uses `group-hover` + `focus-within`
  // so keyboard users get the same hint without animation jitter.
  return (
    <span className="group relative inline-flex">
      <button
        onClick={onClick}
        aria-label={title}
        className="flex items-center justify-center rounded-md border border-border bg-secondary px-2.5 py-1 text-secondary-foreground transition-colors hover:bg-secondary/80 focus:outline-none focus:ring-1 focus:ring-ring"
      >
        <Icon className="size-3.5" />
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute right-full top-1/2 z-10 mr-2 -translate-y-1/2 whitespace-nowrap rounded-md border border-border bg-card px-2 py-1 text-xs text-card-foreground opacity-0 shadow-md transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {title}
      </span>
    </span>
  );
}

function ProgressBar({
  percent,
  indeterminate,
  status,
}: {
  percent: number;
  indeterminate?: boolean;
  status?: JobStatus;
}) {
  // Indeterminate: a 25%-wide block sweeping left-to-right. The earlier
  // animate-pulse just faded opacity, which read as "broken" rather
  // than "downloading something whose total size isn't known yet".
  if (indeterminate) {
    return (
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className="ytbr-indeterminate absolute inset-y-0 left-0 w-1/4 rounded-full bg-primary" />
      </div>
    );
  }

  const isDownloading = status === "downloading";
  const isComplete = status === "completed";
  const isPaused = status === "paused";
  const fillColor = isComplete
    ? "bg-emerald-500"
    : isPaused
      ? "bg-amber-500"
      : "bg-primary";

  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
      <div
        className={cn(
          "h-full rounded-full transition-[width,background-color] duration-200 ease-out",
          fillColor,
          // Animated tape-stripe overlay only while bytes are flowing.
          // Paused / completed / queued bars stay solid so the queue
          // reads "five active, one done" at a glance.
          isDownloading && "ytbr-stripes",
        )}
        style={{
          width: `${Math.min(100, Math.max(0, percent)).toFixed(1)}%`,
        }}
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

function LogsPanel({ id }: { id: string }) {
  // Select only this job's log slice so LogsPanel re-renders only when
  // its own log buffer changes — sibling jobs streaming at the same
  // time stay quiet. Returns undefined for jobs that have not produced
  // a log line yet (most queued / fresh jobs); empty buffer means we
  // hide the disclosure entirely to keep the card compact.
  const lines = useJobsStore((s) => s.logs[id]);
  if (!lines || lines.length === 0) return null;
  const last: LogLine = lines[lines.length - 1];

  return (
    <details className="group mt-3 rounded-md border border-border/60 bg-muted/30">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted/60">
        <span className="flex items-center gap-1.5">
          <span className="text-foreground/70">Logs</span>
          <span className="rounded-sm bg-muted px-1 font-mono text-[10px]">
            {lines.length}
          </span>
        </span>
        <span className="truncate font-mono text-[10px] text-muted-foreground/80 group-open:hidden">
          {last.line}
        </span>
        <span className="text-muted-foreground/60 group-open:rotate-90 transition-transform">▸</span>
      </summary>
      <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-all border-t border-border/60 bg-background/40 p-2 font-mono text-[11px] leading-snug">
        {lines.map((l, i) => (
          <span
            key={i}
            className={cn("block", l.stream === "stderr" && "text-destructive/90")}
          >
            {l.line}
          </span>
        ))}
      </pre>
    </details>
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
