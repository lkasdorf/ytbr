// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Leon Kasdorf

import { ArrowRight, Layers } from "lucide-react";
import { detectPlaylistKind } from "@/lib/url-detect";
import { cn } from "@/lib/utils";

interface Props {
  url: string;
  onSwitchToBatch: (url: string) => void;
}

export function PlaylistRedirect({ url, onSwitchToBatch }: Props) {
  const trimmed = url.trim();
  if (trimmed.length === 0) return null;

  const hint = detectPlaylistKind(trimmed);
  if (hint.kind == null) return null;

  const copy = COPY[hint.kind];

  return (
    <div className="flex items-center gap-3 rounded-lg border border-primary/40 bg-primary/5 p-3">
      <Layers className="size-4 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-foreground">{copy.title}</p>
        <p className="truncate text-xs text-muted-foreground">{copy.body}</p>
      </div>
      <button
        type="button"
        onClick={() => onSwitchToBatch(trimmed)}
        className={cn(
          "flex shrink-0 items-center gap-1 rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground transition-colors",
          "hover:bg-primary/90",
        )}
      >
        Open in Batch
        <ArrowRight className="size-3" />
      </button>
    </div>
  );
}

const COPY: Record<
  Exclude<ReturnType<typeof detectPlaylistKind>["kind"], null>,
  { title: string; body: string }
> = {
  playlist: {
    title: "Looks like a playlist",
    body: "The Download tab probes a single video. Use the Batch tab to expand all entries.",
  },
  channel: {
    title: "Looks like a channel URL",
    body: "Open in the Batch tab to expand the channel's videos. Tip: append /videos for predictable behavior.",
  },
  "video-in-playlist": {
    title: "Single video inside a playlist",
    body: "The Download tab will probe just this video. Switch to Batch to download the full playlist instead.",
  },
};
