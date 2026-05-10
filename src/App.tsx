// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Leon Kasdorf

import { useEffect, useState } from "react";
import {
  AlertCircle,
  Download,
  Layers,
  ListVideo,
  Settings as SettingsIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  enqueueJob,
  listJobs,
  probeUrl,
  type Format,
  type ProbeResult,
} from "@/lib/tauri-bridge";
import { classifyFormat, formatDuration } from "@/lib/format-utils";
import { startJobListeners } from "@/lib/tauri-events";
import { useSettingsSync } from "@/lib/settings-sync";
import { useThemeEffect } from "@/lib/theme";
import { AboutDialog } from "@/features/about/AboutDialog";
import { isActive, useJobsStore } from "@/stores/jobs";
import { useSettingsStore } from "@/stores/settings";
import { UrlInput } from "@/features/url-input/UrlInput";
import { ClipboardSuggestion } from "@/features/url-input/ClipboardSuggestion";
import { FormatTable } from "@/features/format-picker/FormatTable";
import { PresetButtons } from "@/features/format-picker/PresetButtons";
import { OutputDirPicker } from "@/features/settings/OutputDirPicker";
import { SettingsView } from "@/features/settings/SettingsView";
import { QueueView } from "@/features/queue/QueueView";
import { BatchView } from "@/features/batch/BatchView";

type Route = "download" | "batch" | "queue" | "settings";

interface NavItem {
  id: Route;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const NAV: NavItem[] = [
  { id: "download", label: "Download", icon: Download },
  { id: "batch",    label: "Batch",    icon: Layers },
  { id: "queue",    label: "Queue",    icon: ListVideo },
  { id: "settings", label: "Settings", icon: SettingsIcon },
];

function App() {
  const [route, setRoute] = useState<Route>("download");
  const [aboutOpen, setAboutOpen] = useState(false);

  useEffect(() => {
    void startJobListeners();
    void listJobs().then((list) => useJobsStore.getState().hydrate(list));
  }, []);

  useSettingsSync();
  useThemeEffect();

  const activeCount = useJobsStore((s) =>
    Object.values(s.jobs).filter((j) => isActive(j.status)).length,
  );

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      <aside className="flex w-56 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
        <div className="flex h-14 items-center justify-between border-b border-sidebar-border px-4">
          <span className="text-lg font-semibold tracking-tight">YTBR</span>
          <button
            type="button"
            onClick={() => setAboutOpen(true)}
            title="About YTBR"
            aria-label="About YTBR"
            className="rounded font-mono text-[10px] text-sidebar-foreground/50 transition-colors hover:text-sidebar-foreground focus:outline-none focus:ring-1 focus:ring-sidebar-ring"
          >
            v{__APP_VERSION__}
          </button>
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-2">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = route === item.id;
            const badge = item.id === "queue" && activeCount > 0 ? activeCount : null;
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
                <span className="flex-1 text-left">{item.label}</span>
                {badge != null && (
                  <span className="rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground tabular-nums">
                    {badge}
                  </span>
                )}
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
          {route === "batch" && <BatchView />}
          {route === "queue" && <QueueView />}
          {route === "settings" && <SettingsView />}
        </div>
      </main>

      {aboutOpen && <AboutDialog onClose={() => setAboutOpen(false)} />}
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
  | { status: "loading"; url: string }
  | { status: "ok"; url: string; result: ProbeResult }
  | { status: "error"; url: string; message: string };

function DownloadView() {
  const [probe, setProbe] = useState<ProbeState>({ status: "idle" });
  const [url, setUrl] = useState("");
  const outputDir = useSettingsStore((s) => s.outputDir);

  async function onProbe(url: string) {
    setProbe({ status: "loading", url });
    try {
      const result = await probeUrl(url);
      setProbe({ status: "ok", url, result });
    } catch (err) {
      setProbe({ status: "error", url, message: String(err) });
    }
  }

  async function enqueue(
    formatId: string,
    formatLabel: string,
    kind: "audio" | "video",
  ) {
    if (!outputDir || probe.status !== "ok") return;
    // Snapshot the settings at enqueue time. Mid-flight setting
    // changes never disturb running jobs.
    const settings = useSettingsStore.getState();
    const audioFormat =
      kind === "audio" && settings.audioFormat !== "default"
        ? settings.audioFormat
        : null;
    const spec = {
      url: probe.url,
      formatId,
      formatLabel,
      outputDir,
      outputTemplate: settings.outputTemplate,
      cookiesFromBrowser: settings.cookiesFromBrowser,
      ffmpegLocation: settings.ffmpegPath,
      writeSubs: settings.writeSubs,
      embedThumbnail: settings.embedThumbnail,
      embedMetadata: settings.embedMetadata,
      downloadArchive: settings.useDownloadArchive,
      concurrentFragments: settings.concurrentFragments,
      audioFormat,
    };
    try {
      const id = await enqueueJob(spec);
      // Optimistic insert so the Queue tab shows the row before the
      // first job-status event lands.
      useJobsStore.getState().upsert({
        id,
        spec,
        status: "queued",
        progress: null,
        error: null,
      });
    } catch (err) {
      console.error("enqueue failed", err);
    }
  }

  function handleFormatRow(format: Format) {
    // YouTube serves anything above 360p as a video-only stream that
    // needs to be muxed with a separate audio stream. yt-dlp won't do
    // this implicitly when given an explicit format id, so we ask for
    // "<id>+bestaudio" and fall back to the best combined format.
    const kind = classifyFormat(format.vcodec, format.acodec);
    const selector =
      kind === "video" ? `${format.formatId}+bestaudio/best` : format.formatId;
    // The audioFormat setting only applies to pure audio rows. video,
    // video+audio, and "none" (rare) all carry video content we don't
    // want to strip via --extract-audio.
    void enqueue(selector, format.formatId, kind === "audio" ? "audio" : "video");
  }

  return (
    <div className="flex flex-col gap-4">
      <ClipboardSuggestion currentUrl={url} onInsert={setUrl} />
      <UrlInput
        value={url}
        onChange={setUrl}
        loading={probe.status === "loading"}
        onProbe={onProbe}
      />
      <OutputDirPicker />

      {probe.status === "idle" && (
        <Placeholder text="Paste a URL above to list available formats." />
      )}

      {probe.status === "error" && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
          <AlertCircle className="size-4 shrink-0 text-destructive" />
          <code className="break-all font-mono text-xs">{probe.message}</code>
        </div>
      )}

      {probe.status === "ok" && (
        <ProbeResultView
          result={probe.result}
          onDownloadFormat={handleFormatRow}
          onDownloadPreset={(selector, label, kind) =>
            void enqueue(selector, label, kind)
          }
          downloadDisabledReason={
            outputDir ? undefined : "Choose an output folder before downloading"
          }
        />
      )}
    </div>
  );
}

function ProbeResultView({
  result,
  onDownloadFormat,
  onDownloadPreset,
  downloadDisabledReason,
}: {
  result: ProbeResult;
  onDownloadFormat: (format: Format) => void;
  onDownloadPreset: (
    selector: string,
    label: string,
    kind: "audio" | "video",
  ) => void;
  downloadDisabledReason?: string;
}) {
  const disabled = downloadDisabledReason != null;
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

      <PresetButtons
        onPick={onDownloadPreset}
        disabled={disabled}
        disabledReason={downloadDisabledReason}
      />

      <FormatTable
        formats={result.formats}
        onDownload={onDownloadFormat}
        downloadDisabledReason={downloadDisabledReason}
      />
    </>
  );
}

export default App;
