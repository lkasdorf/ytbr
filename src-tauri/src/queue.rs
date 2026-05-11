// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Leon Kasdorf

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::sync::{oneshot, Semaphore};

use crate::error::AppError;
use crate::ytdlp::progress::JobProgress;
use crate::ytdlp::runner::{self, RunOutcome};

pub type JobId = String;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum JobStatus {
    Queued,
    Downloading,
    Paused,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobSpec {
    pub url: String,
    /// yt-dlp `-f` argument. May be a single format id ("140"), a
    /// composite selector ("137+bestaudio/best") or a full preset
    /// expression. Despite the name, callers should treat this as
    /// the raw selector — the human-friendly label is `format_label`.
    pub format_id: Option<String>,
    /// Pretty label for the queue UI. `None` means "fall back to
    /// `format_id` or 'default'". Set by the frontend so JobCard can
    /// show "1080p" instead of the long selector that ships to yt-dlp.
    #[serde(default)]
    pub format_label: Option<String>,
    pub output_dir: PathBuf,
    #[serde(default = "default_template")]
    pub output_template: String,
    /// yt-dlp `--cookies-from-browser` value (e.g. "chrome", "firefox").
    /// `None` means no cookies are read.
    #[serde(default)]
    pub cookies_from_browser: Option<String>,
    /// User-supplied path that overrides the bundled ffmpeg sidecar.
    /// `None` falls back to `ffmpeg_sidecar_path()` in the runner.
    #[serde(default)]
    pub ffmpeg_location: Option<String>,
    /// Per-format options. yt-dlp `--write-subs` / `--embed-thumbnail`
    /// / `--embed-metadata` / `--download-archive`. Defaults are all
    /// off so a v0.1.0 install picks no behavior change up.
    #[serde(default)]
    pub write_subs: bool,
    /// yt-dlp `--sub-langs`. `None` or empty makes the runner skip the
    /// flag entirely (yt-dlp falls back to "all", which is rarely what
    /// the user wants — the frontend sends "en" by default).
    #[serde(default)]
    pub sub_langs: Option<String>,
    /// yt-dlp `--write-auto-subs`. Only meaningful with `write_subs`;
    /// the runner gates emission on both flags being on.
    #[serde(default)]
    pub write_auto_subs: bool,
    /// yt-dlp `--embed-subs`. Bakes subtitles into the container
    /// alongside the sidecar file. Only meaningful with `write_subs`.
    #[serde(default)]
    pub embed_subs: bool,
    #[serde(default)]
    pub embed_thumbnail: bool,
    #[serde(default)]
    pub embed_metadata: bool,
    /// yt-dlp `--write-thumbnail`. Sidecar image next to the video.
    /// Independent of `embed_thumbnail` (which bakes into container).
    #[serde(default)]
    pub write_thumbnail: bool,
    /// yt-dlp `--write-info-json`. Sidecar metadata JSON.
    #[serde(default)]
    pub write_info_json: bool,
    #[serde(default)]
    pub download_archive: bool,
    /// yt-dlp `--restrict-filenames`. Strips Unicode/specials so the
    /// filename is safe across SMB, FAT32, and most foreign filesystems.
    #[serde(default)]
    pub restrict_filenames: bool,
    /// yt-dlp `--limit-rate` value. `None` or empty skips. The frontend
    /// trusts the user-typed string verbatim — yt-dlp rejects malformed
    /// input via its own error path which we surface in the runner.
    #[serde(default)]
    pub rate_limit: Option<String>,
    /// yt-dlp `--proxy` URL (http://, https://, socks4://, socks5://).
    /// `None` or empty skips.
    #[serde(default)]
    pub proxy: Option<String>,
    /// yt-dlp `--concurrent-fragments N`. `None` or `Some(1)` keeps
    /// yt-dlp's default single-fragment behavior. Range 1–8 enforced
    /// by the frontend slider.
    #[serde(default)]
    pub concurrent_fragments: Option<u8>,
    /// yt-dlp `--retries N`. `None` or `Some(10)` (yt-dlp default)
    /// makes the runner skip the flag so the command line stays clean
    /// when the user hasn't moved the slider.
    #[serde(default)]
    pub retries: Option<u8>,
    /// yt-dlp `--fragment-retries N`. Same skip rule as `retries`.
    #[serde(default)]
    pub fragment_retries: Option<u8>,
    /// yt-dlp `--audio-format`. When `Some` and not "default", the
    /// runner additionally emits `--extract-audio`. The frontend only
    /// sets this for audio-only downloads — applying to a video
    /// selector would strip the video track.
    #[serde(default)]
    pub audio_format: Option<String>,
    /// SponsorBlock mode. `None` or "off" emits nothing. "mark" → yt-dlp
    /// `--sponsorblock-mark`; "remove" → `--sponsorblock-remove`.
    /// Categories list below is comma-joined and passed as the flag value.
    #[serde(default)]
    pub sponsorblock_mode: Option<String>,
    /// SponsorBlock category ids the frontend selected (e.g. "sponsor",
    /// "intro", "music_offtopic"). Joined with commas for the yt-dlp
    /// flag. Empty or `None` means "skip the flag entirely" even if the
    /// mode is set — protects against an "enabled with no categories"
    /// state that would pass an empty value yt-dlp rejects.
    #[serde(default)]
    pub sponsorblock_categories: Option<Vec<String>>,
}

fn default_template() -> String {
    "%(title)s.%(ext)s".to_string()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobState {
    pub id: JobId,
    pub spec: JobSpec,
    pub status: JobStatus,
    pub progress: Option<JobProgress>,
    pub error: Option<String>,
}

struct JobEntry {
    state: JobState,
    cancel_tx: Option<oneshot::Sender<()>>,
    /// OS pid of the spawned yt-dlp child, set by the runner once the
    /// process actually starts. `None` means "not running yet" — pause
    /// is rejected in that window. Wrapped in an Arc so the runner
    /// task can write to it independently of `jobs` lock contention.
    pid: Arc<Mutex<Option<u32>>>,
}

pub struct QueueManager {
    inner: Arc<QueueInner>,
}

struct QueueInner {
    jobs: Mutex<HashMap<JobId, JobEntry>>,
    semaphore: Arc<Semaphore>,
    /// Current target permit count. Source of truth alongside the
    /// semaphore — guarded together so concurrent set_parallel_limit
    /// calls don't compute a wrong delta.
    limit: Mutex<usize>,
}

/// Hard upper bound for parallel downloads. Mirrors `MAX_PARALLEL_LIMIT`
/// in `src/stores/settings.ts`. Bump both together if the UI slider
/// grows past 8.
pub const MAX_PARALLEL_LIMIT: usize = 8;

fn clamp_limit(n: usize) -> usize {
    n.clamp(1, MAX_PARALLEL_LIMIT)
}

impl QueueManager {
    pub fn new(parallel_limit: usize) -> Self {
        let limit = clamp_limit(parallel_limit);
        Self {
            inner: Arc::new(QueueInner {
                jobs: Mutex::new(HashMap::new()),
                semaphore: Arc::new(Semaphore::new(limit)),
                limit: Mutex::new(limit),
            }),
        }
    }

    /// Adjust the parallel-download limit at runtime.
    ///
    /// Growing is instant: extra permits are released onto the
    /// semaphore and any queued jobs unblock immediately.
    ///
    /// Shrinking has to wait for currently-running jobs to drop their
    /// permits, so it's done in a background task that absorbs
    /// `old - new` permits via `permit.forget()`. While the task
    /// runs the effective limit transitions smoothly: new jobs see
    /// the new limit (because the absorbed permits never return to
    /// the pool) without disturbing in-flight downloads.
    ///
    /// Returns the clamped, accepted limit.
    pub fn set_parallel_limit(&self, requested: usize) -> usize {
        let new_limit = clamp_limit(requested);
        let mut current = self.inner.limit.lock().unwrap();
        let old_limit = *current;

        if new_limit == old_limit {
            return new_limit;
        }

        if new_limit > old_limit {
            self.inner.semaphore.add_permits(new_limit - old_limit);
        } else {
            let to_absorb = old_limit - new_limit;
            let semaphore = self.inner.semaphore.clone();
            tauri::async_runtime::spawn(async move {
                for _ in 0..to_absorb {
                    match semaphore.acquire().await {
                        Ok(permit) => permit.forget(),
                        Err(_) => break, // semaphore closed (shutdown)
                    }
                }
            });
        }

        *current = new_limit;
        new_limit
    }

    pub fn enqueue(&self, app: AppHandle, spec: JobSpec) -> Result<JobId, AppError> {
        if spec.url.trim().is_empty() {
            return Err(AppError::InvalidInput("url is empty".into()));
        }
        if spec.output_dir.as_os_str().is_empty() {
            return Err(AppError::InvalidInput("output_dir is empty".into()));
        }
        if !spec.output_dir.is_dir() {
            return Err(AppError::InvalidInput(format!(
                "output_dir does not exist: {}",
                spec.output_dir.display()
            )));
        }

        let id: JobId = uuid::Uuid::new_v4().to_string();
        let state = JobState {
            id: id.clone(),
            spec: spec.clone(),
            status: JobStatus::Queued,
            progress: None,
            error: None,
        };

        let (cancel_tx, cancel_rx) = oneshot::channel::<()>();
        let pid = Arc::new(Mutex::new(None::<u32>));
        {
            let mut jobs = self.inner.jobs.lock().unwrap();
            jobs.insert(
                id.clone(),
                JobEntry {
                    state: state.clone(),
                    cancel_tx: Some(cancel_tx),
                    pid: pid.clone(),
                },
            );
        }
        emit_status(&app, &id, JobStatus::Queued, None);

        let inner = self.inner.clone();
        let task_id = id.clone();
        let pid_for_runner = pid.clone();
        tauri::async_runtime::spawn(async move {
            let permit = match inner.semaphore.clone().acquire_owned().await {
                Ok(p) => p,
                Err(_) => return, // semaphore closed (shutdown)
            };

            inner.transition(&app, &task_id, JobStatus::Downloading, None);

            let outcome =
                runner::run(&app, &task_id, &spec, cancel_rx, pid_for_runner).await;

            match outcome {
                Ok(RunOutcome::Completed) => {
                    inner.transition(&app, &task_id, JobStatus::Completed, None);
                }
                Ok(RunOutcome::Cancelled) => {
                    inner.transition(&app, &task_id, JobStatus::Cancelled, None);
                }
                Ok(RunOutcome::Failed(msg)) | Err(AppError::YtdlpExit(msg)) => {
                    inner.transition(&app, &task_id, JobStatus::Failed, Some(msg));
                }
                Err(e) => {
                    inner.transition(&app, &task_id, JobStatus::Failed, Some(e.to_string()));
                }
            }

            drop(permit);
        });

        Ok(id)
    }

    pub fn cancel(&self, id: &str) -> Result<(), AppError> {
        let mut jobs = self.inner.jobs.lock().unwrap();
        let entry = jobs
            .get_mut(id)
            .ok_or_else(|| AppError::JobNotFound(id.to_string()))?;
        if let Some(tx) = entry.cancel_tx.take() {
            let _ = tx.send(());
        }
        Ok(())
    }

    pub fn pause(&self, app: &AppHandle, id: &str) -> Result<(), AppError> {
        let pid = self.pid_for_status_change(id, JobStatus::Downloading)?;
        if !crate::ytdlp::process_pause::suspend(pid) {
            return Err(AppError::InvalidInput(format!(
                "OS-level suspend failed for pid {pid}"
            )));
        }
        self.inner
            .transition(app, id, JobStatus::Paused, None);
        Ok(())
    }

    pub fn resume(&self, app: &AppHandle, id: &str) -> Result<(), AppError> {
        let pid = self.pid_for_status_change(id, JobStatus::Paused)?;
        if !crate::ytdlp::process_pause::resume(pid) {
            return Err(AppError::InvalidInput(format!(
                "OS-level resume failed for pid {pid}"
            )));
        }
        self.inner
            .transition(app, id, JobStatus::Downloading, None);
        Ok(())
    }

    /// Look up the running pid for a job, but only when its current
    /// status is the expected one (typically Downloading for pause,
    /// Paused for resume). This both rejects stale calls and avoids
    /// the brief window between enqueue and spawn where there is no
    /// pid yet.
    fn pid_for_status_change(
        &self,
        id: &str,
        expected: JobStatus,
    ) -> Result<u32, AppError> {
        // Clone the inner Arc so we can drop the outer jobs map lock
        // before touching the per-job pid mutex.
        let pid_arc = {
            let jobs = self.inner.jobs.lock().unwrap();
            let entry = jobs
                .get(id)
                .ok_or_else(|| AppError::JobNotFound(id.to_string()))?;
            if entry.state.status != expected {
                return Err(AppError::InvalidInput(format!(
                    "job is {:?}, expected {:?}",
                    entry.state.status, expected,
                )));
            }
            entry.pid.clone()
        };
        let pid = *pid_arc.lock().unwrap();
        pid.ok_or_else(|| AppError::InvalidInput("job has not spawned yet".into()))
    }

    pub fn list(&self) -> Vec<JobState> {
        self.inner
            .jobs
            .lock()
            .unwrap()
            .values()
            .map(|e| e.state.clone())
            .collect()
    }

    /// True iff any tracked job is in a non-terminal state (queued,
    /// downloading, or paused). Used by the yt-dlp self-updater to
    /// refuse swapping the sidecar while it might be in flight.
    pub fn has_active_jobs(&self) -> bool {
        self.inner.jobs.lock().unwrap().values().any(|entry| {
            matches!(
                entry.state.status,
                JobStatus::Queued | JobStatus::Downloading | JobStatus::Paused
            )
        })
    }

    pub fn clear_completed(&self) {
        let mut jobs = self.inner.jobs.lock().unwrap();
        jobs.retain(|_, entry| {
            !matches!(
                entry.state.status,
                JobStatus::Completed | JobStatus::Failed | JobStatus::Cancelled
            )
        });
    }
}

impl QueueInner {
    fn transition(&self, app: &AppHandle, id: &str, status: JobStatus, error: Option<String>) {
        if let Some(entry) = self.jobs.lock().unwrap().get_mut(id) {
            entry.state.status = status;
            if error.is_some() {
                entry.state.error = error.clone();
            }
        }
        emit_status(app, id, status, error);
    }
}

fn emit_status(app: &AppHandle, id: &str, status: JobStatus, error: Option<String>) {
    #[derive(Serialize, Clone)]
    struct Payload<'a> {
        id: &'a str,
        status: JobStatus,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    }
    let _ = app.emit("job-status", Payload { id, status, error });
}
