// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Leon Kasdorf

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, FileText, Layers, ListPlus, Loader2 } from "lucide-react";
import {
  DEFAULT_BATCH_SELECTOR,
  PRESETS,
} from "@/features/format-picker/PresetButtons";
import { enqueueJob, expandPlaylist, type JobSpec } from "@/lib/tauri-bridge";
import { useJobsStore } from "@/stores/jobs";
import { useSettingsStore, type PresetId } from "@/stores/settings";
import { cn } from "@/lib/utils";

type Choice = "default" | PresetId;

interface ChoiceOption {
  id: Choice;
  label: string;
  hint: string;
  selector: string;
}

const CHOICES: readonly ChoiceOption[] = [
  {
    id: "default",
    label: "yt-dlp default",
    hint: "best video + best audio",
    selector: DEFAULT_BATCH_SELECTOR,
  },
  ...PRESETS.map(
    (p): ChoiceOption => ({
      id: p.id,
      label: p.label,
      hint: p.hint,
      selector: p.selector,
    }),
  ),
];

interface BatchResult {
  succeeded: number;
  failed: { url: string; reason: string }[];
}

interface PlaylistState {
  open: boolean;
  url: string;
  busy: boolean;
  error: string | null;
  // Last successful expansion — surfaced inline ("Added 42 from
  // 'Some Playlist'") so the user sees what just happened.
  lastSummary: { title: string | null; count: number } | null;
}

interface BatchViewProps {
  // When the Download tab redirects a playlist/channel URL via App's
  // switchToBatch, the URL lands here. We append it to the textarea
  // on render and signal consumption so a manual revisit of this tab
  // doesn't replay it.
  pendingUrl?: string | null;
  onConsumePending?: () => void;
}

export function BatchView({ pendingUrl, onConsumePending }: BatchViewProps = {}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BatchResult | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [playlist, setPlaylist] = useState<PlaylistState>({
    open: false,
    url: "",
    busy: false,
    error: null,
    lastSummary: null,
  });
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const outputDir = useSettingsStore((s) => s.outputDir);
  const defaultPreset = useSettingsStore((s) => s.defaultPreset);
  const [choice, setChoice] = useState<Choice>(defaultPreset ?? "default");

  const urls = useMemo(() => parseUrls(text), [text]);

  useEffect(() => {
    if (pendingUrl == null || pendingUrl.trim().length === 0) return;
    setText((cur) =>
      cur.trim() ? `${cur.trim()}\n${pendingUrl.trim()}` : pendingUrl.trim(),
    );
    onConsumePending?.();
  }, [pendingUrl, onConsumePending]);

  const selectedChoice =
    CHOICES.find((c) => c.id === choice) ?? CHOICES[0];
  const selectedSelector = selectedChoice.selector;
  const selectedLabel = selectedChoice.label;

  async function importFile(file: File) {
    if (!file.name.toLowerCase().endsWith(".txt")) {
      setResult({
        succeeded: 0,
        failed: [{ url: file.name, reason: "Only .txt files are accepted" }],
      });
      return;
    }
    const content = await file.text();
    setText((current) => (current.trim() ? `${current.trim()}\n${content}` : content));
    setResult(null);
  }

  async function expandAndAppend() {
    const target = playlist.url.trim();
    if (!target) return;
    setPlaylist((p) => ({ ...p, busy: true, error: null }));
    try {
      const { title, entries } = await expandPlaylist(target);
      if (entries.length === 0) {
        setPlaylist((p) => ({
          ...p,
          busy: false,
          error: "yt-dlp returned no entries for that URL",
        }));
        return;
      }
      const appended = entries.join("\n");
      setText((cur) => (cur.trim() ? `${cur.trim()}\n${appended}` : appended));
      setPlaylist({
        open: false,
        url: "",
        busy: false,
        error: null,
        lastSummary: { title, count: entries.length },
      });
      setResult(null);
    } catch (err) {
      setPlaylist((p) => ({ ...p, busy: false, error: String(err) }));
    }
  }

  async function onEnqueueAll() {
    if (!outputDir || urls.length === 0) return;
    setBusy(true);
    setResult(null);

    // Snapshot once. Mid-batch Settings changes shouldn't disturb the
    // jobs that are already being queued.
    const settings = useSettingsStore.getState();
    const baseSpec: Omit<JobSpec, "url"> = {
      formatId: selectedSelector,
      formatLabel: selectedLabel,
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
      writeThumbnail: settings.writeThumbnail,
      writeInfoJson: settings.writeInfoJson,
      downloadArchive: settings.useDownloadArchive,
      restrictFilenames: settings.restrictFilenames,
      rateLimit: settings.rateLimit,
      proxy: settings.proxy,
      concurrentFragments: settings.concurrentFragments,
      retries: settings.retries,
      fragmentRetries: settings.fragmentRetries,
      // The Batch tab only knows the user's preset id; only the
      // "audio-best" choice is audio-only, the rest are video.
      audioFormat:
        choice === "audio-best" && settings.audioFormat !== "default"
          ? settings.audioFormat
          : null,
      sponsorblockMode: settings.sponsorblockMode,
      sponsorblockCategories: settings.sponsorblockCategories,
    };

    let succeeded = 0;
    const failed: { url: string; reason: string }[] = [];

    for (const url of urls) {
      const spec: JobSpec = { ...baseSpec, url };
      try {
        const id = await enqueueJob(spec);
        useJobsStore.getState().upsert({
          id,
          spec,
          status: "queued",
          progress: null,
          error: null,
        });
        succeeded += 1;
      } catch (err) {
        failed.push({ url, reason: String(err) });
      }
    }

    setResult({ succeeded, failed });
    if (failed.length === 0) {
      setText("");
    }
    setBusy(false);
  }

  const canEnqueue = !busy && outputDir && urls.length > 0;
  const disabledReason = !outputDir
    ? "Choose an output folder in Settings before queueing"
    : urls.length === 0
      ? "Paste at least one URL"
      : null;

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <header className="flex items-start gap-3 rounded-lg border border-border bg-card p-4">
        <Layers className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">Batch download</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Paste one URL per line, or drop a `.txt` file. Each URL is queued
            with the selected format and your current Settings (cookies, ffmpeg,
            output template, options).
          </p>
        </div>
      </header>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={async (e) => {
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer.files?.[0];
          if (file) await importFile(file);
        }}
        className={cn(
          "rounded-lg border bg-card transition-colors",
          dragOver ? "border-primary bg-primary/5" : "border-border",
        )}
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          rows={10}
          placeholder={
            "https://www.example.com/watch?v=...\nhttps://www.example.com/watch?v=...\n…"
          }
          className={cn(
            "block w-full resize-y rounded-lg bg-transparent p-3 font-mono text-xs text-foreground",
            "placeholder:text-muted-foreground/50 focus:outline-none",
          )}
          aria-label="URLs, one per line"
        />
        <footer className="flex items-center justify-between gap-3 border-t border-border px-3 py-2 text-xs">
          <span className="text-muted-foreground">
            {urls.length === 0
              ? "0 URLs"
              : urls.length === 1
                ? "1 URL"
                : `${urls.length} URLs`}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() =>
                setPlaylist((p) => ({
                  ...p,
                  open: !p.open,
                  error: null,
                  url: p.open ? p.url : "",
                }))
              }
              className={cn(
                "flex items-center gap-1.5 rounded-md border border-border bg-secondary px-2 py-1 font-medium text-secondary-foreground",
                "transition-colors hover:bg-secondary/80",
                playlist.open && "border-primary bg-primary/10 text-foreground",
              )}
            >
              <ListPlus className="size-3.5" />
              Add playlist or channel…
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                "flex items-center gap-1.5 rounded-md border border-border bg-secondary px-2 py-1 font-medium text-secondary-foreground",
                "transition-colors hover:bg-secondary/80",
              )}
            >
              <FileText className="size-3.5" />
              Import .txt
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,text/plain"
            hidden
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (file) await importFile(file);
              e.target.value = "";
            }}
          />
        </footer>
        {playlist.open && (
          <div className="flex items-center gap-2 border-t border-border bg-muted/40 px-3 py-2">
            <input
              type="url"
              value={playlist.url}
              onChange={(e) =>
                setPlaylist((p) => ({ ...p, url: e.target.value, error: null }))
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") void expandAndAppend();
                if (e.key === "Escape")
                  setPlaylist((p) => ({ ...p, open: false, error: null, url: "" }));
              }}
              autoFocus
              placeholder="Paste a playlist or channel URL (e.g. .../@channel/videos)"
              className={cn(
                "flex-1 rounded-md border border-border bg-background px-2 py-1 font-mono text-xs",
                "placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none",
              )}
              aria-label="Playlist URL"
            />
            <button
              type="button"
              disabled={playlist.busy || !playlist.url.trim()}
              onClick={() => void expandAndAppend()}
              className={cn(
                "flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground",
                "transition-colors hover:bg-primary/90",
                (playlist.busy || !playlist.url.trim()) &&
                  "cursor-not-allowed opacity-50",
              )}
            >
              {playlist.busy && <Loader2 className="size-3 animate-spin" />}
              {playlist.busy ? "Expanding…" : "Expand"}
            </button>
            <button
              type="button"
              onClick={() =>
                setPlaylist((p) => ({ ...p, open: false, error: null, url: "" }))
              }
              className="rounded-md border border-border bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground hover:bg-secondary/80"
            >
              Cancel
            </button>
          </div>
        )}
        {playlist.error && (
          <div className="border-t border-destructive/40 bg-destructive/10 px-3 py-2 font-mono text-[11px] text-destructive">
            {playlist.error}
          </div>
        )}
        {playlist.lastSummary && !playlist.open && !playlist.error && (
          <div className="border-t border-border bg-primary/5 px-3 py-2 text-[11px] text-muted-foreground">
            <span className="text-foreground">
              Added {playlist.lastSummary.count}{" "}
              {playlist.lastSummary.count === 1 ? "URL" : "URLs"}
            </span>
            {playlist.lastSummary.title && (
              <>
                {" "}from <span className="font-medium text-foreground">
                  {playlist.lastSummary.title}
                </span>
              </>
            )}
            .
          </div>
        )}
      </div>

      <fieldset className="rounded-lg border border-border bg-card p-3">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Format for every URL
        </legend>
        <div className="flex flex-wrap gap-2 pt-2">
          {CHOICES.map((c) => {
            const active = c.id === choice;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setChoice(c.id)}
                title={c.selector}
                className={cn(
                  "rounded-md border px-3 py-1.5 text-left text-xs transition-colors",
                  active
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border bg-card text-muted-foreground hover:border-primary/50 hover:text-foreground",
                )}
              >
                <div className="font-medium">{c.label}</div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  {c.hint}
                </div>
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="flex items-center justify-between gap-3">
        {disabledReason ? (
          <span className="text-xs text-muted-foreground">{disabledReason}</span>
        ) : (
          <span className="text-xs text-muted-foreground">
            Ready to queue {urls.length} {urls.length === 1 ? "job" : "jobs"}.
          </span>
        )}
        <button
          type="button"
          disabled={!canEnqueue}
          onClick={onEnqueueAll}
          className={cn(
            "rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors",
            "hover:bg-primary/90",
            !canEnqueue && "cursor-not-allowed opacity-50",
          )}
        >
          {busy ? "Queueing…" : "Enqueue all"}
        </button>
      </div>

      {result && (
        <div
          className={cn(
            "flex items-start gap-2 rounded-lg border p-3 text-sm",
            result.failed.length === 0
              ? "border-primary/40 bg-primary/5"
              : "border-destructive/40 bg-destructive/10",
          )}
        >
          {result.failed.length === 0 ? (
            <CheckCircle2 className="size-4 shrink-0 text-primary" />
          ) : (
            <AlertCircle className="size-4 shrink-0 text-destructive" />
          )}
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium">
              Queued {result.succeeded} of{" "}
              {result.succeeded + result.failed.length}
              {result.failed.length > 0 && ` (${result.failed.length} failed)`}
            </div>
            {result.failed.length > 0 && (
              <ul className="mt-2 space-y-1 font-mono text-[11px]">
                {result.failed.map((f) => (
                  <li key={f.url} className="break-all">
                    <span className="text-muted-foreground">{f.url}</span>{" "}
                    <span className="text-destructive">— {f.reason}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function parseUrls(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}
