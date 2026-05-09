---
name: YTBR backlog and project state
description: Where YTBR stands (Iter 1 done, paused) and what the user explicitly flagged for later iterations
type: project
originSessionId: 502ddcb8-7650-4162-bf85-bdb846566cf8
---
**Status as of 2026-05-10:** Iter 1 from the prompt spec is feature-complete and pushed. Project is paused at the user's request (last input: "Erstmal Pause — Status prüfen, später weiter").

Repo: https://github.com/lkasdorf/ytbr (public, main branch). Latest commit at pause: `8d04575 docs: add CLAUDE.md`.

**Why:** the prompt mandates checkpointing after each step. The user accepted Iter 1 as complete and wants to inspect before continuing.

**How to apply:** before resuming, verify the latest git log, ensure `pnpm install` and `./scripts/fetch-binaries.ps1` have been run (binaries dir is gitignored), and re-check this list — items move between iterations as priorities shift.

---

**Iter 1 — done**
- URL probe via `yt-dlp -J`, sortable + filterable format table
- Quick presets (Best Audio / 720p / 1080p / 4K with fallback chains)
- Output dir picker (persistent via zustand persist + localStorage)
- Live download with progress bar, speed (B/s), ETA, byte counter
- Cancel via oneshot signal + `child.kill()`
- ffmpeg muxing wired (`--ffmpeg-location` derived from sidecar path via `build.rs`-injected TARGET)
- Auto-append `+bestaudio/best` for video-only format-row picks (single explicit fmt id leaves files silent otherwise)

**Iter 2 — not started, prompt scope**
- Settings page: default profile, cookies-from-browser, ffmpeg path override, default output template
- Pause/Resume: Linux SIGSTOP/SIGCONT, Windows `NtSuspendProcess` via `ntapi` crate
- Configurable parallel limit (default 2 per spec; currently hardcoded to 1 in `lib.rs::PARALLEL_LIMIT`)
- Batch URL input: textarea + drop a `.txt` with one URL per line
- Per-format options on enqueue: `--write-subs`, `--embed-thumbnail`, `--embed-metadata`, `--download-archive`
- Queue view sorting (status / created-at / progress)

**Iter 3 — not started, prompt scope**
- Auto-update via `tauri-plugin-updater`
- yt-dlp self-update (swap sidecar against latest GitHub release with hash check)
- Theme switcher (System/Light/Dark)
- Native notifications on job end / failure
- "Open in Folder" per job
- Clipboard watcher for URL detection
- About dialog (versions of app / yt-dlp / ffmpeg, link to THIRD_PARTY_LICENSES.md)

**Cross-cutting open work**
- **ffmpeg slimming** — bundled LGPL build is 164 MB, blows the prompt's `<80 MB` installer goal. Investigate BtbN essentials build or custom-compile without unused codecs. (Cross-link: see `ytbr_perf_constraints.md`.)
- **Playlist support** — user explicitly said "Playlists sollen auch möglich sein (evtl. später)" (2026-05-10). Currently `--no-playlist` is hardcoded in both `commands/probe.rs` and `ytdlp/runner.rs`. `VideoInfo` deserializer doesn't model playlist `entries[]`. TODO comments left in both files.
- **Logs panel per job** — Iter-1 prompt requirement; deferred. `job-log-line` events are already emitted Rust-side; only the collapsible panel in `QueueView` is missing.
- **THIRD_PARTY_LICENSES.md generator** — Iter-1 prompt requirement (Schritt 9). `cargo about` + `license-checker-rseidelsohn` + manual yt-dlp/ffmpeg block. Currently README references the file but it doesn't exist.
- **CI/CD** — GitHub Actions matrix (Win + Ubuntu), `cargo deny check licenses`, npm license check, build artifacts. Spec ready in prompt's "Build und Distribution" + "CI-Compliance-Gate" sections.
- **Cleanup**: `@tauri-apps/plugin-dialog` JS dep is installed but never imported (we only call the Rust dialog plugin via the `pick_output_dir` command). Safe to remove.
- **Pretty job display**: `JobCard` shows the expanded `137+bestaudio/best` selector. Could split `JobSpec.formatId` into `requestedFormat` (display) + `actualSelector` (yt-dlp arg) for nicer UX.

**Constraints honored throughout**
- Apache-2.0, no GPL deps, ffmpeg LGPL only (replaceable sidecar satisfies Section 6)
- No platform branding/marks in UI or icons
- SPDX header in every source file
- Conventional Commits with Co-Authored-By Claude trailer when authored by Claude
