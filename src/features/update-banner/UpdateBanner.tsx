// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Leon Kasdorf

import { useEffect, useState } from "react";
import { Download, ExternalLink, X } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { checkAppUpdate, type AppUpdateCheck } from "@/lib/tauri-bridge";
import { cn } from "@/lib/utils";

// sessionStorage key — dismissing the banner sticks for the current
// session only, so the next launch re-prompts if the user is still
// behind. Avoids the "dismissed once, forgot forever" anti-pattern of
// localStorage while still giving the user a quick out.
const DISMISS_KEY = "ytbr.update-banner.dismissed";

// Wait before firing the check so a cold start isn't competing with
// dependency-version probes (yt-dlp / ffmpeg) for the user's first
// glance at the queue.
const CHECK_DELAY_MS = 3000;

type State =
  | { kind: "idle" }
  | { kind: "signed"; update: Update }
  | { kind: "unsigned"; info: AppUpdateCheck };

export function UpdateBanner() {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [dismissed, setDismissed] = useState(() =>
    typeof window !== "undefined" &&
    window.sessionStorage.getItem(DISMISS_KEY) === "1"
  );
  const [installing, setInstalling] = useState<string | null>(null);
  const [installed, setInstalled] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);

  useEffect(() => {
    if (dismissed) return;
    let cancelled = false;
    const t = setTimeout(() => {
      void runCheck().then((next) => {
        if (!cancelled && next != null) setState(next);
      });
    }, CHECK_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [dismissed]);

  if (dismissed || state.kind === "idle") return null;

  function dismiss() {
    setDismissed(true);
    try {
      window.sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // sessionStorage can be unavailable in some sandboxed contexts.
      // The in-memory dismissed flag still hides the banner for the
      // rest of this session, just without persistence.
    }
  }

  async function install() {
    if (state.kind !== "signed") return;
    setInstalling("Downloading…");
    setInstallError(null);
    try {
      await state.update.downloadAndInstall((event) => {
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
      setTimeout(() => void relaunch(), 600);
    } catch (e: unknown) {
      setInstallError(String(e));
      setInstalling(null);
    }
  }

  const version =
    state.kind === "signed" ? state.update.version : state.info.latest;

  return (
    <div
      role="status"
      className={cn(
        "flex items-start gap-3 border-b border-primary/30 bg-primary/5 px-6 py-2.5 text-xs",
      )}
    >
      <Download className="mt-0.5 size-4 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-foreground">
          YTBR v{version} is available
        </p>
        {installError && (
          <p className="mt-1 font-mono text-[11px] text-destructive">
            {installError}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {state.kind === "signed" ? (
          <button
            type="button"
            onClick={() => void install()}
            disabled={installing != null || installed}
            className={cn(
              "rounded-md bg-primary px-2.5 py-1 font-medium text-primary-foreground",
              "transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60",
            )}
          >
            {installed
              ? "Installed — restarting"
              : (installing ?? "Download & install")}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void openUrl(state.info.releaseUrl)}
            className={cn(
              "flex items-center gap-1 rounded-md border border-primary/40 bg-card px-2.5 py-1 font-medium",
              "transition-colors hover:border-primary hover:bg-primary/10",
            )}
          >
            View release
            <ExternalLink className="size-3" />
          </button>
        )}
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

// Two paths, matching the About dialog: signed-updater first, then
// the GitHub-API fallback. Returns null if up to date or both paths
// failed — caller treats that as "nothing to show".
async function runCheck(): Promise<State | null> {
  try {
    const update = await check();
    if (update != null) return { kind: "signed", update };
    return null;
  } catch {
    try {
      const info = await checkAppUpdate();
      if (info.isNewer) return { kind: "unsigned", info };
      return null;
    } catch {
      return null;
    }
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
