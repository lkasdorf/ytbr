// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Leon Kasdorf

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tokio::sync::oneshot;

use crate::error::AppError;
use crate::queue::JobSpec;
use crate::ytdlp::progress;

// Build-script-injected target triple (see build.rs). Used to locate
// the `ffmpeg-<triple>{.exe}` sidecar at runtime so we can pass
// --ffmpeg-location to yt-dlp; without it yt-dlp can't mux the
// video-only + audio-only streams that YouTube serves above 360p.
const TARGET_TRIPLE: &str = env!("TARGET");

pub enum RunOutcome {
    Completed,
    Cancelled,
    Failed(String),
}

pub async fn run(
    app: &AppHandle,
    id: &str,
    spec: &JobSpec,
    cancel_rx: oneshot::Receiver<()>,
    pid_slot: Arc<Mutex<Option<u32>>>,
) -> Result<RunOutcome, AppError> {
    let output_template = spec
        .output_dir
        .join(&spec.output_template)
        .to_string_lossy()
        .into_owned();

    let mut args: Vec<String> = vec![
        "--newline".into(),
        "--no-color".into(),
        "--no-warnings".into(),
        "--no-playlist".into(), // TODO: support playlists in a future iteration
        "--progress".into(),
        "--progress-template".into(),
        progress::TEMPLATE.into(),
        "-o".into(),
        output_template,
    ];

    // ffmpeg location: explicit user override wins; otherwise fall
    // back to the bundled sidecar so video-only + audio-only YouTube
    // streams still mux correctly.
    let ffmpeg_path: Option<String> = spec
        .ffmpeg_location
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(String::from)
        .or_else(|| ffmpeg_sidecar_path().map(|p| p.to_string_lossy().into_owned()));
    if let Some(path) = ffmpeg_path {
        args.push("--ffmpeg-location".into());
        args.push(path);
    }

    if let Some(browser) = spec
        .cookies_from_browser
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        args.push("--cookies-from-browser".into());
        args.push(browser.to_string());
    }

    if spec.write_subs {
        args.push("--write-subs".into());
    }
    if spec.embed_thumbnail {
        args.push("--embed-thumbnail".into());
    }
    if spec.embed_metadata {
        args.push("--embed-metadata".into());
    }
    if spec.download_archive {
        if let Some(archive) = archive_file_path(app) {
            args.push("--download-archive".into());
            args.push(archive.to_string_lossy().into_owned());
        }
    }
    // Skip the flag entirely when 0 or 1 — yt-dlp's default is 1 and
    // passing it explicitly does nothing useful but adds noise to the
    // command line shown in logs.
    if let Some(n) = spec.concurrent_fragments {
        if n > 1 {
            args.push("--concurrent-fragments".into());
            args.push(n.to_string());
        }
    }
    // "default" carries no recode intent — only emit the flags when an
    // explicit codec is requested. The frontend takes care of only
    // sending this for audio-only downloads (see App.tsx).
    if let Some(fmt) = spec.audio_format.as_deref() {
        if !fmt.is_empty() && fmt != "default" {
            args.push("--extract-audio".into());
            args.push("--audio-format".into());
            args.push(fmt.to_string());
        }
    }

    // SponsorBlock. Skip the flag entirely on mode "off", missing mode,
    // or empty category list — yt-dlp rejects an empty value and a
    // mode-without-categories state is a UI bug we don't want to send.
    if let Some(mode) = spec
        .sponsorblock_mode
        .as_deref()
        .map(str::trim)
        .filter(|m| !m.is_empty() && *m != "off")
    {
        if let Some(cats) = spec.sponsorblock_categories.as_ref() {
            let joined = cats
                .iter()
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
                .collect::<Vec<_>>()
                .join(",");
            if !joined.is_empty() {
                let flag = match mode {
                    "mark" => "--sponsorblock-mark",
                    "remove" => "--sponsorblock-remove",
                    _ => "",
                };
                if !flag.is_empty() {
                    args.push(flag.into());
                    args.push(joined);
                }
            }
        }
    }

    if let Some(fmt) = &spec.format_id {
        args.push("-f".into());
        args.push(fmt.clone());
    }
    args.push(spec.url.clone());

    let (mut rx, child) = app
        .shell()
        .sidecar("yt-dlp")
        .map_err(|e| AppError::Sidecar(e.to_string()))?
        .args(args)
        .spawn()
        .map_err(|e| AppError::Sidecar(e.to_string()))?;

    // Publish the spawned pid so QueueManager::pause / resume can
    // signal the right OS process. Cleared at the end of the function
    // so a pause click on a freshly-finished job fails fast instead of
    // poking a recycled pid.
    *pid_slot.lock().unwrap() = Some(child.pid());

    let child: Arc<Mutex<Option<CommandChild>>> = Arc::new(Mutex::new(Some(child)));
    let was_cancelled = Arc::new(AtomicBool::new(false));

    // Cancel watcher: when the signal arrives, mark + kill the child.
    {
        let child = child.clone();
        let was_cancelled = was_cancelled.clone();
        tauri::async_runtime::spawn(async move {
            if cancel_rx.await.is_ok() {
                was_cancelled.store(true, Ordering::SeqCst);
                if let Some(c) = child.lock().unwrap().take() {
                    let _ = c.kill();
                }
            }
        });
    }

    // Drain the event stream until the process terminates. We track two
    // separate failure sources: `last_error` is a shell-level error from
    // the Tauri plugin (couldn't spawn, IO closed, ...) while
    // `last_stderr_error` is yt-dlp's own `ERROR: …` text on stderr.
    // The latter is far more actionable, so we prefer it on non-zero
    // exits and run it through `humanize_yt_dlp_error` to translate
    // common upstream messages into hints the user can act on.
    let mut last_error: Option<String> = None;
    let mut last_stderr_error: Option<String> = None;
    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(bytes) => {
                let line = trim_line(&bytes);
                if let Some(prog) = progress::parse(&line) {
                    let _ = app.emit("job-progress", ProgressPayload { id, progress: &prog });
                } else if !line.is_empty() {
                    emit_log(app, id, &line, "stdout");
                }
            }
            CommandEvent::Stderr(bytes) => {
                let line = trim_line(&bytes);
                if !line.is_empty() {
                    if line.starts_with("ERROR:") {
                        last_stderr_error = Some(line.clone());
                    }
                    emit_log(app, id, &line, "stderr");
                }
            }
            CommandEvent::Error(err) => {
                last_error = Some(err);
            }
            CommandEvent::Terminated(payload) => {
                if was_cancelled.load(Ordering::SeqCst) {
                    return Ok(RunOutcome::Cancelled);
                }
                return Ok(match payload.code {
                    Some(0) => RunOutcome::Completed,
                    Some(code) => {
                        let detail = last_stderr_error
                            .as_deref()
                            .map(humanize_yt_dlp_error)
                            .or_else(|| last_error.clone())
                            .unwrap_or_else(|| format!("yt-dlp exited with code {code}"));
                        RunOutcome::Failed(detail)
                    }
                    None => RunOutcome::Failed(
                        last_stderr_error
                            .as_deref()
                            .map(humanize_yt_dlp_error)
                            .or(last_error)
                            .unwrap_or_else(|| "yt-dlp terminated without exit code".into()),
                    ),
                });
            }
            _ => {}
        }
    }

    if was_cancelled.load(Ordering::SeqCst) {
        Ok(RunOutcome::Cancelled)
    } else {
        Ok(RunOutcome::Failed(
            last_stderr_error
                .as_deref()
                .map(humanize_yt_dlp_error)
                .or(last_error)
                .unwrap_or_else(|| "yt-dlp event stream closed unexpectedly".into()),
        ))
    }
}

// Translate yt-dlp's `ERROR: …` stderr lines into actionable text where
// we recognize the pattern. The raw line is still emitted to the logs
// panel, so the upstream issue link / wording is preserved for users
// who need it.
fn humanize_yt_dlp_error(raw: &str) -> String {
    let trimmed = raw.trim_start_matches("ERROR:").trim();

    // yt-dlp issue #7271: "Could not copy <Browser> cookie database"
    // fires when the browser holds an exclusive lock on the cookie
    // store (Chrome/Edge while running, Firefox during sqlite WAL,
    // ...) or — on Chrome ≥127 — when App-Bound Encryption blocks
    // decryption from a non-browser process. Both cases share the
    // same user-side fix.
    if let Some(rest) = trimmed.strip_prefix("Could not copy ") {
        if let Some(end) = rest.find(" cookie database") {
            let browser = &rest[..end];
            return format!(
                "{browser} cookie database is locked — yt-dlp can't read it while {browser} is running. \
                 Close {browser} and retry, or set 'Cookies from browser' to 'none' in Settings."
            );
        }
    }

    // "Postprocessing: ffprobe not found" fires when yt-dlp can't
    // locate ffprobe next to the ffmpeg sidecar — i.e. the install
    // is incomplete. The bundled ffprobe shipped alongside ffmpeg
    // covers this on a normal install, so the actionable fix for
    // the user is to reinstall (or run `scripts/fetch-binaries`
    // in dev) so the binary is staged.
    if trimmed.starts_with("Postprocessing: ffprobe not found")
        || trimmed.starts_with("ffprobe/avprobe not found")
    {
        return "ffprobe is missing from this install — yt-dlp needs it to mux video+audio or \
                extract audio. Reinstall YTBR (or rerun scripts/fetch-binaries in dev) so the \
                bundled ffprobe ships next to ffmpeg."
            .to_string();
    }

    trimmed.to_string()
}

fn trim_line(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).trim().to_string()
}

// Centralized download-archive path under the OS app-config dir.
// Shared across every output folder so duplicates are deduplicated
// across sessions even when the user changes output dirs. Silently
// returns `None` if the config dir can't be created — the runner just
// drops the `--download-archive` flag and yt-dlp behaves as before.
fn archive_file_path(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_config_dir().ok()?;
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir.join("archive.txt"))
}

// In bundled installs the sidecar lives next to the main exe with the
// triple-suffixed name. In `tauri dev` runs the binary lives in
// target/debug/, while the sidecar files stay in src-tauri/binaries/;
// walk back up a few levels to find them.
fn sidecar_path(prefix: &str) -> Option<PathBuf> {
    let suffix = if cfg!(windows) { ".exe" } else { "" };
    // Two candidate filenames cover both layouts:
    //  - bundled install (Tauri MSI/NSIS/DEB/AppImage): the bundler
    //    drops the target-triple suffix, so the file lands as
    //    `<prefix>{.exe}` next to the main exe — same name the
    //    plugin-shell runtime resolver looks for at spawn time.
    //  - dev / `tauri dev` runs: the source files in
    //    `src-tauri/binaries/` keep their target-triple suffix
    //    (`<prefix>-<TARGET>{.exe}`) because the build looks them up
    //    that way.
    let bare = format!("{prefix}{suffix}");
    let triple = format!("{prefix}-{TARGET_TRIPLE}{suffix}");

    let exe = std::env::current_exe().ok()?;
    let exe_dir = exe.parent()?.to_path_buf();

    for name in [&bare, &triple] {
        let candidate = exe_dir.join(name);
        if candidate.exists() {
            return Some(candidate);
        }
    }

    let mut cursor = exe_dir;
    for _ in 0..6 {
        for name in [&bare, &triple] {
            let candidate = cursor.join("src-tauri").join("binaries").join(name);
            if candidate.exists() {
                return Some(candidate);
            }
        }
        if !cursor.pop() {
            break;
        }
    }
    None
}

fn ffmpeg_sidecar_path() -> Option<PathBuf> {
    sidecar_path("ffmpeg")
}

/// Same resolution rules as the ffmpeg sidecar — exposed for the yt-dlp
/// self-updater (`commands::updater`) which needs to overwrite the
/// binary in place rather than just spawn it.
pub fn ytdlp_sidecar_path() -> Option<PathBuf> {
    sidecar_path("yt-dlp")
}

#[derive(Serialize, Clone)]
struct ProgressPayload<'a> {
    id: &'a str,
    #[serde(flatten)]
    progress: &'a progress::JobProgress,
}

fn emit_log(app: &AppHandle, id: &str, line: &str, stream: &str) {
    #[derive(Serialize, Clone)]
    struct LogPayload<'a> {
        id: &'a str,
        line: &'a str,
        stream: &'a str,
    }
    let _ = app.emit("job-log-line", LogPayload { id, line, stream });
}

#[cfg(test)]
mod tests {
    use super::humanize_yt_dlp_error;

    #[test]
    fn humanizes_chrome_cookie_lock() {
        let raw = "ERROR: Could not copy Chrome cookie database. \
                   See https://github.com/yt-dlp/yt-dlp/issues/7271 for more info";
        let msg = humanize_yt_dlp_error(raw);
        assert!(msg.contains("Chrome cookie database is locked"));
        assert!(msg.contains("Close Chrome"));
        assert!(msg.contains("'Cookies from browser' to 'none'"));
    }

    #[test]
    fn humanizes_other_browsers() {
        let msg = humanize_yt_dlp_error("ERROR: Could not copy Firefox cookie database");
        assert!(msg.contains("Firefox cookie database is locked"));
        assert!(msg.contains("Close Firefox"));
    }

    #[test]
    fn unknown_errors_pass_through_without_prefix() {
        let msg = humanize_yt_dlp_error("ERROR: Unsupported URL: about:blank");
        assert_eq!(msg, "Unsupported URL: about:blank");
    }

    #[test]
    fn humanizes_ffprobe_missing() {
        let raw = "ERROR: Postprocessing: ffprobe not found. \
                   Please install or provide the path using --ffmpeg-location";
        let msg = humanize_yt_dlp_error(raw);
        assert!(msg.contains("ffprobe is missing"));
        assert!(msg.contains("Reinstall YTBR"));
    }
}
