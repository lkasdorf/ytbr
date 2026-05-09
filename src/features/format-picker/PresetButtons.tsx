// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Leon Kasdorf

import { Film, Music } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  onPick: (formatSelector: string) => void;
  disabled?: boolean;
  disabledReason?: string;
}

interface Preset {
  label: string;
  hint: string;
  selector: string;
  icon: React.ComponentType<{ className?: string }>;
}

// yt-dlp format selectors. The fallback chain ("a/b/c") keeps the
// preset working when the preferred mp4+m4a pair isn't published —
// e.g. some sources only ship webm. yt-dlp tries each branch
// left-to-right and uses the first that resolves.
const PRESETS: Preset[] = [
  {
    label: "Best Audio",
    hint: "m4a, audio only",
    selector: "bestaudio[ext=m4a]/bestaudio",
    icon: Music,
  },
  {
    label: "720p",
    hint: "mp4, video + audio",
    selector:
      "bv*[height<=720][ext=mp4]+ba[ext=m4a]/best[height<=720][ext=mp4]/best[height<=720]",
    icon: Film,
  },
  {
    label: "1080p",
    hint: "mp4, video + audio",
    selector:
      "bv*[height<=1080][ext=mp4]+ba[ext=m4a]/best[height<=1080][ext=mp4]/best[height<=1080]",
    icon: Film,
  },
  {
    label: "4K",
    hint: "mp4, video + audio",
    selector:
      "bv*[height<=2160][ext=mp4]+ba[ext=m4a]/best[height<=2160][ext=mp4]/best[height<=2160]",
    icon: Film,
  },
];

export function PresetButtons({ onPick, disabled, disabledReason }: Props) {
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
          return (
            <button
              key={p.label}
              disabled={disabled}
              title={disabled ? disabledReason : `yt-dlp -f "${p.selector}"`}
              onClick={() => onPick(p.selector)}
              className={cn(
                "group flex flex-col items-start gap-1 rounded-lg border border-border bg-card p-3 text-left transition-colors",
                disabled
                  ? "cursor-not-allowed opacity-50"
                  : "hover:border-primary hover:bg-primary/5",
              )}
            >
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
