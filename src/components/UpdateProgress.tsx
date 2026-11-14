// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Leon Kasdorf

import {
  downloadDetail,
  downloadFraction,
  type DownloadProgress,
} from "@/lib/update-progress";
import { cn } from "@/lib/utils";

// Progress of an app-update download: a bar plus "42.0 MB of 109 MB".
// The installer is over 100 MB, so without this the button just sat on
// "Downloading…" for minutes on a slow line. Shared by the update
// banner and the About dialog.
export function UpdateProgress({
  progress,
  className,
}: {
  progress: DownloadProgress;
  className?: string;
}) {
  const fraction = downloadFraction(progress);
  const percent = fraction == null ? null : Math.floor(fraction * 100);
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div
        role="progressbar"
        aria-label="Update download"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? undefined}
        className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted"
      >
        {fraction == null ? (
          // No Content-Length: same sweeping block the queue uses for
          // downloads of unknown size.
          <div className="ytbr-indeterminate absolute inset-y-0 left-0 w-1/4 rounded-full bg-primary" />
        ) : (
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-150 ease-out"
            style={{ width: `${fraction * 100}%` }}
          />
        )}
      </div>
      <p className="font-mono text-[11px] text-muted-foreground tabular-nums">
        {downloadDetail(progress)}
      </p>
    </div>
  );
}
