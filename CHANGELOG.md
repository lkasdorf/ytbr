# Changelog

All notable changes to YTBR will be documented in this file.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security

- Tauri updater public key injected into `tauri.conf.json` (replaces the
  `REPLACE_BEFORE_NEXT_RELEASE` placeholder shipped since v0.5.0). The
  matching private key + (empty) password live as GitHub Actions secrets
  `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, so
  the next tag push produces a signed `latest.json` and the in-app
  "Download & install" button starts verifying signatures instead of
  falling through to the GitHub-API release-page link.

## [0.5.1] - 2026-05-11

Postprocessing-fix patch. Every format selection that triggered a
yt-dlp postprocessing step (video+audio muxing on YouTube formats
above 360p, `--extract-audio`, `--embed-metadata`, …) failed with
`ERROR: Postprocessing: ffprobe not found` because we were only
bundling `ffmpeg`. yt-dlp auto-discovers `ffprobe` next to
`--ffmpeg-location`, so the fix is to ship it alongside. Comes with
a humanized fallback message in case a future install ever drops
the binary.

### Added

- `ffprobe` now ships alongside the bundled `ffmpeg` sidecar — extracted
  from the same BtbN LGPL archive, UPX-compressed in place, declared as
  a third Tauri `externalBin`, and staged in dev under both the
  triple-suffixed name (for the manifest) and the bare `ffprobe{.exe}`
  name yt-dlp's auto-discover looks for next to `--ffmpeg-location`.
  Installer footprint grows by ~38 MB (one extra UPX-compressed binary).

### Changed

- Failed jobs now surface yt-dlp's own `ERROR: …` stderr line instead of
  the generic "yt-dlp exited with code 1", and the
  `Could not copy <Browser> cookie database` case (yt-dlp issue #7271)
  is translated into an actionable hint pointing at the
  "Cookies from browser" Settings toggle. The raw upstream line still
  shows in the logs panel. The `Postprocessing: ffprobe not found`
  case is also humanized as a defensive fallback.

## [0.5.0] - 2026-05-10

Iter 3+ closes and the app gets a real visual identity. Three feature
items polish parity with established yt-dlp wrappers (concurrent
fragments slider, audio-format chips for audio-only downloads,
playlist/channel detection on the Download tab that redirects to the
Batch tab). The signed `tauri-plugin-updater` path is scaffolded
end-to-end — plugin + capability + workflow secrets + About-dialog
"Download & install" button — pending a `tauri signer generate`
keypair injection on the maintainer's machine; until then the
in-app updater silently falls through to the existing GitHub-API
release-page link. The in-bundled-install yt-dlp self-updater is
fixed (the resolver was looking for the target-triple-suffixed
filename Tauri's bundler doesn't keep). Two design passes land in
the same release: a chartreuse `--primary` brand accent across both
themes, JetBrains Mono bundled offline as `--font-mono`, status-keyed
JobCard left edges, redesigned ProgressBar with tape stripes and a
sweeping indeterminate state, sidebar/header/empty-state polish — and
behind that, a proper accessibility pass (`prefers-reduced-motion`
guard on the new animations, `focus-visible` rings on sidebar nav,
`focus-within` on the URL form, `role="alert"` on the probe error).
The `BSL-1.0` and `CDLA-Permissive-2.0` licenses joined the
`deny.toml` allow-list as transitive deps of
`tauri-plugin-clipboard-manager` and `reqwest`; the `OFL-1.1` license
shows up in THIRD_PARTY_LICENSES.md for JetBrains Mono.

### Changed

- Visual identity pass — the app now reads as a tool rather than a default-shadcn admin panel:
  - `--primary` swapped from achromatic slate to a chartreuse `oklch(0.74 0.16 130)` (light) / `oklch(0.85 0.18 130)` (dark). Every accent in the app — active sidebar item, Probe button, "Insert" suggestion, "Open in Batch" link, progress bars, "Download & install" CTA — instantly carries brand color.
  - JetBrains Mono bundled via `@fontsource/jetbrains-mono` (offline-capable, no Google Fonts CDN). Registered as `--font-mono` so every existing `font-mono` callsite (format ids, codecs, output dirs, byte/speed/eta numbers, the version pill) inherits a real mono.
  - Sidebar wordmark now renders as `font-mono uppercase tracking-[0.25em]` "ytbr" — terminal-character treatment that matches the tool's actual purpose.
  - Sidebar active route gets a 2px primary left bar and a primary-tinted icon.
  - Main header right-aligns route-aware info: `<n> active · <n> queued · <n> done` on Queue, the active output dir on Download. Was empty space before.
  - JobCards have a 3px left-edge accent keyed to status (downloading=primary, completed=emerald-500, failed=destructive, paused=amber-500, cancelled=neutral). A queue of mixed jobs is now scannable at a glance.
  - ProgressBar redesigned: animated tape-stripe overlay (1.1s linear) only while bytes are flowing; solid bar when paused/queued/completed; a 25%-wide block sweeping left-to-right replaces `animate-pulse` for the indeterminate state. Color shifts to emerald-500 on completion and amber-500 when paused.
  - Empty states (Download tab idle, Queue empty) now render as oversized lucide icon + title + body inside a dashed border — readable as "intentional empty state" rather than "placeholder copy".
- BatchView's "Add playlist…" trigger and the playlist-URL input copy now mention channel URLs explicitly. `expand_playlist` already worked for `https://youtube.com/@channel/videos`-style URLs (yt-dlp's flat-expansion treats them as playlists); the doc comment now records that bare `@channel` URLs flat-expand into the channel's *sub-playlists* (Videos, Shorts, Live), which the runner can't download as-is because of `--no-playlist`. Append `/videos` (or `/streams`, `/shorts`) for predictable behavior.

### Added

- Signed auto-update path scaffolded: `tauri-plugin-updater` + `tauri-plugin-process` (plus `@tauri-apps/plugin-updater` + `@tauri-apps/plugin-process`), `updater:default` + `process:default` capabilities, `plugins.updater.endpoints` in `tauri.conf.json` pointed at `https://github.com/lkasdorf/ytbr/releases/latest/download/latest.json`. The About dialog's update-check now calls `check()` first and falls through to the existing GitHub-API path if the signed flow errors (placeholder pubkey, missing `latest.json`, network). When `check()` returns an Update handle, a "Download & install" button runs `downloadAndInstall()` with progress feedback and `relaunch()` from `plugin-process` after install. Release workflow wires `TAURI_SIGNING_PRIVATE_KEY` + `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` into `tauri-action` so the signed `latest.json` lands on the release once the secrets exist. Pubkey in `tauri.conf.json` is the placeholder `REPLACE_BEFORE_NEXT_RELEASE` until the maintainer runs `pnpm tauri signer generate` — the in-app updater silently falls back to the GitHub-API path until then. Setup steps are documented in CLAUDE.md.
- Playlist/channel detection on the Download tab. When the URL field contains a `youtube.com/playlist?list=…`, `/@handle` (or `/channel/…`, `/c/…`, `/user/…`), or a `/watch?v=…&list=…` URL, a small "Open in Batch" banner appears above the URL input. Clicking it pre-fills the URL into the Batch tab's textarea and switches the route. Heuristics are conservative — non-YouTube URLs flow through as before since yt-dlp handles ~1800 sites with their own URL shapes.
- "Audio format" chips in Settings (`default` / `mp3` / `opus` / `flac` / `wav`). Drives yt-dlp `--extract-audio --audio-format <fmt>`. The chips only have effect when the resulting download is audio-only — wired into both the Download tab (preset kind threaded through `PresetButtons.onPick` and `classifyFormat` for format-table rows) and the Batch tab (only `audio-best` choice qualifies). `default` is a no-op so the previous m4a-from-YouTube behavior is preserved unchanged. Skipped legacy video recode targets (wmv/flv/3gp/avi) — niche, big UX surface, not worth the burden.
- "Concurrent fragments per download" slider in Settings (1–8, default 1). Wires yt-dlp's `--concurrent-fragments` through `JobSpec.concurrentFragments` to the runner, which omits the flag entirely at value 1 (yt-dlp's own default — passing it explicitly only adds noise to the spawn command line). Real speed-up for HLS/DASH-fragmented sources (most live-stream archives, some CDN deliveries); no effect on plain MP4 sources.

### Fixed

- Accessibility pass against the ui-ux-pro-max P1–P10 checklist:
  - **`prefers-reduced-motion`**: the new `ytbr-stripe` (active-download tape stripes) and `ytbr-indeterminate` (sweeping bytes-unknown bar) animations now sit inside a `@media (prefers-reduced-motion: reduce)` guard. Vestibular-sensitive users get a static striped pattern (still readable as "active") and a parked indeterminate block at ~40% across the track instead of continuous motion.
  - **`focus-visible` on sidebar nav**: previously every keyboard tab landed on a sidebar button with no visual indication. Added `focus-visible:ring-2 focus-visible:ring-sidebar-ring`. The new chartreuse `--sidebar-ring` makes the ring read clearly in both themes.
  - **`focus-within` on the URL form wrapper**: `<input>` had `outline-none` for the borderless inline look but no replacement focus state, so keyboard focus was invisible. The wrapping `<form>` now lights up with `focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-ring` whenever its child input is focused.
  - **`role="alert"` + `aria-live="polite"`** on the probe-error region. Screen readers now announce URL probe failures instead of silently leaving them on screen.
- yt-dlp self-updater reported "could not locate the yt-dlp sidecar to overwrite" in bundled MSI/NSIS/DEB/AppImage installs. The sidecar resolver in `runner.rs` only tried the target-triple-suffixed filename (`yt-dlp-<TARGET>{.exe}`), but Tauri's bundler drops the target triple when it places the file next to the main exe — so the bundled install has just `yt-dlp.exe` (matching the bare name the plugin-shell runtime resolver looks for at spawn time). The resolver now tries both candidate names in both the next-to-exe and the dev-walk-up locations. The ffmpeg path resolution benefits from the same change automatically since it shares the helper.
- Native `<select>` dropdowns (Cookies-from-browser in Settings, Sort in Queue) were unreadable in dark mode — `bg-input` is alpha-transparent in dark mode, so the OS-rendered popup landed on a white system surface and rendered light foreground text on white. Fixed by adding `[&>option]:bg-card [&>option]:text-foreground` so `<option>` elements style independently from the `<select>` body.

## [0.4.0] - 2026-05-10

Iteration 3. Seven user-facing additions land in one cut: a Theme
switcher (the `.dark` token block has been in `index.css` since v0.1.0
but was never reachable — a tiny `useThemeEffect` hook now flips the
class on `<html>`), an "Open in folder" button on terminal jobs, an
About dialog reachable from the version pill, native OS notifications
on job finish/fail (lazy-permission, opt-out), a clipboard URL watcher
that suggests `http(s)://…` clipboard contents above the URL input,
a yt-dlp self-updater that pulls the latest GitHub release with
SHA-256 verification and atomic-replace, and a minimal "Check for app
updates" button in the About dialog. Two new permissive licenses
(`BSL-1.0`, `CDLA-Permissive-2.0`) joined the `deny.toml` allow-list,
arrived as transitive deps of `tauri-plugin-clipboard-manager` and
`reqwest`. The signed-bundle path via `tauri-plugin-updater` stays
out of scope until there's a code-signing key.

### Added

- "Check for app updates" button in the About dialog. New `check_app_update` command hits `https://api.github.com/repos/lkasdorf/ytbr/releases/latest`, compares the tag to `CARGO_PKG_VERSION` (the leading `v` is stripped before comparing — GitHub tags it `vX.Y.Z`, Cargo doesn't), and either reports up-to-date or shows a one-click "View release" tile that opens the GitHub release page in the OS browser. Intentionally minimal scope: no auto-install, no signing, no `tauri-plugin-updater`. The signed-bundle path stays out of scope until there's a code-signing key.
- yt-dlp self-updater. New "Check & install update" button in Settings hits `https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest`, downloads the OS-specific upstream asset (`yt-dlp.exe` on Windows, `yt-dlp_linux` on Linux), verifies its SHA-256 against the release's `SHA2-256SUMS` (looked up by upstream asset name — same lesson the `fetch-binaries` scripts learned in `b872d31`, encoded in code rather than left as a comment), and atomically renames the new binary onto the existing sidecar slot. Refuses to run while any job is queued/downloading/paused (new `QueueManager::has_active_jobs`). Brings in `reqwest` (rustls-tls only — keeps the build off OpenSSL) and `sha2`.
- Clipboard URL watcher on the Download tab. New `tauri-plugin-clipboard-manager` (npm + cargo + `clipboard-manager:allow-read-text` capability — the narrowest permission, we never write back) plus a small `ClipboardSuggestion` banner above the URL input. On mount and on every window-focus event the clipboard is read; if it parses as `http(s)://…` and isn't already in the URL field, a dismissable banner offers an Insert button. Nothing is auto-pasted. Per-URL dismiss state is component-local (re-suggests when the clipboard changes again). Gated by a new `watchClipboard` Setting toggle (default: on). UrlInput became a controlled component so the banner can fill it.
- Native OS notifications when a job reaches a terminal state. New `tauri-plugin-notification` (npm + cargo + `notification:default` capability) plus a small `src/lib/notify.ts` helper that lazy-requests the OS permission on the first finish event so the user never sees a permission prompt before any download has actually run. Wired from the existing `job-status` event handler in `tauri-events.ts` — fires only on actual transitions, only into `completed` or `failed` (cancelled stays silent — the user initiated those), and only if the new `notifyOnFinish` toggle in Settings is on (default: on). Toast title is the final status, body is the URL.
- About dialog. Click the version pill in the sidebar header to open a modal with the app version (`__APP_VERSION__`), `yt-dlp --version`, and the first line of `ffmpeg -version`, plus links that open the GitHub repo and `THIRD_PARTY_LICENSES.md` in the OS default browser via `tauri-plugin-opener`'s `openUrl` (URL scope is already in `opener:default`, no capability change). Versions are fetched lazily on dialog mount via two new commands: `ffmpeg_version` (sibling of the existing `ytdlp_version`) plus a small JS bridge wrapper. Esc and backdrop-click close the modal.
- "Open in folder" button on each terminal job (`completed`, `failed`, `cancelled`) in QueueView. Opens the job's `outputDir` in the OS file manager via a new `reveal_in_folder` Rust command that delegates to `tauri-plugin-opener`'s `open_path`. Going through Rust avoids widening the JS-side `opener:allow-open-path` scope to cover every possible user-chosen output directory — the plugin's Rust API has no scope check.
- Theme switcher in Settings. Three modes — System (default, follows the OS `prefers-color-scheme` and updates live when it flips), Light, Dark — persisted in the existing `ytbr.settings.v1` localStorage entry alongside the other UI preferences. The `.dark` token block in `index.css` shipped with v0.1.0 but was never reachable; a tiny `useThemeEffect` hook in `src/lib/theme.ts` now toggles the class on `<html>` based on the resolved mode.

### Changed

- `runner.rs::ffmpeg_sidecar_path` now delegates to a generic `sidecar_path(prefix)` helper, mirrored by a new `pub ytdlp_sidecar_path` for the self-updater. Behavior identical for ffmpeg; pure refactor.

## [0.3.0] - 2026-05-10

Cross-cutting cleanup. CI/CD comes online (Windows + Ubuntu matrix +
license gate, plus a tag-triggered installer release), the
`pnpm version:set` helper replaces the three-manual-edit ritual,
`THIRD_PARTY_LICENSES.md` finally lives next to the NOTICE that
references it, and the Batch tab learns to expand a playlist URL into
its individual videos. Per-job log lines were already being emitted
Rust-side since v0.1.0 — the frontend now actually listens and shows
them. Two latent `fetch-binaries.{sh,ps1}` bugs surfaced once CI ran
the Linux side: a missing executable bit on the shell script and a
SHA-lookup that matched the local rename instead of the upstream asset
name (so Linux verified against the Python source row and rejected the
binary).

### Added

- `.github/workflows/ci.yml` runs on every push to `main` and every pull request. Two jobs: `check` (matrix: ubuntu-latest + windows-latest) executes the full local build pipeline — `pnpm install --frozen-lockfile`, `fetch-binaries.{sh,ps1}` for the yt-dlp + LGPL ffmpeg sidecars (UPX-compressed exactly as locally), `pnpm build` (TypeScript strict + Vite), `cargo check` and `cargo test --lib`. `licenses` (Ubuntu-only) runs `pnpm version:check` to assert the three manifests stay in lockstep, plus `cargo-deny check licenses` against `src-tauri/deny.toml`. The full `pnpm tauri build` is intentionally not run on every PR — that belongs to a release workflow.
- `src-tauri/deny.toml` defines the cargo-deny allow-list. Every distinct license string seen in the current 492-crate dependency graph maps to one of the listed permissive SPDX identifiers (Apache-2.0 / MIT / BSD-2/3-Clause / ISC / MPL-2.0 / Zlib / Unicode-3.0 / Unlicense / CC0-1.0 / MIT-0 / Apache-2.0 WITH LLVM-exception). The OR-licensed `LGPL-2.1-or-later` crates always offer MIT or Apache-2.0 as alternatives so cargo-deny picks the permissive side.
- `.github/workflows/release.yml` triggers on every `v*.*.*` tag pushed to the repo. Builds the Tauri installers on Windows + Ubuntu via `tauri-apps/tauri-action@v0`, asserts the tag matches `package.json#version` (and via `pnpm version:check` that the three manifests agree), and attaches `.msi` + `.exe` (Windows) and `.deb` + `.AppImage` (Linux) to a *draft* release named `YTBR <tag>`. The user reviews the draft and clicks Publish manually — keeps a hand-on-the-trigger model rather than auto-publishing. Replaces the manual `pnpm tauri build` + `gh release create --upload` ritual that v0.1.0 and v0.2.0 used.
- `scripts/version-sync.mjs` keeps the three places that hold the app version (`package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`) in lockstep. Run with no args to verify they match (`pnpm version:check`); pass a SemVer to bump all three together (`pnpm version:set 0.3.0`). Edits are regex-based so existing formatting is preserved verbatim, and the Cargo.toml regex is anchored to the `[package]` section so dependency `version = "..."` lines are never touched. Removes the three-explicit-Edit pattern that v0.1.0 and v0.2.0 cuts used.
- `THIRD_PARTY_LICENSES.md` is now committed at the repo root. NOTICE and README already pointed at it; the file finally exists. Generated by `pnpm licenses:gen` (`scripts/gen-licenses.mjs`) from `cargo metadata` + `pnpm licenses list --prod --json`. Lists 492 Rust crates and 13 npm packages with versions, licenses, and source URLs, plus a fixed block for the bundled sidecars (yt-dlp, LGPL ffmpeg) and the full GNU LGPL 2.1 text (sourced from the SPDX license-list-data repo and cached at `scripts/licenses/LGPL-2.1-or-later.txt`). Re-run before tagging a release.
- Per-job logs panel under each `JobCard`. The Rust runner has emitted `job-log-line` events since v0.1.0 (any line that doesn't match the `PROG|...` progress template), but the frontend never listened. `useJobsStore` now keeps a per-job ring buffer (cap 500 lines, dropped on `remove` / `hydrate` / `clearTerminal`), `tauri-events.ts` subscribes to `job-log-line` and writes through `appendLog`, and a collapsible `<details>` block shows the buffer with `stderr` lines tinted destructive. Selector subscribes per job so a noisy job doesn't re-render the whole queue. Hidden entirely until the first line arrives, so freshly-queued cards stay compact.
- Playlist support in the Batch tab. New `expand_playlist` Tauri command runs `yt-dlp --flat-playlist --dump-single-json` against an arbitrary URL and returns either the playlist's entry watch-URLs (with the playlist's title) or a single-element list for a non-playlist URL fed in by mistake. BatchView gets an "Add playlist…" button next to "Import .txt"; clicking opens an inline URL input, Expand fetches the entries and appends them to the textarea, and a small confirmation line shows the playlist title + number of URLs added. Single-video flow on the Download tab is unchanged — its `--no-playlist` is intentional until the Download tab grows a playlist mode of its own.

### Changed

- QueueView shows a pretty format label instead of the raw yt-dlp selector. `JobSpec` gains an optional `formatLabel` field (`format_label` Rust-side, defaults to `None` so v0.1.0 / v0.2.0 jobs persisted to memory still render). For preset clicks the label is the preset name (`"1080p"`, `"Best Audio"`); for direct format-row picks it is the bare format id (`"137"`) so users see the same id they clicked on rather than the expanded `137+bestaudio/best` selector that ships to yt-dlp; for Batch the active choice's label (`"yt-dlp default"` or a preset name). The actual selector is preserved as a tooltip on the label so the long form is one hover away when debugging.

### Removed

- Unused `@tauri-apps/plugin-dialog` JS dependency. The dialog flow runs entirely through the Rust plugin (`tauri-plugin-dialog` crate, registered in `lib.rs`) via the `pick_output_dir` Tauri command — the JS wrapper was never imported. Trims one transitive subtree from `node_modules` with no behavior change.

### Fixed

- `fetch-binaries.{sh,ps1}` Linux verify path: SHA2-256SUMS lists `yt-dlp` (Python source), `yt-dlp.exe` and `yt-dlp_linux` as separate rows, but the script looked up by the local rename name (`yt-dlp` on Linux), which silently picked the Python source row and rejected the actual binary. Match the upstream asset name from the URL instead, so Linux gets the `yt-dlp_linux` SHA. Latent bug — Windows happened to do the right thing because `yt-dlp.exe` is both the local name and the asset name. Surfaced once CI ran the Linux side.
- `fetch-binaries.{sh,ps1}` also pin the yt-dlp release tag once via the GitHub API and reuse it for both binary and SHA URLs. Robustness against the rare case where yt-dlp publishes a new release between the binary fetch and the SHA fetch (both `releases/latest/download/...` redirects would re-resolve to different tags). BtbN/FFmpeg-Builds uses a literal `latest` tag and never published per-asset `.sha256` siblings — its conditional verify path was already a silent no-op, so we leave that side alone.
- `scripts/fetch-binaries.sh` is now marked executable in the git index (`100755`). It was checked in from Windows where the +x bit doesn't exist as a concept, so git stored it as `100644` and the Linux runner refused to execute it (`Permission denied`, exit 126). On Windows the file mode bit is ignored anyway.

## [0.2.0] - 2026-05-10

Iteration 2: full Settings surface and the last spec-mandated queue
features. v0.1.0 settings keep working — zustand-persist merges new
fields onto defaults at hydration, no migration step required.

### Added

- Settings page (`src/features/settings/SettingsView.tsx`) with sections for output folder, parallel-download limit, cookies-from-browser, ffmpeg path override, yt-dlp output template, and default preset. All values persist via the existing `ytbr.settings.v1` localStorage key (zustand-persist merges new fields onto defaults at hydration, so the v0.1.0 install carries over without a migration). UI-only in this commit — only the output folder is wired into the download path; parallel limit, cookies, ffmpeg override, output template, and default preset land in subsequent iterations.
- Parallel-download limit is now live: the Settings slider (1..8, default 2) is pushed to a new `set_parallel_limit` Tauri command on mount and on each change. The Rust `QueueManager` adjusts the live tokio `Semaphore` — growing is instant via `add_permits`, shrinking absorbs excess permits in a background task using `permit.forget()` so in-flight jobs are not disturbed and new jobs see the new limit. `lib.rs::DEFAULT_PARALLEL_LIMIT` is now `2` to match the spec's default.
- Cookies-from-browser, ffmpeg-path override, and output-template Settings are now wired into the download path. Each enqueue snapshots the current Settings store and includes them in `JobSpec` (new fields `cookiesFromBrowser` and `ffmpegLocation`; `outputTemplate` already existed but wasn't being passed). The runner adds `--cookies-from-browser <browser>` when set, prefers an explicit ffmpeg path over the bundled sidecar, and uses the user's output template. Mid-flight Settings changes never disturb running jobs.
- Default preset is now visible: `PresetButtons` reads `useSettingsStore.defaultPreset` and renders a star badge plus a primary-tinted border on the matching tile. The button still requires a click — selection is a hint, not auto-apply, so a paste of the wrong URL never starts an unwanted download. Each preset gained a stable `id` (`audio-best` / `video-720` / `video-1080` / `video-4k`) so the Settings chips and the Download tiles agree.
- Per-format options as global defaults in Settings: `Write subtitles`, `Embed thumbnail`, `Embed metadata`, `Use download archive`. All four are stored alongside the existing settings, snapshot at enqueue, and propagated through `JobSpec`. The runner emits the matching yt-dlp flags (`--write-subs`, `--embed-thumbnail`, `--embed-metadata`, `--download-archive <path>`). The download archive lives at `<app config dir>/archive.txt` (so duplicates are deduplicated across sessions and across output folders), is created lazily, and is silently skipped if the config dir cannot be resolved. All four toggles default to off — a v0.1.0 install opts into them explicitly.
- New "Batch" tab between Download and Queue. Paste many URLs (one per line) or drop a `.txt` file via HTML5 drag-and-drop, pick a format choice (yt-dlp default = `bestvideo*+bestaudio/best`, or one of the Quick presets, initialized to the user's default preset), and press "Enqueue all". Each URL goes through `enqueueJob` with the full Settings snapshot — same cookies, ffmpeg path, output template, and per-format options as a single download. The view reports successes and per-URL failure reasons inline. `PRESETS` and a new `DEFAULT_BATCH_SELECTOR` are now exported from `PresetButtons.tsx` so Batch and Download share the format definitions.
- Queue view sortable: dropdown above the job list with five modes — Newest first (default, was the previous behavior), Oldest first, Status (`downloading` → `queued` → `failed` → `completed` → `cancelled`), Progress high→low, and Progress low→high. Sort is local to the view (no persistence yet) and uses insertion order from `useJobsStore.ids` as a deterministic created-at proxy and tie-breaker.
- Pause / Resume for running jobs. Each `JobCard` shows a Pause button while downloading and a Resume button while paused, alongside the existing Cancel button. New `JobStatus::Paused` (Rust + TS) plus matching status icon (amber `Pause`) and badge. Process control is implemented in a self-contained `process_pause` module: `kill(pid, SIGSTOP/SIGCONT)` on Linux, `OpenProcess(PROCESS_SUSPEND_RESUME)` + `NtSuspendProcess` / `NtResumeProcess` from ntdll on Windows. No external crates added — the FFI signatures are declared inline so the dependency tree stays untouched. Other platforms (macOS, BSD) compile to no-ops; the buttons are still rendered there but the OS-level call returns `false` and surfaces a clear error. Paused jobs continue to occupy a queue permit, so the parallel-limit semaphore behaves the same way as before. Sort order treats paused as second priority right after downloading.

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

[Unreleased]: https://github.com/lkasdorf/ytbr/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/lkasdorf/ytbr/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/lkasdorf/ytbr/releases/tag/v0.1.0
