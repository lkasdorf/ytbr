// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Leon Kasdorf

import { Film, Music, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { type PresetId, useSettingsStore } from "@/stores/settings";

export type PresetKind = "audio" | "video";

interface Props {
  // The label is the user-facing name from the preset definition
  // ("1080p", "Best Audio") — passed through so QueueView can show
  // it instead of the long yt-dlp selector that ships to the backend.
  // The kind drives whether the `audioFormat` setting applies (audio
  // selectors only — `--extract-audio` on a video selector would
  // strip the video track).
  onPick: (
    formatSelector: string,
    formatLabel: string,
    kind: PresetKind,
  ) => void;
  disabled?: boolean;
  disabledReason?: string;
}

interface Preset {
  id: PresetId;
  label: string;
  hint: string;
  selector: string;
  icon: React.ComponentType<{ className?: string }>;
  kind: PresetKind;
}

// yt-dlp format selectors. The fallback chain ("a/b/c") keeps the
// preset working when the preferred mp4+m4a pair isn't published —
// e.g. some sources only ship webm. yt-dlp tries each branch
// left-to-right and uses the first that resolves.
export const PRESETS: Preset[] = [
  {
    id: "audio-best",
    label: "Best Audio",
    hint: "m4a, audio only",
    selector: "bestaudio[ext=m4a]/bestaudio",
    icon: Music,
    kind: "audio",
  },
  {
    id: "video-720",
    label: "720p",
    hint: "mp4, video + audio",
    selector:
      "bv*[height<=720][ext=mp4]+ba[ext=m4a]/best[height<=720][ext=mp4]/best[height<=720]",
    icon: Film,
    kind: "video",
  },
  {
    id: "video-1080",
    label: "1080p",
    hint: "mp4, video + audio",
    selector:
      "bv*[height<=1080][ext=mp4]+ba[ext=m4a]/best[height<=1080][ext=mp4]/best[height<=1080]",
    icon: Film,
    kind: "video",
  },
  {
    id: "video-4k",
    label: "4K",
    hint: "mp4, video + audio",
    selector:
      "bv*[height<=2160][ext=mp4]+ba[ext=m4a]/best[height<=2160][ext=mp4]/best[height<=2160]",
    icon: Film,
    kind: "video",
  },
];

/// yt-dlp's default selector when nothing else is requested. Used by
/// the Batch view when the user opts to enqueue without picking a
/// specific preset.
export const DEFAULT_BATCH_SELECTOR = "bestvideo*+bestaudio/best";

export function PresetButtons({ onPick, disabled, disabledReason }: Props) {
  const defaultPreset = useSettingsStore((s) => s.defaultPreset);

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Quick presets
        </h3>
        <span className="text-xs text-muted-foreground">
          or pick a specific format below
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {PRESETS.map((p) => {
          const Icon = p.icon;
          const isDefault = p.id === defaultPreset;
          return (
            <button
              key={p.id}
              disabled={disabled}
              title={
                disabled
                  ? disabledReason
                  : isDefault
                    ? `Default preset · yt-dlp -f "${p.selector}"`
                    : `yt-dlp -f "${p.selector}"`
              }
              onClick={() => onPick(p.selector, p.label, p.kind)}
              className={cn(
                "group relative flex flex-col items-start gap-1 rounded-lg border bg-card p-3 text-left transition-colors",
                disabled
                  ? "cursor-not-allowed border-border opacity-50"
                  : isDefault
                    ? "border-primary/60 bg-primary/5 hover:border-primary"
                    : "border-border hover:border-primary hover:bg-primary/5",
              )}
            >
              {isDefault && (
                <Star
                  className="absolute right-2 top-2 size-3.5 fill-primary text-primary"
                  aria-label="Default preset"
                />
              )}
              <div className="flex items-center gap-2">
                <Icon className="size-4 text-muted-foreground group-hover:text-primary" />
                <span className="text-sm font-medium">{p.label}</span>
              </div>
              <span className="text-xs text-muted-foreground">{p.hint}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
