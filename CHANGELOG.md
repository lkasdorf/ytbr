# Changelog

All notable changes to YTBR will be documented in this file.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/lkasdorf/ytbr/compare/HEAD...HEAD
