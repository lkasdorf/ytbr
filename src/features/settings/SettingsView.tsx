// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Leon Kasdorf

import { useEffect, useState } from "react";
import {
  Bell,
  Cookie,
  Download,
  Film,
  Folder,
  Loader2,
  Music,
  Package,
  Palette,
  RotateCcw,
  SkipForward,
  Sliders,
  Star,
  Terminal,
} from "lucide-react";
import { OutputDirPicker } from "./OutputDirPicker";
import {
  updateYtdlp,
  ytdlpVersion,
  type UpdateOutcome,
} from "@/lib/tauri-bridge";
import {
  AUDIO_FORMATS,
  COOKIE_BROWSERS,
  DEFAULT_CONCURRENT_FRAGMENTS,
  DEFAULT_OUTPUT_TEMPLATE,
  DEFAULT_PARALLEL_LIMIT,
  MAX_CONCURRENT_FRAGMENTS,
  MAX_PARALLEL_LIMIT,
  MIN_CONCURRENT_FRAGMENTS,
  MIN_PARALLEL_LIMIT,
  SPONSORBLOCK_CATEGORIES,
  type AudioFormat,
  type PresetId,
  type SponsorblockCategory,
  type SponsorblockMode,
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

interface SponsorblockModeOption {
  id: SponsorblockMode;
  label: string;
  hint: string;
}

const SPONSORBLOCK_MODE_OPTIONS: readonly SponsorblockModeOption[] = [
  { id: "off", label: "Off", hint: "Don't touch SponsorBlock segments" },
  {
    id: "mark",
    label: "Mark as chapters",
    hint: "Add chapter markers, keep the full video",
  },
  {
    id: "remove",
    label: "Remove",
    hint: "Cut the segments out (needs ffmpeg, bundled)",
  },
];

// User-facing labels for the SponsorBlock category ids. Order mirrors
// SPONSORBLOCK_CATEGORIES so the UI stays predictable.
const SPONSORBLOCK_CATEGORY_LABELS: Record<SponsorblockCategory, string> = {
  sponsor: "Sponsor",
  intro: "Intro / hook",
  outro: "Outro / endcards",
  selfpromo: "Self-promotion",
  interaction: "Interaction reminder",
  music_offtopic: "Non-music in music videos",
};

export function SettingsView() {
  const parallelLimit = useSettingsStore((s) => s.parallelLimit);
  const cookiesFromBrowser = useSettingsStore((s) => s.cookiesFromBrowser);
  const ffmpegPath = useSettingsStore((s) => s.ffmpegPath);
  const outputTemplate = useSettingsStore((s) => s.outputTemplate);
  const defaultPreset = useSettingsStore((s) => s.defaultPreset);
  const writeSubs = useSettingsStore((s) => s.writeSubs);
  const subLangs = useSettingsStore((s) => s.subLangs);
  const writeAutoSubs = useSettingsStore((s) => s.writeAutoSubs);
  const embedSubs = useSettingsStore((s) => s.embedSubs);
  const embedThumbnail = useSettingsStore((s) => s.embedThumbnail);
  const embedMetadata = useSettingsStore((s) => s.embedMetadata);
  const useDownloadArchive = useSettingsStore((s) => s.useDownloadArchive);
  const restrictFilenames = useSettingsStore((s) => s.restrictFilenames);
  const theme = useSettingsStore((s) => s.theme);
  const notifyOnFinish = useSettingsStore((s) => s.notifyOnFinish);
  const watchClipboard = useSettingsStore((s) => s.watchClipboard);
  const concurrentFragments = useSettingsStore((s) => s.concurrentFragments);
  const audioFormat = useSettingsStore((s) => s.audioFormat);
  const sponsorblockMode = useSettingsStore((s) => s.sponsorblockMode);
  const sponsorblockCategories = useSettingsStore(
    (s) => s.sponsorblockCategories,
  );

  const setParallelLimit = useSettingsStore((s) => s.setParallelLimit);
  const setCookiesFromBrowser = useSettingsStore(
    (s) => s.setCookiesFromBrowser,
  );
  const setFfmpegPath = useSettingsStore((s) => s.setFfmpegPath);
  const setOutputTemplate = useSettingsStore((s) => s.setOutputTemplate);
  const setDefaultPreset = useSettingsStore((s) => s.setDefaultPreset);
  const setWriteSubs = useSettingsStore((s) => s.setWriteSubs);
  const setSubLangs = useSettingsStore((s) => s.setSubLangs);
  const setWriteAutoSubs = useSettingsStore((s) => s.setWriteAutoSubs);
  const setEmbedSubs = useSettingsStore((s) => s.setEmbedSubs);
  const setEmbedThumbnail = useSettingsStore((s) => s.setEmbedThumbnail);
  const setEmbedMetadata = useSettingsStore((s) => s.setEmbedMetadata);
  const setUseDownloadArchive = useSettingsStore(
    (s) => s.setUseDownloadArchive,
  );
  const setRestrictFilenames = useSettingsStore(
    (s) => s.setRestrictFilenames,
  );
  const setTheme = useSettingsStore((s) => s.setTheme);
  const setNotifyOnFinish = useSettingsStore((s) => s.setNotifyOnFinish);
  const setWatchClipboard = useSettingsStore((s) => s.setWatchClipboard);
  const setConcurrentFragments = useSettingsStore((s) => s.setConcurrentFragments);
  const setAudioFormat = useSettingsStore((s) => s.setAudioFormat);
  const setSponsorblockMode = useSettingsStore((s) => s.setSponsorblockMode);
  const setSponsorblockCategories = useSettingsStore(
    (s) => s.setSponsorblockCategories,
  );

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
        icon={Bell}
        title="Notifications & clipboard"
        desc="Background helpers — both off-by-default switches sit here so they're easy to find."
      >
        <div className="flex flex-col gap-3">
          <ToggleRow
            label="Notify on job finish/fail"
            desc="OS toast when a job reaches a terminal state. Cancellations stay silent — you initiated those. The first toast triggers the system permission prompt."
            checked={notifyOnFinish}
            onChange={setNotifyOnFinish}
          />
          <ToggleRow
            label="Watch clipboard for URLs"
            desc="When the Download tab gains focus, suggest an http(s) URL from your clipboard via a small dismissable banner. Nothing is pasted automatically."
            checked={watchClipboard}
            onChange={setWatchClipboard}
          />
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
        icon={Sliders}
        title="Concurrent fragments per download"
        desc={`yt-dlp's --concurrent-fragments. Speeds up HLS/DASH-fragmented sources (most live-stream archives, some CDN deliveries). Has no effect on plain MP4 sources. Default ${DEFAULT_CONCURRENT_FRAGMENTS}, max ${MAX_CONCURRENT_FRAGMENTS}.`}
        right={
          <span className="font-mono text-sm tabular-nums">
            {concurrentFragments}
          </span>
        }
      >
        <input
          type="range"
          min={MIN_CONCURRENT_FRAGMENTS}
          max={MAX_CONCURRENT_FRAGMENTS}
          step={1}
          value={concurrentFragments}
          onChange={(e) => setConcurrentFragments(Number(e.target.value))}
          className="w-full accent-primary"
          aria-label="Concurrent fragments"
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
              // Native option list inherits from <option>, not from <select>'s
              // Tailwind classes — and `bg-input` is alpha-transparent in dark
              // mode, which makes the OS-rendered popup white-on-white.
              "[&>option]:bg-card [&>option]:text-foreground",
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
        icon={Music}
        title="Audio format"
        desc="Only kicks in for audio-only downloads (Best Audio preset, or an audio-only row from the format table). Drives yt-dlp `--extract-audio --audio-format`. `default` means no recode (m4a from YouTube)."
      >
        <div className="flex flex-wrap gap-2">
          {AUDIO_FORMATS.map((fmt) => (
            <PresetChip
              key={fmt}
              label={audioFormatLabel(fmt)}
              active={audioFormat === fmt}
              onClick={() => setAudioFormat(fmt)}
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
          {writeSubs && (
            <div className="ml-7 flex flex-col gap-3 rounded-md border border-border bg-input/40 p-3">
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="sub-langs"
                  className="text-xs font-medium text-card-foreground"
                >
                  Languages
                </label>
                <input
                  id="sub-langs"
                  type="text"
                  value={subLangs}
                  onChange={(e) => setSubLangs(e.target.value)}
                  spellCheck={false}
                  className="rounded-md border border-border bg-input px-3 py-1.5 font-mono text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  aria-describedby="sub-langs-hint"
                />
                <p
                  id="sub-langs-hint"
                  className="text-xs text-muted-foreground"
                >
                  Comma-separated yt-dlp <code>--sub-langs</code> value. e.g.{" "}
                  <code>en</code>, <code>en,de,fr</code>, <code>en.*</code>, or{" "}
                  <code>all</code>.
                </p>
              </div>
              <ToggleRow
                label="Include auto-generated captions"
                desc="Falls back to auto-captions when manual subtitles aren't available for a requested language. yt-dlp `--write-auto-subs`."
                checked={writeAutoSubs}
                onChange={setWriteAutoSubs}
              />
              <ToggleRow
                label="Embed into video container"
                desc="Also bakes subtitles into the video file (mp4 / mkv / webm). The sidecar `.vtt` / `.srt` still gets written. yt-dlp `--embed-subs`."
                checked={embedSubs}
                onChange={setEmbedSubs}
              />
            </div>
          )}
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
          <ToggleRow
            label="Restrict filenames to ASCII"
            desc="Strips Unicode and other special characters from the filename so it stays safe on SMB shares, FAT32 USB sticks, and cross-OS copies. yt-dlp `--restrict-filenames`."
            checked={restrictFilenames}
            onChange={setRestrictFilenames}
          />
        </div>
      </Section>

      <Section
        icon={SkipForward}
        title="SponsorBlock"
        desc="Skip or mark sponsor segments, intros, outros and other categories crowdsourced via the SponsorBlock database. Off by default."
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            {SPONSORBLOCK_MODE_OPTIONS.map((m) => (
              <PresetChip
                key={m.id}
                label={m.label}
                hint={m.hint}
                active={sponsorblockMode === m.id}
                onClick={() => setSponsorblockMode(m.id)}
              />
            ))}
          </div>
          {sponsorblockMode !== "off" && (
            <fieldset className="grid grid-cols-2 gap-x-3 gap-y-2 rounded-md border border-border bg-input/40 p-3">
              <legend className="sr-only">SponsorBlock categories</legend>
              {SPONSORBLOCK_CATEGORIES.map((cat) => {
                const checked = sponsorblockCategories.includes(cat);
                return (
                  <label
                    key={cat}
                    className="flex cursor-pointer items-center gap-2 text-sm text-card-foreground"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        const next = e.target.checked
                          ? [...sponsorblockCategories, cat]
                          : sponsorblockCategories.filter((c) => c !== cat);
                          setSponsorblockCategories(next);
                      }}
                      className="size-4 cursor-pointer accent-primary"
                    />
                    <span>{SPONSORBLOCK_CATEGORY_LABELS[cat]}</span>
                  </label>
                );
              })}
            </fieldset>
          )}
          {sponsorblockMode !== "off" &&
            sponsorblockCategories.length === 0 && (
              <p
                role="alert"
                aria-live="polite"
                className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400"
              >
                Pick at least one category, otherwise SponsorBlock is silently
                skipped on every download.
              </p>
            )}
        </div>
      </Section>

      <YtdlpUpdaterSection />
    </div>
  );
}

function YtdlpUpdaterSection() {
  const [version, setVersion] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<UpdateOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void ytdlpVersion().then(
      (v) => !cancelled && setVersion(v),
      () => !cancelled && setVersion(null),
    );
    return () => {
      cancelled = true;
    };
  }, [outcome]);

  async function check() {
    setBusy(true);
    setError(null);
    setOutcome(null);
    try {
      const result = await updateYtdlp();
      setOutcome(result);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section
      icon={Download}
      title="yt-dlp updater"
      desc="Pulls the latest yt-dlp release from GitHub, verifies its SHA-256, and replaces the bundled sidecar in place. Refuses to run while jobs are queued, downloading, or paused."
      right={
        <code className="font-mono text-xs text-muted-foreground" title="current yt-dlp version">
          {version ?? "—"}
        </code>
      }
    >
      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={() => void check()}
          disabled={busy}
          className={cn(
            "flex w-fit items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors",
            "hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60",
          )}
        >
          {busy && <Loader2 className="size-3.5 animate-spin" />}
          {busy ? "Checking…" : "Check & install update"}
        </button>

        {outcome != null && (
          <p
            className={cn(
              "rounded-md border px-3 py-2 text-xs",
              outcome.replaced
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-500"
                : "border-border bg-muted text-muted-foreground",
            )}
          >
            {outcome.replaced
              ? `Updated ${outcome.from ?? "unknown"} → ${outcome.installed}.`
              : `Already on the latest release (${outcome.installed}).`}
          </p>
        )}

        {error != null && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 font-mono text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
    </Section>
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

function audioFormatLabel(fmt: AudioFormat): string {
  return fmt === "default" ? "Default (no recode)" : fmt;
}
