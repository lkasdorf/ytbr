// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Leon Kasdorf

import { useEffect, useState } from "react";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import { ClipboardPaste, X } from "lucide-react";
import { useSettingsStore } from "@/stores/settings";
import { cn } from "@/lib/utils";

const URL_RE = /^https?:\/\/\S+$/i;

interface Props {
  currentUrl: string;
  onInsert: (url: string) => void;
}

export function ClipboardSuggestion({ currentUrl, onInsert }: Props) {
  const watchClipboard = useSettingsStore((s) => s.watchClipboard);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);

  useEffect(() => {
    if (!watchClipboard) {
      setSuggestion(null);
      return;
    }

    let cancelled = false;
    async function check(): Promise<void> {
      try {
        const text = (await readText()) ?? "";
        const trimmed = text.trim();
        if (cancelled) return;
        if (!URL_RE.test(trimmed)) {
          setSuggestion(null);
          return;
        }
        setSuggestion(trimmed);
      } catch {
        // readText throws on macOS when there's no text content;
        // silently swallow — clipboard suggestion is best-effort.
      }
    }

    void check();
    const onFocus = () => void check();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
    };
  }, [watchClipboard]);

  if (
    !watchClipboard ||
    suggestion == null ||
    suggestion === currentUrl ||
    suggestion === dismissed
  ) {
    return null;
  }

  return (
    <div className="flex items-center gap-3 rounded-lg border border-primary/40 bg-primary/5 p-3">
      <ClipboardPaste className="size-4 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-foreground">
          URL in clipboard
        </p>
        <p className="truncate font-mono text-xs text-muted-foreground" title={suggestion}>
          {suggestion}
        </p>
      </div>
      <button
        type="button"
        onClick={() => {
          onInsert(suggestion);
          setDismissed(suggestion);
        }}
        className={cn(
          "shrink-0 rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground transition-colors",
          "hover:bg-primary/90",
        )}
      >
        Insert
      </button>
      <button
        type="button"
        onClick={() => setDismissed(suggestion)}
        aria-label="Dismiss"
        title="Dismiss"
        className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
