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
  - **Events** (push from Rust): `app.emit("name", payload)` on the Rust side, `listen()` on the JS side. Registered exactly once on app mount in `src/lib/tauri-events.ts`, which buffers them and applies one `applyBatch` store update per 100 ms. Four events flow today: `job-progress`, `job-status`, `job-log-line`, `queue-paused` (queue-wide Pause all flag).

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

yt-dlp itself is never spawned via `sidecar("yt-dlp")` directly — always through `runner::ytdlp_command()`, which prefers the in-app updater's per-user copy (`<app_local_data_dir>/bin/`) over the bundled sidecar. Per-machine installs under `C:\Program Files` aren't writable, so the updater can't replace the sidecar in place. `ytdlp/user_copy.rs` drops the user copy at startup once the bundled one is at least as new.

The release yt-dlp binaries are PyInstaller one-file builds: the spawned pid is a bootloader, the real worker is its child. Pause / resume / cancel must act on the whole tree — `ytdlp/process_tree.rs`.

### Capability model (Tauri 2 quirk)

All process spawning happens in Rust. `Shell::command` / `Shell::sidecar` from Rust are **not** scope-checked, so the webview gets **no** `shell:*` permissions in `src-tauri/capabilities/default.json` — granting `shell:allow-execute` with `args: true` would let any script in the webview run `yt-dlp --exec …`. Keep it that way; add a Rust command instead of a JS shell call. **Do not** put a `plugins.shell.scope` block in `tauri.conf.json` — in Tauri 2 the `plugins.shell` config only accepts `open` and the app panics on init with `PluginInitialization("shell", "unknown field 'scope'")`.

Every yt-dlp invocation passes `--` before the URL so a "URL" starting with `-` (dropped .txt, remote playlist entry) can't be parsed as an option.

### Layout

```
src-tauri/src/
  lib.rs                  # Builder: registers plugins (opener, shell, dialog) + manages QueueManager state
  error.rs                # AppError enum, serialized to JS as plain string
  queue.rs                # JobSpec / JobStatus / JobState / QueueManager (semaphore + cancel)
  ytdlp/
    format.rs             # yt-dlp -J deserializer (VideoInfo) + ProbeResult/Format wire shapes
    progress.rs           # PROG|... parser (TEMPLATE constant lives here)
    runner.rs             # yt-dlp spawn loop, event drain, cancel, ffmpeg path derivation, ytdlp_command()
    process_tree.rs       # suspend / resume / kill a pid plus all its descendants (PyInstaller worker, ffmpeg)
    user_copy.rs          # startup pruning of the updater's per-user yt-dlp
  commands/
    {download,probe,settings,system}.rs   # Tauri #[command]s, one file per logical group
  build.rs                # surfaces TARGET as compile-time env (see Sidecar paths)

src/
  App.tsx                 # Routing, sidebar, mounts startJobListeners + listJobs hydration
  features/
    url-input/UrlInput.tsx
    format-picker/{FormatTable,PresetButtons}.tsx
    queue/QueueView.tsx       # JobCard subscribes to its own job (memo); lists key on statusVersion
    queue/VirtualJobList.tsx  # virtualized card list shared by Queue + History
    settings/OutputDirPicker.tsx
  lib/
    tauri-bridge.ts       # Typed invoke wrappers + TS shapes mirroring Rust serde structs
    tauri-events.ts       # listen() registration (idempotent)
    format-utils.ts       # classifyFormat, formatBytes/Bitrate/Duration/Resolution/Fps
    utils.ts              # cn() (clsx + tailwind-merge)
  stores/
    jobs.ts               # zustand: jobs map, ids order, upsert/applyBatch, statusVersion
    settings.ts           # zustand persist (localStorage): outputDir
  index.css               # Tailwind v4 import + slate theme tokens (oklch) + .dark variants
```

## Conventions

- Every source file (`.rs`, `.ts`, `.tsx`, `.css`) starts with `// SPDX-License-Identifier: Apache-2.0` + `// Copyright (c) 2026 Leon Kasdorf`.
- Conventional commits. Commit messages explain *why* and call out behavior surprises (see existing log for tone). When Claude authors a commit, append the `Co-Authored-By:` trailer its current session specifies — the model name changes between sessions, so do not copy an older commit's trailer verbatim.
- Rust modules over fat files. New Tauri commands go in `commands/<group>.rs`, registered in `commands/mod.rs` + the `invoke_handler!` macro in `lib.rs`.
- Frontend TS strict mode (`noUnusedLocals`, `noUnusedParameters`, etc.). Path alias `@/*` → `src/*`.
- shadcn/ui set up manually (CLI hangs in non-interactive shells); add components by hand into `src/components/ui/` if you need them, with `style: new-york`, slate base.
- **`CHANGELOG.md` is updated alongside meaningful commits**, not only at session end. Keep a Changelog 1.1.0 categories under `[Unreleased]`. The `/end-session` skill is the safety net.
- App version is sourced from `package.json#version` and injected as `__APP_VERSION__` via `vite.config.ts` → shown in the sidebar header. Bump `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json` together when cutting a release — `pnpm version:check` asserts they match and `pnpm version:set <semver>` (`scripts/version-sync.mjs`) bumps all three at once.

## Memories and the `/end-session` skill

All Claude Code artifacts — memories, skills, settings, hooks — are **user-local** and intentionally not versioned. The whole `.claude/` directory is gitignored.

- **Memory**: lives in `~/.claude/projects/<project-hash>/memory/`, auto-loaded at session start. `MEMORY.md` is the index; the rest are the entries it links to. Built up by Leon over the session — backlog, workflow preferences, performance constraints, references.
- **Skill**: `/end-session` lives at `~/.claude/skills/end-session/SKILL.md`. Walks the routine wrap-up — survey what changed, update memories, append `CHANGELOG.md` entries, commit + push. Invoke whenever wrapping a working session or as a mid-session checkpoint.
- **Wrap-up specifics** the skill is project-agnostic about, so they live here: `ytbr_backlog.md` is the project-state entry — on wrap-up move done items out, add what was flagged this session, and refresh its `**Status as of <date>:**` line; note bigger landings under `**Recently completed (<date>)**`. The other four entries (`user_profile`, `ytbr_workflow`, `ytbr_perf_constraints`, `ytbr_references`) are touched only on *new* explicit feedback or changed URLs/paths/tooling — re-affirming an unchanged entry is churn.
- `ytbr_backlog.md` also carries a `**[Unreleased] on main:**` line mirroring the `[Unreleased]` section of `CHANGELOG.md`. Two places, one fact — update them together.

A fresh clone on another machine starts with no memory and no skill. That's by design — they're personal context, not project artifacts. `CHANGELOG.md` and this `CLAUDE.md` carry the parts that future contributors actually need.

## App auto-update setup (one-time)

The signed in-app updater path (`tauri-plugin-updater` + the About dialog's "Download & install" button) needs a Tauri signing keypair before it can verify a newer release. Until the keypair is in place the in-app updater silently falls back to the GitHub-API path that just opens the release page.

Generate the keypair **on the maintainer's machine** (the private key never lands in the repo or in any CI environment except as a GitHub secret):

```bash
pnpm tauri signer generate -w ~/.tauri/ytbr-updater.key
# follow the prompts; an empty password is fine for an unattended CI build
```

The command prints the public key to stdout. Copy it (one line, base64) into `src-tauri/tauri.conf.json` under `plugins.updater.pubkey`, replacing the `REPLACE_BEFORE_NEXT_RELEASE` placeholder. Commit and push that change.

Add two repo secrets at https://github.com/lkasdorf/ytbr/settings/secrets/actions:

- `TAURI_SIGNING_PRIVATE_KEY` — full contents of `~/.tauri/ytbr-updater.key`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — the password if any, otherwise leave blank

Both env vars are wired into `tauri-action` in `.github/workflows/release.yml`. On the next tag push the action signs the bundles, generates `latest.json` with signatures + download URLs, and uploads it to the GitHub release alongside the installers. The frontend's `plugins.updater.endpoints` already points at `https://github.com/lkasdorf/ytbr/releases/latest/download/latest.json`, so once that file exists the in-app "Download & install" button starts working.

A few notes worth keeping nearby:

- The keypair is for *update* signing, not OS code-signing. The MSI/NSIS installers themselves stay unsigned until a separate Authenticode/notarization story lands. Windows SmartScreen still warns on first install.
- If the private key is rotated, every release after that needs the new pubkey deployed in `tauri.conf.json` *before* the tag push, otherwise installed clients with the old pubkey will reject the new signature and stay stuck on the previous version.
- Never commit `~/.tauri/ytbr-updater.key`. The `.claude/` gitignore doesn't cover it; treat it like an SSH private key.

## Gotchas

- **OneDrive triggers tauri dev's Rust watcher.** This project lives under `OneDrive\…\16_Projects\YTBR\`. OneDrive touches file metadata in the background; tauri-cli reads that as "file changed" and rebuilds mid-run, killing in-flight downloads. **Always** use `pnpm tauri dev --no-watch`. After Rust edits, stop and restart manually.
- **PowerShell PATH after Rust install.** Rustup installed `~/.cargo/bin` to user PATH but a fresh shell session may not pick it up. If `cargo` is "not found", run:
  `$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")`
- **pnpm v10+ build-script gate.** `esbuild` (and any other native postinstall) is blocked by default. The repo's `pnpm-workspace.yaml` lists `allowBuilds: { esbuild: true }` — keep it. New native deps go there too.
- **Path quoting on Windows.** The repo path has spaces (`Kaffon Company Limited`). Always quote in shell commands; avoid `cd` inside scripts.
- **Tauri command result types.** Both `T` and `E` in `Result<T, E>` need `Serialize`. `E` also needs `Display` for our string marshaling — that's why `AppError` impls `Serialize` manually as a string.
- **Emitter payloads need `Clone`.** `app.emit("ev", payload)` requires `payload: Serialize + Clone`. When you write a one-off inline payload struct, derive both.
- **Installer size: bundled ffmpeg is UPX-compressed.** `scripts/fetch-binaries.{ps1,sh}` run `upx --best --lzma` on the LGPL ffmpeg sidecar after extraction (BtbN ships it at ~164 MB, UPX brings it to ~38 MB). UPX version is pinned in both scripts; bump it together. If a specific antivirus heuristically flags the compressed binary as suspicious, the workaround is to comment out the upx step for that release until code-signing lands.
- **Playlists hardcoded off.** `commands/probe.rs` and `ytdlp/runner.rs` both pass `--no-playlist`. The `VideoInfo` deserializer doesn't model playlist `entries[]`. Documented TODO in both files.
