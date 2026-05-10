// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Leon Kasdorf

import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink, X } from "lucide-react";
import { ffmpegVersion, ytdlpVersion } from "@/lib/tauri-bridge";
import { cn } from "@/lib/utils";

const REPO_URL = "https://github.com/lkasdorf/ytbr";
const LICENSES_URL =
  "https://github.com/lkasdorf/ytbr/blob/main/THIRD_PARTY_LICENSES.md";

interface VersionState {
  value: string | null;
  error: string | null;
}

const LOADING: VersionState = { value: null, error: null };

export function AboutDialog({ onClose }: { onClose: () => void }) {
  const [ytdlp, setYtdlp] = useState<VersionState>(LOADING);
  const [ffmpeg, setFfmpeg] = useState<VersionState>(LOADING);

  useEffect(() => {
    let cancelled = false;
    void ytdlpVersion().then(
      (v) => !cancelled && setYtdlp({ value: v, error: null }),
      (e: unknown) =>
        !cancelled && setYtdlp({ value: null, error: String(e) }),
    );
    void ffmpegVersion().then(
      (v) => !cancelled && setFfmpeg({ value: v, error: null }),
      (e: unknown) =>
        !cancelled && setFfmpeg({ value: null, error: String(e) }),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-title"
        className="w-full max-w-md rounded-lg border border-border bg-card text-card-foreground shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h2 id="about-title" className="text-base font-semibold">
              About YTBR
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              A Tauri desktop frontend for{" "}
              <code className="font-mono">yt-dlp</code>.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className={cn(
              "shrink-0 rounded-md border border-border bg-secondary p-1 text-secondary-foreground",
              "transition-colors hover:bg-secondary/80",
            )}
          >
            <X className="size-3.5" />
          </button>
        </header>

        <div className="px-5 py-4">
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
            <Row label="App">
              <code className="font-mono">v{__APP_VERSION__}</code>
            </Row>
            <Row label="yt-dlp">
              <VersionValue state={ytdlp} />
            </Row>
            <Row label="ffmpeg">
              <VersionValue state={ffmpeg} />
            </Row>
          </dl>

          <div className="mt-5 flex flex-col gap-2 border-t border-border pt-4">
            <LinkRow
              href={REPO_URL}
              label="GitHub repository"
              hint="lkasdorf/ytbr"
            />
            <LinkRow
              href={LICENSES_URL}
              label="Third-party licenses"
              hint="THIRD_PARTY_LICENSES.md"
            />
          </div>

          <p className="mt-5 text-[11px] text-muted-foreground">
            Apache-2.0 © 2026 Leon Kasdorf. Bundled ffmpeg is LGPL-2.1.
          </p>
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="min-w-0 break-words font-mono text-xs">{children}</dd>
    </>
  );
}

function VersionValue({ state }: { state: VersionState }) {
  if (state.error != null) {
    return (
      <span className="text-destructive" title={state.error}>
        unavailable
      </span>
    );
  }
  if (state.value == null) {
    return <span className="text-muted-foreground">…</span>;
  }
  return <span title={state.value}>{state.value}</span>;
}

function LinkRow({
  href,
  label,
  hint,
}: {
  href: string;
  label: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={() => void openUrl(href)}
      className={cn(
        "group flex items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2 text-left",
        "transition-colors hover:border-primary/50 hover:bg-secondary/40",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{label}</div>
        <div className="truncate text-xs text-muted-foreground">{hint}</div>
      </div>
      <ExternalLink className="size-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
    </button>
  );
}
