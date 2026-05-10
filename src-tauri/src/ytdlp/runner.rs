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

    // Drain the event stream until the process terminates.
    let mut last_error: Option<String> = None;
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
                        let detail = last_error
                            .clone()
                            .unwrap_or_else(|| format!("yt-dlp exited with code {code}"));
                        RunOutcome::Failed(detail)
                    }
                    None => RunOutcome::Failed(
                        last_error.unwrap_or_else(|| "yt-dlp terminated without exit code".into()),
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
            last_error.unwrap_or_else(|| "yt-dlp event stream closed unexpectedly".into()),
        ))
    }
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
    let name = format!("{prefix}-{TARGET_TRIPLE}{suffix}");

    let exe = std::env::current_exe().ok()?;
    let exe_dir = exe.parent()?.to_path_buf();

    let next_to_exe = exe_dir.join(&name);
    if next_to_exe.exists() {
        return Some(next_to_exe);
    }

    let mut cursor = exe_dir;
    for _ in 0..6 {
        let candidate = cursor.join("src-tauri").join("binaries").join(&name);
        if candidate.exists() {
            return Some(candidate);
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
