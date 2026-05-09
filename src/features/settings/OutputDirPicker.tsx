// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Leon Kasdorf

import { Folder, FolderOpen } from "lucide-react";
import { pickOutputDir } from "@/lib/tauri-bridge";
import { useSettingsStore } from "@/stores/settings";
import { cn } from "@/lib/utils";

export function OutputDirPicker() {
  const outputDir = useSettingsStore((s) => s.outputDir);
  const setOutputDir = useSettingsStore((s) => s.setOutputDir);

  async function choose() {
    const picked = await pickOutputDir();
    if (picked) setOutputDir(picked);
  }

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-3 text-sm">
      <Folder className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          Output folder
        </div>
        {outputDir ? (
          <div className="truncate font-mono text-xs" title={outputDir}>
            {outputDir}
          </div>
        ) : (
          <div className="text-xs italic text-muted-foreground">
            Not set — choose a folder before downloading.
          </div>
        )}
      </div>
      <button
        onClick={choose}
        className={cn(
          "shrink-0 rounded-md border border-border bg-secondary px-3 py-1.5 text-xs font-medium",
          "text-secondary-foreground transition-colors hover:bg-secondary/80",
        )}
      >
        <span className="flex items-center gap-1.5">
          <FolderOpen className="size-3.5" />
          {outputDir ? "Change" : "Choose…"}
        </span>
      </button>
    </div>
  );
}
