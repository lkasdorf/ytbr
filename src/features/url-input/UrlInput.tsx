// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Leon Kasdorf

import { useState, type FormEvent } from "react";
import { Loader2, Search } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  loading: boolean;
  onProbe: (url: string) => void;
}

export function UrlInput({ loading, onProbe }: Props) {
  const [url, setUrl] = useState("");

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed || loading) return;
    onProbe(trimmed);
  }

  return (
    <form
      onSubmit={submit}
      className="flex items-center gap-2 rounded-lg border border-border bg-card p-2"
    >
      <Search className="ml-2 size-4 shrink-0 text-muted-foreground" />
      <input
        type="url"
        autoFocus
        value={url}
        onChange={(e) => setUrl(e.currentTarget.value)}
        placeholder="Paste a video URL…"
        spellCheck={false}
        autoComplete="off"
        className={cn(
          "min-w-0 flex-1 bg-transparent px-1 py-1.5 text-sm text-foreground outline-none",
          "placeholder:text-muted-foreground",
        )}
      />
      <button
        type="submit"
        disabled={loading || url.trim().length === 0}
        className={cn(
          "shrink-0 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors",
          "hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60",
        )}
      >
        {loading ? (
          <span className="flex items-center gap-2">
            <Loader2 className="size-4 animate-spin" />
            Probing…
          </span>
        ) : (
          "Probe"
        )}
      </button>
    </form>
  );
}
