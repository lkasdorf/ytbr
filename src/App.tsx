// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Leon Kasdorf

import { useState } from "react";
import {
  Download,
  ListVideo,
  Settings as SettingsIcon,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { cn } from "@/lib/utils";

type Route = "download" | "queue" | "settings";

interface NavItem {
  id: Route;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const NAV: NavItem[] = [
  { id: "download", label: "Download", icon: Download },
  { id: "queue", label: "Queue", icon: ListVideo },
  { id: "settings", label: "Settings", icon: SettingsIcon },
];

function App() {
  const [route, setRoute] = useState<Route>("download");

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      <aside className="flex w-56 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
        <div className="flex h-14 items-center border-b border-sidebar-border px-4">
          <span className="text-lg font-semibold tracking-tight">YTBR</span>
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-2">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = route === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setRoute(item.id)}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground",
                )}
              >
                <Icon className="size-4" />
                {item.label}
              </button>
            );
          })}
        </nav>
      </aside>

      <main className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center border-b border-border px-6">
          <h1 className="text-base font-medium capitalize">{route}</h1>
        </header>
        <div className="flex-1 overflow-auto p-6">
          {route === "download" && <DownloadView />}
          {route === "queue" && <Placeholder text="Job queue with progress and status arrives in iteration 2." />}
          {route === "settings" && <Placeholder text="Default profile, cookies, ffmpeg path arrive in iteration 2." />}
        </div>
      </main>
    </div>
  );
}

function Placeholder({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-6 text-card-foreground">
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  );
}

type ProbeState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; version: string }
  | { status: "error"; message: string };

function DownloadView() {
  const [probe, setProbe] = useState<ProbeState>({ status: "idle" });

  async function check() {
    setProbe({ status: "loading" });
    try {
      const version = await invoke<string>("ytdlp_version");
      setProbe({ status: "ok", version });
    } catch (err) {
      setProbe({ status: "error", message: String(err) });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Placeholder text="URL input and format picker land here in iteration 1." />

      <div className="rounded-lg border border-border bg-card p-6 text-card-foreground">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold">Sidecar smoke test</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Calls the bundled <code className="font-mono">yt-dlp --version</code> via the
              Tauri shell sidecar. Verifies the binary is reachable from the app.
            </p>
          </div>
          <button
            onClick={check}
            disabled={probe.status === "loading"}
            className={cn(
              "shrink-0 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors",
              "hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60",
            )}
          >
            {probe.status === "loading" ? (
              <span className="flex items-center gap-2">
                <Loader2 className="size-4 animate-spin" />
                Checking…
              </span>
            ) : (
              "Check yt-dlp"
            )}
          </button>
        </div>

        {probe.status === "ok" && (
          <div className="mt-4 flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
            <CheckCircle2 className="size-4 text-emerald-500" />
            <span className="text-muted-foreground">yt-dlp</span>
            <code className="font-mono">{probe.version}</code>
          </div>
        )}
        {probe.status === "error" && (
          <div className="mt-4 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
            <AlertCircle className="size-4 shrink-0 text-destructive" />
            <code className="break-all font-mono text-xs">{probe.message}</code>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
