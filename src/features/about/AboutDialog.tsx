// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Leon Kasdorf

import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { Download, ExternalLink, Loader2, X } from "lucide-react";
import {
  checkAppUpdate,
  ffmpegVersion,
  ytdlpVersion,
  type AppUpdateCheck,
} from "@/lib/tauri-bridge";
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

          <UpdateCheckRow />

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

// Two paths land in this row depending on what's deployed:
//
//   1. Signed: tauri-plugin-updater's check() reaches latest.json,
//      verifies the signature against the build-time pubkey, and
//      returns an Update handle. Clicking "Download & install" runs
//      downloadAndInstall() then relaunches via plugin-process.
//
//   2. Unsigned fallback: check() throws because the pubkey is the
//      placeholder, the signing keypair isn't set up yet, or
//      latest.json is missing. We swallow the error and fall back to
//      the GitHub-API ping (`checkAppUpdate`) which only links to the
//      release page — no install.
//
// First successful path wins. No way for the user to force one over
// the other; the build configuration decides.
function UpdateCheckRow() {
  const [busy, setBusy] = useState(false);
  const [signed, setSigned] = useState<Update | null>(null);
  const [fallback, setFallback] = useState<AppUpdateCheck | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [installed, setInstalled] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    setSigned(null);
    setFallback(null);
    setInstalled(false);
    try {
      const update = await check();
      if (update != null) {
        setSigned(update);
      } else {
        // Up to date according to the signed updater. Mirror the
        // shape of the GitHub-API path so the "Up to date" line
        // renders the same way.
        setFallback(await checkAppUpdate());
      }
    } catch {
      // Signed path failed (placeholder pubkey, no latest.json,
      // network error); fall back to the GitHub-API path so the user
      // still gets *some* answer.
      try {
        setFallback(await checkAppUpdate());
      } catch (e2: unknown) {
        setError(String(e2));
      }
    } finally {
      setBusy(false);
    }
  }

  async function install() {
    if (signed == null) return;
    setInstalling("Downloading…");
    setError(null);
    try {
      await signed.downloadAndInstall((event) => {
        if (event.event === "Started") {
          setInstalling(
            event.data.contentLength != null
              ? `Downloading (${formatBytes(event.data.contentLength)})…`
              : "Downloading…",
          );
        } else if (event.event === "Finished") {
          setInstalling("Installing…");
        }
      });
      setInstalled(true);
      setInstalling(null);
      // Relaunch happens after a tiny pause so the user sees the
      // "Installed — restarting" line for a beat.
      setTimeout(() => void relaunch(), 600);
    } catch (e: unknown) {
      setError(String(e));
      setInstalling(null);
    }
  }

  return (
    <div className="mt-5 flex flex-col gap-2 border-t border-border pt-4">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void run()}
          disabled={busy || installing != null}
          className={cn(
            "flex items-center gap-2 rounded-md border border-border bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground",
            "transition-colors hover:bg-secondary/80 disabled:cursor-not-allowed disabled:opacity-60",
          )}
        >
          {busy && <Loader2 className="size-3.5 animate-spin" />}
          {busy ? "Checking…" : "Check for app updates"}
        </button>
        {fallback != null && !fallback.isNewer && (
          <span className="text-xs text-muted-foreground">
            Up to date (v{fallback.current}).
          </span>
        )}
      </div>

      {signed != null && (
        <div className="flex flex-col gap-2 rounded-md border border-primary/40 bg-primary/5 px-3 py-2">
          <div className="text-xs font-medium text-foreground">
            v{signed.version} available
          </div>
          <div className="text-[11px] text-muted-foreground">
            Signed update verified. Download &amp; install will replace the
            running app and restart it.
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void install()}
              disabled={installing != null || installed}
              className={cn(
                "flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground",
                "transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60",
              )}
            >
              {installing != null && <Loader2 className="size-3 animate-spin" />}
              <Download className="size-3" />
              {installed
                ? "Installed — restarting"
                : (installing ?? "Download & install")}
            </button>
          </div>
        </div>
      )}

      {fallback != null && fallback.isNewer && signed == null && (
        <button
          type="button"
          onClick={() => void openUrl(fallback.releaseUrl)}
          className={cn(
            "flex items-center justify-between gap-3 rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-left",
            "transition-colors hover:border-primary hover:bg-primary/10",
          )}
        >
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium text-foreground">
              v{fallback.latest} available
            </div>
            <div className="text-[11px] text-muted-foreground">
              You're on v{fallback.current}. Click to view the release.
            </div>
          </div>
          <ExternalLink className="size-3.5 shrink-0 text-primary" />
        </button>
      )}

      {error != null && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 font-mono text-[11px] text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
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
