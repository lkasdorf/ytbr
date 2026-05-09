// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Leon Kasdorf

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Download as DownloadIcon } from "lucide-react";
import type { Format } from "@/lib/tauri-bridge";
import {
  classifyFormat,
  formatBitrate,
  formatBytes,
  formatFps,
  formatResolution,
  shortCodec,
  type FormatKind,
} from "@/lib/format-utils";
import { cn } from "@/lib/utils";

type Filter = "all" | "video+audio" | "video" | "audio";
type SortKey =
  | "formatId"
  | "container"
  | "resolution"
  | "fps"
  | "vcodec"
  | "acodec"
  | "filesize"
  | "bitrate";
type SortDir = "asc" | "desc";

interface Props {
  formats: Format[];
  onDownload?: (format: Format) => void;
  downloadDisabledReason?: string;
}

const COLUMNS: { key: SortKey; label: string; align?: "right" }[] = [
  { key: "formatId",   label: "ID" },
  { key: "container",  label: "Container" },
  { key: "resolution", label: "Resolution" },
  { key: "fps",        label: "FPS",      align: "right" },
  { key: "vcodec",     label: "Video codec" },
  { key: "acodec",     label: "Audio codec" },
  { key: "filesize",   label: "Size",     align: "right" },
  { key: "bitrate",    label: "Bitrate",  align: "right" },
];

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all",         label: "All" },
  { value: "video+audio", label: "Combined" },
  { value: "video",       label: "Video only" },
  { value: "audio",       label: "Audio only" },
];

export function FormatTable({ formats, onDownload, downloadDisabledReason }: Props) {
  const [filter, setFilter] = useState<Filter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("filesize");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const visible = useMemo(() => {
    const filtered =
      filter === "all"
        ? formats
        : formats.filter((f) => classifyFormat(f.vcodec, f.acodec) === filter);
    return [...filtered].sort((a, b) => cmp(a, b, sortKey) * (sortDir === "asc" ? 1 : -1));
  }, [formats, filter, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(numericKey(key) ? "desc" : "asc");
    }
  }

  const downloadDisabled = downloadDisabledReason != null;
  const totalCols = COLUMNS.length + (onDownload ? 1 : 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-1 text-xs">
        {FILTERS.map((opt) => {
          const count =
            opt.value === "all"
              ? formats.length
              : formats.filter((f) => classifyFormat(f.vcodec, f.acodec) === opt.value).length;
          const active = filter === opt.value;
          return (
            <button
              key={opt.value}
              onClick={() => setFilter(opt.value)}
              className={cn(
                "rounded-md px-2.5 py-1 font-medium transition-colors",
                active
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground",
              )}
            >
              {opt.label}
              <span className="ml-1.5 opacity-70">{count}</span>
            </button>
          );
        })}
      </div>

      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  className={cn(
                    "px-3 py-2 font-medium",
                    col.align === "right" ? "text-right" : "text-left",
                  )}
                >
                  <button
                    onClick={() => toggleSort(col.key)}
                    className={cn(
                      "inline-flex items-center gap-1 transition-colors hover:text-foreground",
                      sortKey === col.key && "text-foreground",
                    )}
                  >
                    {col.label}
                    {sortKey === col.key ? (
                      sortDir === "asc" ? (
                        <ArrowUp className="size-3" />
                      ) : (
                        <ArrowDown className="size-3" />
                      )
                    ) : (
                      <ArrowUpDown className="size-3 opacity-40" />
                    )}
                  </button>
                </th>
              ))}
              {onDownload && <th className="w-12 px-3 py-2"></th>}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td
                  colSpan={totalCols}
                  className="px-3 py-6 text-center text-sm text-muted-foreground"
                >
                  No formats match this filter.
                </td>
              </tr>
            ) : (
              visible.map((f) => (
                <tr
                  key={f.formatId}
                  className="border-t border-border transition-colors hover:bg-muted/30"
                >
                  <td className="px-3 py-2 font-mono text-xs">{f.formatId}</td>
                  <td className="px-3 py-2 uppercase">{f.container}</td>
                  <td className="px-3 py-2">{formatResolution(f.width, f.height)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatFps(f.fps)}</td>
                  <td className="px-3 py-2 font-mono text-xs">{shortCodec(f.vcodec)}</td>
                  <td className="px-3 py-2 font-mono text-xs">{shortCodec(f.acodec)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatBytes(f.filesizeBytes)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatBitrate(f.bitrateKbps)}
                  </td>
                  {onDownload && (
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => onDownload(f)}
                        disabled={downloadDisabled}
                        title={downloadDisabledReason ?? "Download this format"}
                        className={cn(
                          "rounded-md p-1.5 transition-colors",
                          downloadDisabled
                            ? "cursor-not-allowed text-muted-foreground/40"
                            : "text-muted-foreground hover:bg-primary hover:text-primary-foreground",
                        )}
                      >
                        <DownloadIcon className="size-4" />
                      </button>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function numericKey(key: SortKey): boolean {
  return key === "fps" || key === "filesize" || key === "bitrate" || key === "resolution";
}

function cmp(a: Format, b: Format, key: SortKey): number {
  switch (key) {
    case "formatId": {
      const an = Number(a.formatId);
      const bn = Number(b.formatId);
      if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
      return a.formatId.localeCompare(b.formatId);
    }
    case "container":
      return a.container.localeCompare(b.container);
    case "resolution":
      return num(a.height) - num(b.height) || num(a.width) - num(b.width);
    case "fps":
      return num(a.fps) - num(b.fps);
    case "vcodec":
      return codecRank(a.vcodec, b.vcodec);
    case "acodec":
      return codecRank(a.acodec, b.acodec);
    case "filesize":
      return num(a.filesizeBytes) - num(b.filesizeBytes);
    case "bitrate":
      return num(a.bitrateKbps) - num(b.bitrateKbps);
  }
}

function num(v: number | null): number {
  return v ?? -1;
}

function codecRank(a: string, b: string): number {
  const aEmpty = a === "none" || a === "";
  const bEmpty = b === "none" || b === "";
  if (aEmpty && !bEmpty) return -1;
  if (!aEmpty && bEmpty) return 1;
  return a.localeCompare(b);
}

export type { FormatKind };
