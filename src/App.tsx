// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Leon Kasdorf

import { useEffect, useState } from "react";
import {
  AlertCircle,
  Download,
  Layers,
  ListVideo,
  Search,
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
import { PlaylistRedirect } from "@/features/url-input/PlaylistRedirect";
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
  // Ephemeral handoff: DownloadView calls onSwitchToBatch(url) when the
  // user clicks "Open in Batch" on a playlist/channel URL banner. The
  // url lands in BatchView's textarea on its next render and we clear
  // the slot so a manual revisit of the Batch tab doesn't replay it.
  const [pendingBatchUrl, setPendingBatchUrl] = useState<string | null>(null);

  function switchToBatch(url: string) {
    setPendingBatchUrl(url);
    setRoute("batch");
  }

  useEffect(() => {
    void startJobListeners();
    void listJobs().then((list) => useJobsStore.getState().hydrate(list));
  }, []);

  useSettingsSync();
  useThemeEffect();

  const activeCount = useJobsStore((s) =>
    Object.values(s.jobs).filter((j) => isActive(j.status)).length,
  );
  const queuedCount = useJobsStore((s) =>
    Object.values(s.jobs).filter((j) => j.status === "queued").length,
  );
  const doneCount = useJobsStore((s) =>
    Object.values(s.jobs).filter(
      (j) =>
        j.status === "completed" ||
        j.status === "failed" ||
        j.status === "cancelled",
    ).length,
  );
  const headerOutputDir = useSettingsStore((s) => s.outputDir);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      <aside className="flex w-56 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
        <div className="flex h-14 items-center justify-between border-b border-sidebar-border px-4">
          <span className="font-mono text-base font-bold uppercase tracking-[0.25em] text-foreground">
            ytbr
          </span>
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
                  "relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground",
                )}
              >
                {active && (
                  <span
                    aria-hidden
                    className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full bg-primary"
                  />
                )}
                <Icon className={cn("size-4", active && "text-primary")} />
                <span className="flex-1 text-left">{item.label}</span>
                {badge != null && (
                  <span className="rounded-full bg-primary px-1.5 font-mono text-[10px] font-semibold text-primary-foreground tabular-nums">
                    {badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </aside>

      <main className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border px-6">
          <h1 className="text-base font-medium capitalize">{route}</h1>
          <RouteHeaderInfo
            route={route}
            activeCount={activeCount}
            queuedCount={queuedCount}
            doneCount={doneCount}
            outputDir={headerOutputDir}
          />
        </header>
        <div className="flex-1 overflow-auto p-6">
          {route === "download" && <DownloadView onSwitchToBatch={switchToBatch} />}
          {route === "batch" && (
            <BatchView
              pendingUrl={pendingBatchUrl}
              onConsumePending={() => setPendingBatchUrl(null)}
            />
          )}
          {route === "queue" && <QueueView />}
          {route === "settings" && <SettingsView />}
        </div>
      </main>

      {aboutOpen && <AboutDialog onClose={() => setAboutOpen(false)} />}
    </div>
  );
}

function Placeholder({
  icon: Icon,
  title,
  text,
}: {
  icon?: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  title?: string;
  text: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-card/40 px-6 py-12 text-card-foreground">
      {Icon && (
        <Icon className="size-10 text-muted-foreground/40" strokeWidth={1.5} />
      )}
      {title && <p className="text-sm font-medium text-foreground">{title}</p>}
      <p className="max-w-xs text-center text-xs text-muted-foreground">{text}</p>
    </div>
  );
}

function RouteHeaderInfo({
  route,
  activeCount,
  queuedCount,
  doneCount,
  outputDir,
}: {
  route: Route;
  activeCount: number;
  queuedCount: number;
  doneCount: number;
  outputDir: string | null;
}) {
  if (route === "queue") {
    const parts: string[] = [];
    if (activeCount > 0) parts.push(`${activeCount} active`);
    if (queuedCount > 0) parts.push(`${queuedCount} queued`);
    if (doneCount > 0) parts.push(`${doneCount} done`);
    if (parts.length === 0) return null;
    return (
      <span className="font-mono text-xs text-muted-foreground tabular-nums">
        {parts.join(" · ")}
      </span>
    );
  }
  if (route === "download" && outputDir) {
    return (
      <span
        className="max-w-md truncate font-mono text-xs text-muted-foreground"
        title={outputDir}
      >
        → {outputDir}
      </span>
    );
  }
  return null;
}

type ProbeState =
  | { status: "idle" }
  | { status: "loading"; url: string }
  | { status: "ok"; url: string; result: ProbeResult }
  | { status: "error"; url: string; message: string };

function DownloadView({
  onSwitchToBatch,
}: {
  onSwitchToBatch: (url: string) => void;
}) {
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
      subLangs: settings.subLangs,
      writeAutoSubs: settings.writeAutoSubs,
      embedSubs: settings.embedSubs,
      embedThumbnail: settings.embedThumbnail,
      embedMetadata: settings.embedMetadata,
      downloadArchive: settings.useDownloadArchive,
      restrictFilenames: settings.restrictFilenames,
      rateLimit: settings.rateLimit,
      proxy: settings.proxy,
      concurrentFragments: settings.concurrentFragments,
      audioFormat,
      sponsorblockMode: settings.sponsorblockMode,
      sponsorblockCategories: settings.sponsorblockCategories,
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
      <PlaylistRedirect url={url} onSwitchToBatch={onSwitchToBatch} />
      <ClipboardSuggestion currentUrl={url} onInsert={setUrl} />
      <UrlInput
        value={url}
        onChange={setUrl}
        loading={probe.status === "loading"}
        onProbe={onProbe}
      />
      <OutputDirPicker />

      {probe.status === "idle" && (
        <Placeholder
          icon={Search}
          title="Ready when you are"
          text="Paste a URL above and press Probe to list available formats."
        />
      )}

      {probe.status === "error" && (
        <div
          role="alert"
          aria-live="polite"
          className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm"
        >
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
