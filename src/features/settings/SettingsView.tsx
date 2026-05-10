// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Leon Kasdorf

import {
  Cookie,
  Film,
  Folder,
  Package,
  Palette,
  RotateCcw,
  Sliders,
  Star,
  Terminal,
} from "lucide-react";
import { OutputDirPicker } from "./OutputDirPicker";
import {
  COOKIE_BROWSERS,
  DEFAULT_OUTPUT_TEMPLATE,
  DEFAULT_PARALLEL_LIMIT,
  MAX_PARALLEL_LIMIT,
  MIN_PARALLEL_LIMIT,
  type PresetId,
  type ThemeMode,
  useSettingsStore,
} from "@/stores/settings";
import { cn } from "@/lib/utils";

interface PresetOption {
  id: PresetId;
  label: string;
  hint: string;
}

const PRESET_OPTIONS: readonly PresetOption[] = [
  { id: "audio-best", label: "Best Audio", hint: "m4a, audio only" },
  { id: "video-720", label: "720p", hint: "mp4, video + audio" },
  { id: "video-1080", label: "1080p", hint: "mp4, video + audio" },
  { id: "video-4k", label: "4K", hint: "mp4, video + audio" },
];

interface ThemeOption {
  id: ThemeMode;
  label: string;
  hint: string;
}

const THEME_OPTIONS: readonly ThemeOption[] = [
  { id: "system", label: "System", hint: "Follow OS preference" },
  { id: "light", label: "Light", hint: "Always light" },
  { id: "dark", label: "Dark", hint: "Always dark" },
];

export function SettingsView() {
  const parallelLimit = useSettingsStore((s) => s.parallelLimit);
  const cookiesFromBrowser = useSettingsStore((s) => s.cookiesFromBrowser);
  const ffmpegPath = useSettingsStore((s) => s.ffmpegPath);
  const outputTemplate = useSettingsStore((s) => s.outputTemplate);
  const defaultPreset = useSettingsStore((s) => s.defaultPreset);
  const writeSubs = useSettingsStore((s) => s.writeSubs);
  const embedThumbnail = useSettingsStore((s) => s.embedThumbnail);
  const embedMetadata = useSettingsStore((s) => s.embedMetadata);
  const useDownloadArchive = useSettingsStore((s) => s.useDownloadArchive);
  const theme = useSettingsStore((s) => s.theme);

  const setParallelLimit = useSettingsStore((s) => s.setParallelLimit);
  const setCookiesFromBrowser = useSettingsStore(
    (s) => s.setCookiesFromBrowser,
  );
  const setFfmpegPath = useSettingsStore((s) => s.setFfmpegPath);
  const setOutputTemplate = useSettingsStore((s) => s.setOutputTemplate);
  const setDefaultPreset = useSettingsStore((s) => s.setDefaultPreset);
  const setWriteSubs = useSettingsStore((s) => s.setWriteSubs);
  const setEmbedThumbnail = useSettingsStore((s) => s.setEmbedThumbnail);
  const setEmbedMetadata = useSettingsStore((s) => s.setEmbedMetadata);
  const setUseDownloadArchive = useSettingsStore(
    (s) => s.setUseDownloadArchive,
  );
  const setTheme = useSettingsStore((s) => s.setTheme);

  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <p className="text-xs text-muted-foreground">
        Saved automatically. Most settings apply to the next download — running
        jobs are unaffected.
      </p>

      <Section
        icon={Folder}
        title="Output folder"
        desc="Where finished downloads land. Used by every job."
      >
        <OutputDirPicker />
      </Section>

      <Section
        icon={Palette}
        title="Theme"
        desc="System follows your OS light/dark preference and updates live when you change it."
      >
        <div className="flex flex-wrap gap-2">
          {THEME_OPTIONS.map((t) => (
            <PresetChip
              key={t.id}
              label={t.label}
              hint={t.hint}
              active={theme === t.id}
              onClick={() => setTheme(t.id)}
            />
          ))}
        </div>
      </Section>

      <Section
        icon={Sliders}
        title="Parallel downloads"
        desc={`How many jobs run at the same time. Default ${DEFAULT_PARALLEL_LIMIT}, max ${MAX_PARALLEL_LIMIT}.`}
        right={
          <span className="font-mono text-sm tabular-nums">
            {parallelLimit}
          </span>
        }
      >
        <input
          type="range"
          min={MIN_PARALLEL_LIMIT}
          max={MAX_PARALLEL_LIMIT}
          step={1}
          value={parallelLimit}
          onChange={(e) => setParallelLimit(Number(e.target.value))}
          className="w-full accent-primary"
          aria-label="Parallel downloads"
        />
      </Section>

      <Section
        icon={Cookie}
        title="Cookies from browser"
        desc="Read cookies from a local browser profile so age-gated or member-only videos can be probed and downloaded. Off by default."
      >
        <div className="flex items-center gap-2">
          <select
            value={cookiesFromBrowser ?? ""}
            onChange={(e) =>
              setCookiesFromBrowser(
                e.target.value === ""
                  ? null
                  : (e.target.value as (typeof COOKIE_BROWSERS)[number]),
              )
            }
            className={cn(
              "flex-1 rounded-md border border-border bg-input px-3 py-1.5 text-sm",
              "text-foreground focus:outline-none focus:ring-1 focus:ring-ring",
            )}
            aria-label="Cookies from browser"
          >
            <option value="">Off — no cookies</option>
            {COOKIE_BROWSERS.map((b) => (
              <option key={b} value={b}>
                {capitalize(b)}
              </option>
            ))}
          </select>
        </div>
      </Section>

      <Section
        icon={Terminal}
        title="FFmpeg path"
        desc="Override the bundled ffmpeg sidecar with a custom binary. Leave empty to use the bundled one (recommended)."
      >
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={ffmpegPath ?? ""}
            placeholder="(using bundled ffmpeg sidecar)"
            onChange={(e) => setFfmpegPath(e.target.value)}
            spellCheck={false}
            className={cn(
              "flex-1 rounded-md border border-border bg-input px-3 py-1.5 font-mono text-xs",
              "text-foreground focus:outline-none focus:ring-1 focus:ring-ring",
            )}
            aria-label="FFmpeg path"
          />
          <ResetButton
            disabled={ffmpegPath == null}
            onClick={() => setFfmpegPath(null)}
            title="Use bundled ffmpeg"
          />
        </div>
      </Section>

      <Section
        icon={Film}
        title="Output template"
        desc={
          <>
            yt-dlp output template. Default{" "}
            <code className="rounded bg-muted px-1 font-mono text-[11px]">
              {DEFAULT_OUTPUT_TEMPLATE}
            </code>
            . See{" "}
            <a
              href="https://github.com/yt-dlp/yt-dlp#output-template"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2 hover:text-foreground"
            >
              yt-dlp output template docs
            </a>
            .
          </>
        }
      >
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={outputTemplate}
            onChange={(e) => setOutputTemplate(e.target.value)}
            spellCheck={false}
            className={cn(
              "flex-1 rounded-md border border-border bg-input px-3 py-1.5 font-mono text-xs",
              "text-foreground focus:outline-none focus:ring-1 focus:ring-ring",
            )}
            aria-label="Output template"
          />
          <ResetButton
            disabled={outputTemplate === DEFAULT_OUTPUT_TEMPLATE}
            onClick={() => setOutputTemplate(DEFAULT_OUTPUT_TEMPLATE)}
            title="Reset to default"
          />
        </div>
      </Section>

      <Section
        icon={Star}
        title="Default preset"
        desc="Highlighted in Quick presets on the Download page. None means no highlight."
      >
        <div className="flex flex-wrap gap-2">
          <PresetChip
            label="None"
            active={defaultPreset == null}
            onClick={() => setDefaultPreset(null)}
          />
          {PRESET_OPTIONS.map((p) => (
            <PresetChip
              key={p.id}
              label={p.label}
              hint={p.hint}
              active={defaultPreset === p.id}
              onClick={() => setDefaultPreset(p.id)}
            />
          ))}
        </div>
      </Section>

      <Section
        icon={Package}
        title="Download options"
        desc="Applied to every download. Subtitles and thumbnails are only attached if the source publishes them."
      >
        <div className="flex flex-col gap-3">
          <ToggleRow
            label="Write subtitles"
            desc="Saves a separate `.vtt` / `.srt` file alongside the video. yt-dlp `--write-subs`."
            checked={writeSubs}
            onChange={setWriteSubs}
          />
          <ToggleRow
            label="Embed thumbnail"
            desc="Bakes the cover art into the file (mp4, m4a, mkv supported). yt-dlp `--embed-thumbnail`."
            checked={embedThumbnail}
            onChange={setEmbedThumbnail}
          />
          <ToggleRow
            label="Embed metadata"
            desc="Bakes title, uploader, upload date, etc. into the file's container tags. yt-dlp `--embed-metadata`."
            checked={embedMetadata}
            onChange={setEmbedMetadata}
          />
          <ToggleRow
            label="Use download archive"
            desc="Skips re-downloading anything yt-dlp already pulled. Archive lives in the app config directory and is shared across all output folders."
            checked={useDownloadArchive}
            onChange={setUseDownloadArchive}
          />
        </div>
      </Section>
    </div>
  );
}

function ToggleRow({
  label,
  desc,
  checked,
  onChange,
}: {
  label: string;
  desc: React.ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-4 cursor-pointer accent-primary"
      />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-card-foreground">{label}</div>
        <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>
      </div>
    </label>
  );
}

interface SectionProps {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
}

function Section({ icon: Icon, title, desc, right, children }: SectionProps) {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <header className="mb-3 flex items-start gap-3">
        <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-medium text-card-foreground">{title}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>
        </div>
        {right}
      </header>
      {children}
    </section>
  );
}

function ResetButton({
  disabled,
  onClick,
  title,
}: {
  disabled?: boolean;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={title}
      aria-label={title}
      className={cn(
        "shrink-0 rounded-md border border-border bg-secondary p-1.5 text-secondary-foreground",
        "transition-colors hover:bg-secondary/80",
        disabled && "cursor-not-allowed opacity-40 hover:bg-secondary",
      )}
    >
      <RotateCcw className="size-3.5" />
    </button>
  );
}

function PresetChip({
  label,
  hint,
  active,
  onClick,
}: {
  label: string;
  hint?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md border px-3 py-1.5 text-xs transition-colors",
        active
          ? "border-primary bg-primary/10 text-foreground"
          : "border-border bg-card text-muted-foreground hover:border-primary/50 hover:text-foreground",
      )}
      title={hint}
    >
      {label}
    </button>
  );
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}
