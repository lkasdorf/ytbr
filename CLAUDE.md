# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

YTBR is a Tauri 2 desktop frontend for [yt-dlp](https://github.com/yt-dlp/yt-dlp) (Windows + Linux). yt-dlp and a LGPL `ffmpeg` build are bundled as Tauri sidecars; everything else is Rust + React/TypeScript + Tailwind v4. Apache-2.0.

End-user docs live in [README.md](README.md). This file is the dev-side complement.

## Commands

All commands run from the project root (`ytbr/`).

```bash
pnpm install                                 # JS deps (auto-runs esbuild postinstall thanks to pnpm-workspace.yaml)
pnpm build                                   # tsc strict-check + Vite bundle (no Rust)
pnpm tauri dev --no-watch                    # dev window — use --no-watch ALWAYS (see Gotchas)
pnpm tauri build                             # full release bundle (.msi/.exe on Win, .deb/.AppImage on Linux)

cargo test --lib --manifest-path src-tauri/Cargo.toml    # Rust unit tests (format/progress parsers)
cargo check --manifest-path src-tauri/Cargo.toml         # quick Rust syntax check

./scripts/fetch-binaries.ps1                 # Windows: download yt-dlp + LGPL ffmpeg into src-tauri/binaries/
./scripts/fetch-binaries.sh                  # Linux/macOS: same, takes optional <target-triple> arg
```

`src-tauri/binaries/` is gitignored; **`fetch-binaries` must run before `pnpm tauri dev` or `pnpm tauri build`**, otherwise the sidecar resolver fails.

## Architecture

### Process / boundary model

Two processes, two languages, one strict boundary:

- **Rust backend** (`src-tauri/`): owns the queue, spawns yt-dlp/ffmpeg sidecars, parses progress, holds all long-lived state. Single-process; uses `tauri::async_runtime` (tokio underneath).
- **React frontend** (`src/`): pure UI + ephemeral state. Talks to Rust via two channels:
  - **Commands** (request/response): `invoke<T>(name, args)` — all wrappers typed in `src/lib/tauri-bridge.ts`. Names are snake_case to match Rust function names 1:1; arg keys are camelCase (Rust structs use `#[serde(rename_all = "camelCase")]`).
  - **Events** (push from Rust): `app.emit("name", payload)` on the Rust side, `listen()` on the JS side. Registered exactly once on app mount in `src/lib/tauri-events.ts`. Three events flow today: `job-progress`, `job-status`, `job-log-line`.

### The download pipeline (the heart of the app)

A click on the `Download` icon in `FormatTable` (or a preset button) traces this path:

1. `App.tsx` → `enqueue(formatId)` → `enqueueJob({ url, formatId, outputDir })` → invoke `enqueue_job`.
2. `commands/download.rs` → `QueueManager.enqueue` (in `queue.rs`). Validates output dir, generates a UUID, emits initial `job-status: queued`, spawns a tokio task gated by `Semaphore`.
3. Task transitions to `downloading`, hands off to `ytdlp/runner.rs::run` with a oneshot cancel receiver.
4. `runner.rs` spawns the `yt-dlp` sidecar with `--progress-template "PROG|..."` so progress lines come back stdout-line-delimited. `--ffmpeg-location` is auto-derived from the sidecar path (see Sidecar paths below) so video-only + audio-only streams can be muxed.
5. Each `CommandEvent::Stdout` line is parsed by `ytdlp/progress.rs::parse`. Match → `job-progress` event. Miss → `job-log-line`. Cancel signal → `child.kill()` and we mark `was_cancelled` so the eventual `Terminated` is mapped to `Cancelled` not `Failed`.
6. JS side: `tauri-events.ts` patches the `useJobsStore` (zustand) which `QueueView` subscribes to.

Critical insight: the runner DOES NOT auto-add `+bestaudio` to a single explicit format id — yt-dlp would silently download a video-only stream with no audio. `App.tsx::handleFormatRow` does this transformation client-side based on `classifyFormat(vcodec, acodec)`. Quick presets in `PresetButtons.tsx` use a full selector with `bv*+ba` and a fallback chain so they don't need the same wrapping.

### Sidecar paths (Tauri 2 quirk)

Tauri 2 has no public API to resolve an `externalBin` path at runtime — `tauri-plugin-shell::sidecar()` only returns a `Command`. We need an actual path string to pass `--ffmpeg-location` to yt-dlp.

Solution lives in two files:
- `src-tauri/build.rs` exports the cargo `TARGET` triple as a compile-time env via `cargo:rustc-env=TARGET=...`.
- `ytdlp/runner.rs::ffmpeg_sidecar_path()` derives `ffmpeg-<TARGET>{.exe}` and tries (a) next-to-current_exe (production layout), then (b) walks up looking for `src-tauri/binaries/` (dev layout).

If you ever need a path to yt-dlp itself (we don't yet), use the same trick.

### Capability model (Tauri 2 quirk)

The shell sidecar scope **must** live in `src-tauri/capabilities/default.json` under `shell:allow-execute` / `shell:allow-spawn` / `shell:allow-kill`, with explicit allow-lists for each sidecar name. **Do not** put a `plugins.shell.scope` block in `tauri.conf.json` — in Tauri 2 the `plugins.shell` config only accepts `open` and the app panics on init with `PluginInitialization("shell", "unknown field 'scope'")`.

### Layout

```
src-tauri/src/
  lib.rs                  # Builder: registers plugins (opener, shell, dialog) + manages QueueManager state
  error.rs                # AppError enum, serialized to JS as plain string
  queue.rs                # JobSpec / JobStatus / JobState / QueueManager (semaphore + cancel)
  ytdlp/
    format.rs             # yt-dlp -J deserializer (VideoInfo) + ProbeResult/Format wire shapes
    progress.rs           # PROG|... parser (TEMPLATE constant lives here)
    runner.rs             # yt-dlp spawn loop, event drain, cancel, ffmpeg path derivation
  commands/
    {download,probe,settings,system}.rs   # Tauri #[command]s, one file per logical group
  build.rs                # surfaces TARGET as compile-time env (see Sidecar paths)

src/
  App.tsx                 # Routing, sidebar, mounts startJobListeners + listJobs hydration
  features/
    url-input/UrlInput.tsx
    format-picker/{FormatTable,PresetButtons}.tsx
    queue/QueueView.tsx
    settings/OutputDirPicker.tsx
  lib/
    tauri-bridge.ts       # Typed invoke wrappers + TS shapes mirroring Rust serde structs
    tauri-events.ts       # listen() registration (idempotent)
    format-utils.ts       # classifyFormat, formatBytes/Bitrate/Duration/Resolution/Fps
    utils.ts              # cn() (clsx + tailwind-merge)
  stores/
    jobs.ts               # zustand: jobs map, ids order, patchProgress/patchStatus
    settings.ts           # zustand persist (localStorage): outputDir
  index.css               # Tailwind v4 import + slate theme tokens (oklch) + .dark variants
```

## Conventions

- Every source file (`.rs`, `.ts`, `.tsx`, `.css`) starts with `// SPDX-License-Identifier: Apache-2.0` + `// Copyright (c) 2026 Leon Kasdorf`.
- Conventional commits. Commit messages explain *why* and call out behavior surprises (see existing log for tone). When Claude authors a commit, append `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.
- Rust modules over fat files. New Tauri commands go in `commands/<group>.rs`, registered in `commands/mod.rs` + the `invoke_handler!` macro in `lib.rs`.
- Frontend TS strict mode (`noUnusedLocals`, `noUnusedParameters`, etc.). Path alias `@/*` → `src/*`.
- shadcn/ui set up manually (CLI hangs in non-interactive shells); add components by hand into `src/components/ui/` if you need them, with `style: new-york`, slate base.
- **`CHANGELOG.md` is updated alongside meaningful commits**, not only at session end. Keep a Changelog 1.1.0 categories under `[Unreleased]`. The `/end-session` skill is the safety net.
- App version is sourced from `package.json#version` and injected as `__APP_VERSION__` via `vite.config.ts` → shown in the sidebar header. Bump `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json` together when cutting a release; the prompt's helper-script-keeps-them-synchronized check is still TODO.

## Memories and the `/end-session` skill

Two parallel memory locations:

- **Source of truth (auto-loaded)**: `~/.claude/projects/<project-hash>/memory/` — Claude Code reads `MEMORY.md` and the linked files at session start.
- **Versioned copy in repo**: `.claude/memory/` — same files, kept in sync so they're visible on GitHub and survive a fresh clone.

The `/end-session` skill itself lives **outside the repo** at `~/.claude/skills/end-session/SKILL.md` (user-global). The repo intentionally only versions `.claude/memory/`; `.claude/skills/` and `.claude/settings*.json` are gitignored. The skill handles the routine wrap-up — survey what changed, update memories on both sides, append CHANGELOG entries, commit + push. Invoke whenever wrapping a working session, or as a mid-session checkpoint.

**Fresh-clone bootstrap**: copy the repo's `.claude/memory/*.md` into `~/.claude/projects/<your-project-hash>/memory/` before the first session — Claude won't auto-load from the repo path. Re-author the `/end-session` skill in your own `~/.claude/skills/` if you want it (the skill body is short and the wiring is documented in this file).

## Gotchas

- **OneDrive triggers tauri dev's Rust watcher.** This project lives under `OneDrive\…\16_Projects\YTBR\`. OneDrive touches file metadata in the background; tauri-cli reads that as "file changed" and rebuilds mid-run, killing in-flight downloads. **Always** use `pnpm tauri dev --no-watch`. After Rust edits, stop and restart manually.
- **PowerShell PATH after Rust install.** Rustup installed `~/.cargo/bin` to user PATH but a fresh shell session may not pick it up. If `cargo` is "not found", run:
  `$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")`
- **pnpm v10+ build-script gate.** `esbuild` (and any other native postinstall) is blocked by default. The repo's `pnpm-workspace.yaml` lists `allowBuilds: { esbuild: true }` — keep it. New native deps go there too.
- **Path quoting on Windows.** The repo path has spaces (`Kaffon Company Limited`). Always quote in shell commands; avoid `cd` inside scripts.
- **Tauri command result types.** Both `T` and `E` in `Result<T, E>` need `Serialize`. `E` also needs `Display` for our string marshaling — that's why `AppError` impls `Serialize` manually as a string.
- **Emitter payloads need `Clone`.** `app.emit("ev", payload)` requires `payload: Serialize + Clone`. When you write a one-off inline payload struct, derive both.
- **Installer size: ffmpeg LGPL is 164 MB.** Blows the `<80 MB` install-size goal. Slimming it (essentials build / custom compile) is an open task, not yet done.
- **Playlists hardcoded off.** `commands/probe.rs` and `ytdlp/runner.rs` both pass `--no-playlist`. The `VideoInfo` deserializer doesn't model playlist `entries[]`. Documented TODO in both files.
