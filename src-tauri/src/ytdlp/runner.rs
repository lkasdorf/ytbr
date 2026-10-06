// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Leon Kasdorf

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::process::{Command, CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tokio::sync::oneshot;

use crate::error::AppError;
use crate::queue::JobSpec;
use crate::ytdlp::{env_path, process_tree, progress};

// Build-script-injected target triple (see build.rs). Used to locate
// the `ffmpeg-<triple>{.exe}` sidecar at runtime so we can pass
// --ffmpeg-location to yt-dlp; without it yt-dlp can't mux the
// video-only + audio-only streams that YouTube serves above 360p.
const TARGET_TRIPLE: &str = env!("TARGET");

/// Clears the job's published pid on every exit path of `run`, so a
/// pause click between process exit and the queue's final status
/// transition can't signal a pid the OS may already have recycled.
struct PidSlotGuard(Arc<Mutex<Option<u32>>>);

impl Drop for PidSlotGuard {
    fn drop(&mut self) {
        *self.0.lock().unwrap() = None;
    }
}

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
        // No --no-warnings: yt-dlp's warnings (e.g. "n challenge
        // solving failed") are the only clue for several failures and
        // belong in the job's log panel.
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

    args.extend(access_args(&AccessOptions {
        cookies_file: spec.cookies_file.as_deref(),
        cookies_from_browser: spec.cookies_from_browser.as_deref(),
        proxy: spec.proxy.as_deref(),
        extractor_args: spec.extractor_args.as_deref(),
    }));

    if spec.write_subs {
        args.push("--write-subs".into());
        if spec.write_auto_subs {
            args.push("--write-auto-subs".into());
        }
        if spec.embed_subs {
            args.push("--embed-subs".into());
        }
        if let Some(langs) = spec
            .sub_langs
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            args.push("--sub-langs".into());
            args.push(langs.to_string());
        }
    }
    if spec.embed_thumbnail {
        args.push("--embed-thumbnail".into());
    }
    // Center-crop the cover to a square (YouTube thumbnails are 16:9,
    // audio/audiobook players show square art). Needs an explicit
    // --convert-thumbnails so the ThumbnailsConvertor PP runs and picks
    // up the ffmpeg output args; also applies to the sidecar if written.
    if spec.square_thumbnail && (spec.embed_thumbnail || spec.write_thumbnail) {
        args.push("--convert-thumbnails".into());
        args.push("jpg".into());
        args.push("--ppa".into());
        args.push(
            "ThumbnailsConvertor+ffmpeg_o:-c:v mjpeg -vf crop=\"'min(iw,ih)':'min(iw,ih)'\""
                .into(),
        );
    }
    if spec.embed_metadata {
        args.push("--embed-metadata".into());
    }
    if spec.write_thumbnail {
        args.push("--write-thumbnail".into());
    }
    if spec.write_info_json {
        args.push("--write-info-json".into());
    }
    if spec.download_archive {
        if let Some(archive) = archive_file_path(app) {
            args.push("--download-archive".into());
            args.push(archive.to_string_lossy().into_owned());
        }
    }
    if spec.restrict_filenames {
        args.push("--restrict-filenames".into());
    }
    if let Some(rate) = spec
        .rate_limit
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        args.push("--limit-rate".into());
        args.push(rate.to_string());
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
    // Same skip-at-default rule for retries: yt-dlp's default is 10 for
    // both, so when the slider sits at 10 we don't emit anything.
    if let Some(n) = spec.retries {
        if n != 10 {
            args.push("--retries".into());
            args.push(n.to_string());
        }
    }
    if let Some(n) = spec.fragment_retries {
        if n != 10 {
            args.push("--fragment-retries".into());
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
    // `--` ends option parsing: a "URL" starting with '-' (from a
    // dropped .txt or a remote playlist entry) must never be read as a
    // yt-dlp option such as `--exec`.
    args.push("--".into());
    args.push(spec.url.clone());

    let (mut rx, child) = ytdlp_command(app)
        .map_err(AppError::Sidecar)?
        .args(args)
        .spawn()
        .map_err(|e| AppError::Sidecar(e.to_string()))?;

    // Publish the spawned pid so QueueManager::pause / resume can
    // signal the right OS process. Cleared at the end of the function
    // so a pause click on a freshly-finished job fails fast instead of
    // poking a recycled pid.
    let pid = child.pid();
    *pid_slot.lock().unwrap() = Some(pid);
    let _pid_guard = PidSlotGuard(pid_slot);

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
                    // The spawned pid is only the PyInstaller bootloader;
                    // the worker (and any ffmpeg) are its descendants and
                    // would survive killing it alone.
                    process_tree::kill_descendants(pid);
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
    // Set when yt-dlp reports it couldn't solve YouTube's JS challenge,
    // which usually turns into "Requested format is not available".
    let mut js_challenge_failed = false;
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
                    } else if line.contains("n challenge solving failed")
                        || line.contains("Only images are available")
                    {
                        js_challenge_failed = true;
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
                            .map(|raw| explain_failure(raw, js_challenge_failed))
                            .or_else(|| last_error.clone())
                            .unwrap_or_else(|| format!("yt-dlp exited with code {code}"));
                        RunOutcome::Failed(detail)
                    }
                    None => RunOutcome::Failed(
                        last_stderr_error
                            .as_deref()
                            .map(|raw| explain_failure(raw, js_challenge_failed))
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
                .map(|raw| explain_failure(raw, js_challenge_failed))
                .or(last_error)
                .unwrap_or_else(|| "yt-dlp event stream closed unexpectedly".into()),
        ))
    }
}

/// Settings that decide whether yt-dlp can reach a URL at all: login
/// (cookies), network route (proxy) and extractor workarounds. Shared by
/// the download runner and the probe / playlist commands, which used to
/// skip them — so probing anything behind a login failed even with
/// cookies configured.
#[derive(Default)]
pub struct AccessOptions<'a> {
    pub cookies_file: Option<&'a str>,
    pub cookies_from_browser: Option<&'a str>,
    pub proxy: Option<&'a str>,
    /// Whitespace-separated; each entry becomes one --extractor-args.
    pub extractor_args: Option<&'a str>,
}

pub fn access_args(o: &AccessOptions) -> Vec<String> {
    let set = |v: Option<&str>| v.map(str::trim).filter(|s| !s.is_empty()).map(String::from);
    let mut args = Vec::new();
    // Cookie sources are mutually exclusive in yt-dlp. Prefer the
    // explicit file path when both happen to be set — the UI enforces
    // single-source via the settings store setters, but a stale spec
    // serialized from an older version could still carry both.
    if let Some(path) = set(o.cookies_file) {
        args.extend(["--cookies".to_string(), path]);
    } else if let Some(browser) = set(o.cookies_from_browser) {
        args.extend(["--cookies-from-browser".to_string(), browser]);
    }
    if let Some(proxy) = set(o.proxy) {
        args.extend(["--proxy".to_string(), proxy]);
    }
    for value in o.extractor_args.unwrap_or_default().split_whitespace() {
        args.extend(["--extractor-args".to_string(), value.to_string()]);
    }
    args
}

// `humanize_yt_dlp_error` plus run-level context: when yt-dlp warned that
// it couldn't solve YouTube's JavaScript challenge, the final error is
// usually a misleading "Requested format is not available".
fn explain_failure(raw: &str, js_challenge_failed: bool) -> String {
    let msg = humanize_yt_dlp_error(raw);
    if js_challenge_failed {
        format!(
            "{msg} — yt-dlp couldn't solve YouTube's JavaScript challenge because no JS runtime \
             was found. Install deno (`winget install DenoLand.Deno`), restart YTBR, then retry."
        )
    } else {
        msg
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

    // yt-dlp issue #10927: Chrome/Edge ≥127 protect their cookie store
    // with App-Bound Encryption, which DPAPI from another process can't
    // decrypt. Closing the browser doesn't help here — only a different
    // cookie source does.
    if trimmed.starts_with("Failed to decrypt with DPAPI") {
        return "Can't read this browser's cookies — Chrome and Edge encrypt them so other apps                 can't decrypt them (yt-dlp issue #10927). Use 'Cookies file' (cookies.txt                 exported from a private window) or 'Cookies from browser' = Firefox in Settings."
            .to_string();
    }

    // yt-dlp issue #17389: with cookies, some accounts get downgraded to
    // the "tv_downgraded" player client, whose response is UNPLAYABLE.
    // For music.youtube.com URLs the web_music client still works.
    if trimmed.contains("The page needs to be reloaded") {
        return format!(
            "{trimmed} — known yt-dlp issue with cookies on some accounts (yt-dlp #17389). \
             Workaround: set 'Extractor args' in Settings to youtube:player_client=web_music \
             (music.youtube.com URLs), then retry."
        );
    }

    // Account-gated content: YouTube Music Premium tracks, members-only
    // videos, age gates and the bot check ("Sign in to confirm you're
    // not a bot") all need a logged-in session, i.e. cookies.
    if trimmed.contains("only available to Music Premium members")
        || trimmed.contains("Sign in to confirm")
        || trimmed.contains("members-only content")
    {
        return format!(
            "{trimmed} — yt-dlp needs your logged-in YouTube session. Set 'Cookies file'              (cookies.txt exported from a private window) or 'Cookies from browser'              (Firefox works best) in Settings, then retry."
        );
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

/// Where the in-app updater drops a newer yt-dlp. Lives in the per-user
/// local data dir because a per-machine install (MSI / NSIS into
/// `C:\Program Files\YTBR`) isn't writable without elevation, so the
/// bundled sidecar can't be overwritten in place.
pub fn user_ytdlp_path(app: &AppHandle) -> Option<PathBuf> {
    let suffix = if cfg!(windows) { ".exe" } else { "" };
    let dir = app.path().app_local_data_dir().ok()?;
    Some(dir.join("bin").join(format!("yt-dlp{suffix}")))
}

/// Every yt-dlp spawn goes through here: the user-updated copy wins when
/// present, otherwise the bundled sidecar. Rust-side `Shell::command` is
/// not subject to the capability scope, so no extra allow-list entry is
/// needed for the user copy.
pub fn ytdlp_command(app: &AppHandle) -> Result<Command, String> {
    let cmd = match user_ytdlp_path(app).filter(|p| p.is_file()) {
        Some(path) => app.shell().command(path),
        None => app.shell().sidecar("yt-dlp").map_err(|e| e.to_string())?,
    };
    // Re-read PATH so yt-dlp finds the JS runtime (deno) even when YTBR
    // was relaunched by its updater with a stale environment.
    Ok(match env_path::for_child() {
        Some(path) => cmd.env("PATH", path),
        None => cmd,
    })
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
    use super::{access_args, explain_failure, humanize_yt_dlp_error, AccessOptions};

    #[test]
    fn access_args_prefer_cookie_file_and_skip_blanks() {
        let args = access_args(&AccessOptions {
            cookies_file: Some(" C:\\c.txt "),
            cookies_from_browser: Some("firefox"),
            proxy: Some("  "),
            extractor_args: Some("youtube:player_client=web_music  vimeo:client=web"),
        });
        assert_eq!(
            args,
            [
                "--cookies",
                "C:\\c.txt",
                "--extractor-args",
                "youtube:player_client=web_music",
                "--extractor-args",
                "vimeo:client=web",
            ]
        );
        assert!(access_args(&AccessOptions::default()).is_empty());
    }

    #[test]
    fn explains_missing_js_runtime() {
        let raw = "ERROR: [youtube] 8W7ih9-bj7M: Requested format is not available. Use --list-formats for a list of available formats";
        assert!(explain_failure(raw, true).contains("no JS runtime"));
        assert!(!explain_failure(raw, false).contains("JS runtime"));
    }

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
    fn hints_extractor_args_for_page_reload() {
        let msg = humanize_yt_dlp_error(
            "ERROR: [youtube] CYvxaXV86QA: The page needs to be reloaded.",
        );
        assert!(msg.starts_with("[youtube] CYvxaXV86QA"));
        assert!(msg.contains("youtube:player_client=web_music"));
    }

    #[test]
    fn humanizes_dpapi_failure() {
        let msg = humanize_yt_dlp_error(
            "ERROR: Failed to decrypt with DPAPI. See  https://github.com/yt-dlp/yt-dlp/issues/10927  for more info",
        );
        assert!(msg.contains("Cookies file"));
        assert!(msg.contains("Firefox"));
    }

    #[test]
    fn hints_cookies_for_premium_only() {
        let msg = humanize_yt_dlp_error(
            "ERROR: [youtube] qKO1zbp_e_s: This video is only available to Music Premium members",
        );
        assert!(msg.starts_with("[youtube] qKO1zbp_e_s"));
        assert!(msg.contains("Cookies file"));
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
