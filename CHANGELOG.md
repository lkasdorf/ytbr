# Changelog

All notable changes to YTBR will be documented in this file.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Settings page (`src/features/settings/SettingsView.tsx`) with sections for output folder, parallel-download limit, cookies-from-browser, ffmpeg path override, yt-dlp output template, and default preset. All values persist via the existing `ytbr.settings.v1` localStorage key (zustand-persist merges new fields onto defaults at hydration, so the v0.1.0 install carries over without a migration). UI-only in this commit — only the output folder is wired into the download path; parallel limit, cookies, ffmpeg override, output template, and default preset land in subsequent iterations.
- Parallel-download limit is now live: the Settings slider (1..8, default 2) is pushed to a new `set_parallel_limit` Tauri command on mount and on each change. The Rust `QueueManager` adjusts the live tokio `Semaphore` — growing is instant via `add_permits`, shrinking absorbs excess permits in a background task using `permit.forget()` so in-flight jobs are not disturbed and new jobs see the new limit. `lib.rs::DEFAULT_PARALLEL_LIMIT` is now `2` to match the spec's default.
- Cookies-from-browser, ffmpeg-path override, and output-template Settings are now wired into the download path. Each enqueue snapshots the current Settings store and includes them in `JobSpec` (new fields `cookiesFromBrowser` and `ffmpegLocation`; `outputTemplate` already existed but wasn't being passed). The runner adds `--cookies-from-browser <browser>` when set, prefers an explicit ffmpeg path over the bundled sidecar, and uses the user's output template. Mid-flight Settings changes never disturb running jobs.
- Default preset is now visible: `PresetButtons` reads `useSettingsStore.defaultPreset` and renders a star badge plus a primary-tinted border on the matching tile. The button still requires a click — selection is a hint, not auto-apply, so a paste of the wrong URL never starts an unwanted download. Each preset gained a stable `id` (`audio-best` / `video-720` / `video-1080` / `video-4k`) so the Settings chips and the Download tiles agree.
- Per-format options as global defaults in Settings: `Write subtitles`, `Embed thumbnail`, `Embed metadata`, `Use download archive`. All four are stored alongside the existing settings, snapshot at enqueue, and propagated through `JobSpec`. The runner emits the matching yt-dlp flags (`--write-subs`, `--embed-thumbnail`, `--embed-metadata`, `--download-archive <path>`). The download archive lives at `<app config dir>/archive.txt` (so duplicates are deduplicated across sessions and across output folders), is created lazily, and is silently skipped if the config dir cannot be resolved. All four toggles default to off — a v0.1.0 install opts into them explicitly.
- New "Batch" tab between Download and Queue. Paste many URLs (one per line) or drop a `.txt` file via HTML5 drag-and-drop, pick a format choice (yt-dlp default = `bestvideo*+bestaudio/best`, or one of the Quick presets, initialized to the user's default preset), and press "Enqueue all". Each URL goes through `enqueueJob` with the full Settings snapshot — same cookies, ffmpeg path, output template, and per-format options as a single download. The view reports successes and per-URL failure reasons inline. `PRESETS` and a new `DEFAULT_BATCH_SELECTOR` are now exported from `PresetButtons.tsx` so Batch and Download share the format definitions.
- Queue view sortable: dropdown above the job list with five modes — Newest first (default, was the previous behavior), Oldest first, Status (`downloading` → `queued` → `failed` → `completed` → `cancelled`), Progress high→low, and Progress low→high. Sort is local to the view (no persistence yet) and uses insertion order from `useJobsStore.ids` as a deterministic created-at proxy and tie-breaker.

### Changed

- `lib.rs` no longer hardcodes a parallel limit of 1. Boot still uses a constant (`DEFAULT_PARALLEL_LIMIT = 2`) until the frontend's first `setParallelLimit` sync lands; after that the persisted UI value wins.

## [0.1.0] - 2026-05-10

First public release. Iteration 1 of the YTBR Tauri desktop frontend for yt-dlp:
URL probe, sortable format table, quick presets, queued downloads with live
progress and cancel, video+audio muxing via bundled LGPL ffmpeg, persisted
output directory.

### Added

- Tauri 2.11 + React 19 + TypeScript 5.8 + Vite 7 desktop shell scaffolded for Windows 11 and Linux (deb + AppImage).
- Tailwind CSS v4 + shadcn/ui (slate base, dark default) with a two-pane layout: sidebar navigation (Download / Queue / Settings) and main content area.
- Apache-2.0 `LICENSE`, `NOTICE` covering bundled third-party software (yt-dlp Unlicense, ffmpeg LGPL with Section 6 replaceability) and a trademark / no-platform-affiliation disclaimer, README scaffold with install + build-from-source + user-responsibility sections.
- yt-dlp and the LGPL build of ffmpeg bundled as Tauri sidecars with the target-triple suffix naming convention.
- `scripts/fetch-binaries.ps1` and `scripts/fetch-binaries.sh` to download both sidecars for the host (or a passed) Rust target triple, with SHA-256 verification (best-effort for ffmpeg, since BtbN does not publish per-file checksums).
- URL probe via `yt-dlp -J`, returning a typed `ProbeResult` (Rust serde + matching TypeScript shapes via `@/lib/tauri-bridge`).
- Sortable, filterable format table with chip filters (All / Combined / Video only / Audio only) and per-row download action.
- Quick presets — Best Audio (m4a), 720p MP4, 1080p MP4, 4K MP4 — using yt-dlp format selectors with resilient fallback chains.
- Output directory picker (native folder dialog), persisted to `localStorage` via Zustand.
- Download queue with live progress (bar, speed in B/s, ETA, byte counter), `job-status` / `job-progress` / `job-log-line` events, and cancel via OS-level child kill.
- `--ffmpeg-location` auto-derived from the bundled sidecar path so video-only + audio-only YouTube streams are muxed correctly. Sidecar path resolution uses a `build.rs`-injected `TARGET` env to find `ffmpeg-<triple>{.exe}` next to the main executable (production) or under `src-tauri/binaries/` (development).
- Auto-append `+bestaudio/best` for video-only single-format picks so explicit format-row clicks produce muxed files instead of silent video.
- App version displayed in the sidebar footer, sourced from `package.json` at build time.
- `CLAUDE.md` developer guide covering the Rust↔JS boundary, sidecar path quirks, and the OneDrive-vs-tauri-dev-watcher trap.
- `CHANGELOG.md` (this file) and an `/end-session` Claude Code skill that updates memories, syncs them into the repo, and pushes.
- 6 Rust unit tests covering yt-dlp JSON deserialization and progress-line parsing.

### Changed

- `.gitignore` now excludes the entire `.claude/` directory. Claude Code artifacts (memories, skills, settings, hooks) are user-local — none of it lives in the repo. The earlier `.claude/memory/` mirror was removed.
- `scripts/fetch-binaries.{ps1,sh}` now UPX-compress the bundled LGPL ffmpeg sidecar (`upx --best --lzma`, pinned to UPX v5.0.2). The Windows ffmpeg binary drops from 164.12 MB to 38.27 MB (-76.7%), bringing total sidecar disk footprint to ~56 MB and the install-size goal of <80 MB within reach. Decompress overhead is paid once on each ffmpeg launch (tens of ms on modern hardware) and is irrelevant since ffmpeg is spawned on-demand, not on app boot.

### Notes

- `--no-playlist` is hardcoded in both the probe and runner. Playlist support is a planned follow-up; the current `VideoInfo` deserializer doesn't model `entries[]`.
- `OneDrive` sync touches file metadata frequently enough that `tauri dev`'s Rust file watcher mistakes it for an edit and rebuilds mid-run; always pass `--no-watch` while developing.
- Some antivirus engines flag UPX-compressed binaries as suspicious (heuristic, not signature-based). YTBR's installer is unsigned today; once code-signing is in place, AV vendors stop short-circuiting on UPX heuristics. Fallback option if a specific AV blocks the bundled ffmpeg: comment out the upx step in `fetch-binaries.{ps1,sh}` for that release.

[Unreleased]: https://github.com/lkasdorf/ytbr/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/lkasdorf/ytbr/releases/tag/v0.1.0
