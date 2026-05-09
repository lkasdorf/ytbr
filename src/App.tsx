// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Leon Kasdorf

import { useState } from "react";
import {
  AlertCircle,
  Download,
  ListVideo,
  Settings as SettingsIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { probeUrl, type ProbeResult } from "@/lib/tauri-bridge";
import { formatDuration } from "@/lib/format-utils";
import { UrlInput } from "@/features/url-input/UrlInput";
import { FormatTable } from "@/features/format-picker/FormatTable";

type Route = "download" | "queue" | "settings";

interface NavItem {
  id: Route;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const NAV: NavItem[] = [
  { id: "download", label: "Download", icon: Download },
  { id: "queue",    label: "Queue",    icon: ListVideo },
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
          {route === "queue" && (
            <Placeholder text="Job queue with progress and status arrives in iteration 2." />
          )}
          {route === "settings" && (
            <Placeholder text="Default profile, cookies, ffmpeg path arrive in iteration 2." />
          )}
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
  | { status: "ok"; result: ProbeResult }
  | { status: "error"; message: string };

function DownloadView() {
  const [probe, setProbe] = useState<ProbeState>({ status: "idle" });

  async function run(url: string) {
    setProbe({ status: "loading" });
    try {
      const result = await probeUrl(url);
      setProbe({ status: "ok", result });
    } catch (err) {
      setProbe({ status: "error", message: String(err) });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <UrlInput loading={probe.status === "loading"} onProbe={run} />

      {probe.status === "idle" && (
        <Placeholder text="Paste a URL above to list available formats." />
      )}

      {probe.status === "error" && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
          <AlertCircle className="size-4 shrink-0 text-destructive" />
          <code className="break-all font-mono text-xs">{probe.message}</code>
        </div>
      )}

      {probe.status === "ok" && <ProbeResultView result={probe.result} />}
    </div>
  );
}

function ProbeResultView({ result }: { result: ProbeResult }) {
  return (
    <>
      <div className="flex gap-4 rounded-lg border border-border bg-card p-4">
        {result.thumbnail && (
          <img
            src={result.thumbnail}
            alt=""
            className="h-20 w-32 shrink-0 rounded-md object-cover"
          />
        )}
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold">{result.title}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {result.uploader && <span>{result.uploader} · </span>}
            <span>{formatDuration(result.durationSecs)}</span>
            <span> · {result.formats.length} formats</span>
          </p>
        </div>
      </div>

      <FormatTable formats={result.formats} />
    </>
  );
}

export default App;
