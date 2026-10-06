// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Leon Kasdorf

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{oneshot, watch, Semaphore};

use crate::error::AppError;
use crate::ytdlp::progress::JobProgress;
use crate::ytdlp::runner::{self, RunOutcome};

pub type JobId = String;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
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
    /// yt-dlp `--cookies` file path. Mutually exclusive with
    /// `cookies_from_browser`; the runner picks file first if both
    /// happen to be set (UI enforces single-source already).
    #[serde(default)]
    pub cookies_file: Option<String>,
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
    /// Center-crop the cover art to a square before embedding / writing
    /// it. Only meaningful with `embed_thumbnail` or `write_thumbnail`.
    #[serde(default)]
    pub square_thumbnail: bool,
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
    /// yt-dlp `--extractor-args` values, whitespace-separated (one flag
    /// per entry, e.g. `youtube:player_client=web_music`). Escape hatch
    /// for upstream site breakage that yt-dlp works around with
    /// extractor args before a fixed release ships. `None` or empty skips.
    #[serde(default)]
    pub extractor_args: Option<String>,
}

fn default_template() -> String {
    "%(title)s.%(ext)s".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobState {
    pub id: JobId,
    pub spec: JobSpec,
    pub status: JobStatus,
    #[serde(default)]
    pub progress: Option<JobProgress>,
    #[serde(default)]
    pub error: Option<String>,
    /// Monotonic creation order. The job map is a HashMap, so without
    /// this `list()` (and queue.json) come back in arbitrary order and
    /// the UI's "queue order" / newest / oldest sorts break after a
    /// restart. Old queue.json files lack it; hydration assigns one.
    #[serde(default)]
    pub seq: u64,
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
    /// Queue-wide pause ("Pause all"). While `true`, queued jobs don't
    /// start; running ones were suspended by `pause_all`. Spawn tasks
    /// subscribe and wait for it to flip back.
    paused: watch::Sender<bool>,
    /// Set by every mutation; the persister thread writes queue.json at
    /// most once per PERSIST_INTERVAL when it's set. Writing the whole
    /// file on every transition was O(jobs) per job start/finish and
    /// held the jobs lock while serializing megabytes at a few thousand
    /// entries.
    dirty: AtomicBool,
    next_seq: AtomicU64,
    /// Set by `shutdown`. From then on nothing is persisted, so the
    /// failures caused by killing the running downloads on exit don't
    /// overwrite their resumable state in queue.json.
    shutting_down: AtomicBool,
}

const PERSIST_INTERVAL: Duration = Duration::from_secs(1);

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
                paused: watch::Sender::new(false),
                dirty: AtomicBool::new(false),
                next_seq: AtomicU64::new(1),
                shutting_down: AtomicBool::new(false),
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
            seq: self.inner.next_seq.fetch_add(1, Ordering::Relaxed),
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
        self.inner.mark_dirty();
        emit_status(&app, &id, JobStatus::Queued, None);
        spawn_job(self.inner.clone(), app, id.clone(), spec, cancel_rx, pid);
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
        if !crate::ytdlp::process_tree::suspend(pid) {
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
        if !crate::ytdlp::process_tree::resume(pid) {
            return Err(AppError::InvalidInput(format!(
                "OS-level resume failed for pid {pid}"
            )));
        }
        self.inner
            .transition(app, id, JobStatus::Downloading, None);
        Ok(())
    }

    /// Pause the whole queue: queued jobs stop being started and every
    /// running download is suspended. Returns how many downloads were
    /// suspended. A job that is between taking its slot and spawning
    /// yt-dlp has no pid yet and keeps running; the window is a few
    /// milliseconds.
    pub fn pause_all(&self, app: &AppHandle) -> usize {
        self.inner.paused.send_replace(true);
        self.inner.mark_dirty();
        emit_queue_paused(app, true);
        self.ids_with_status(JobStatus::Downloading)
            .iter()
            .filter(|id| self.pause(app, id).is_ok())
            .count()
    }

    /// Undo `pause_all`: resume every paused download and let queued
    /// jobs start again. Also resumes jobs that were paused one by one.
    pub fn resume_all(&self, app: &AppHandle) -> usize {
        self.inner.paused.send_replace(false);
        self.inner.mark_dirty();
        emit_queue_paused(app, false);
        self.ids_with_status(JobStatus::Paused)
            .iter()
            .filter(|id| self.resume(app, id).is_ok())
            .count()
    }

    /// Cancel every queued, downloading and paused job, then clear the
    /// queue-wide pause so the next enqueue isn't silently held back.
    /// Returns how many jobs were signalled.
    pub fn cancel_all(&self, app: &AppHandle) -> usize {
        let mut n = 0;
        for entry in self.inner.jobs.lock().unwrap().values_mut() {
            if is_active(entry.state.status) {
                if let Some(tx) = entry.cancel_tx.take() {
                    let _ = tx.send(());
                    n += 1;
                }
            }
        }
        self.inner.paused.send_replace(false);
        self.inner.mark_dirty();
        emit_queue_paused(app, false);
        n
    }

    pub fn is_paused(&self) -> bool {
        *self.inner.paused.borrow()
    }

    fn ids_with_status(&self, status: JobStatus) -> Vec<JobId> {
        self.inner
            .jobs
            .lock()
            .unwrap()
            .values()
            .filter(|e| e.state.status == status)
            .map(|e| e.state.id.clone())
            .collect()
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

    /// All jobs in creation order.
    pub fn list(&self) -> Vec<JobState> {
        self.inner.snapshot()
    }

    /// True iff any tracked job is in a non-terminal state (queued,
    /// downloading, or paused). Used by the yt-dlp self-updater to
    /// refuse swapping the sidecar while it might be in flight.
    pub fn has_active_jobs(&self) -> bool {
        self.inner
            .jobs
            .lock()
            .unwrap()
            .values()
            .any(|entry| is_active(entry.state.status))
    }

    pub fn clear_completed(&self, _app: &AppHandle) {
        let mut jobs = self.inner.jobs.lock().unwrap();
        jobs.retain(|_, entry| {
            !matches!(
                entry.state.status,
                JobStatus::Completed | JobStatus::Failed | JobStatus::Cancelled
            )
        });
        drop(jobs);
        self.inner.mark_dirty();
    }

    /// Remove a single job by id. Idempotent: missing ids are ignored.
    /// Callers should make sure the job is in a terminal state — removing
    /// a running job leaks the spawn task and any held permits. The frontend
    /// auto-clear path only fires on `completed`, the manual per-job
    /// button is currently surfaced only for terminal cards, so this
    /// stays an internal invariant rather than an Err return for now.
    pub fn remove_job(&self, _app: &AppHandle, id: &str) {
        if self.inner.jobs.lock().unwrap().remove(id).is_some() {
            self.inner.mark_dirty();
        }
    }

    /// Start the background thread that writes queue.json whenever the
    /// queue changed, at most once per PERSIST_INTERVAL. Call once.
    pub fn start_persister(&self, app: AppHandle) {
        let inner = self.inner.clone();
        std::thread::spawn(move || loop {
            std::thread::sleep(PERSIST_INTERVAL);
            if inner.dirty.swap(false, Ordering::AcqRel) {
                inner.persist_now(&app);
            }
        });
    }

    /// App is exiting (window closed, tray Quit, or the updater about to
    /// run the installer). Persist the queue as it is — running and
    /// paused jobs included, so the next start resumes them — then kill
    /// the yt-dlp process trees. The shell plugin only cleans up children
    /// spawned from JS, so without this the downloads (PyInstaller
    /// worker + ffmpeg) kept running after exit and collided with their
    /// resumed copies on the next start. Idempotent.
    pub fn shutdown(&self, app: &AppHandle) {
        if self.inner.shutting_down.load(Ordering::Acquire) {
            return;
        }
        self.inner.persist_now(app);
        self.inner.shutting_down.store(true, Ordering::Release);
        let pids: Vec<u32> = self
            .inner
            .jobs
            .lock()
            .unwrap()
            .values()
            .filter_map(|e| *e.pid.lock().unwrap())
            .collect();
        for pid in pids {
            crate::ytdlp::process_tree::kill_tree(pid);
        }
    }

    /// Read `queue.json` on app startup and seed the in-memory map.
    /// Jobs that hadn't finished (queued / downloading / paused) are put
    /// back in the queue in their original order and start again —
    /// yt-dlp continues partially downloaded files. A queue that was
    /// paused with "Pause all" comes back paused.
    pub fn hydrate_from_disk(&self, app: &AppHandle) {
        let (persisted, was_paused) = load_persisted_jobs(app);
        if persisted.is_empty() {
            return;
        }
        // Before any task is spawned, so resumed jobs wait if needed.
        self.inner.paused.send_replace(was_paused);
        let mut resume: Vec<(JobId, JobSpec, oneshot::Receiver<()>, Arc<Mutex<Option<u32>>>)> =
            Vec::new();
        let persisted = prepare_for_resume(persisted);
        self.inner
            .next_seq
            .store(persisted.len() as u64 + 1, Ordering::Relaxed);
        let mut jobs = self.inner.jobs.lock().unwrap();
        for state in persisted {
            let pid = Arc::new(Mutex::new(None));
            let mut cancel_tx = None;
            if state.status == JobStatus::Queued {
                let (tx, rx) = oneshot::channel::<()>();
                cancel_tx = Some(tx);
                resume.push((state.id.clone(), state.spec.clone(), rx, pid.clone()));
            }
            jobs.insert(
                state.id.clone(),
                JobEntry {
                    state,
                    cancel_tx,
                    pid,
                },
            );
        }
        drop(jobs);
        self.inner.persist_now(app);
        // In creation order, so the FIFO semaphore keeps queue order.
        for (id, spec, rx, pid) in resume {
            spawn_job(self.inner.clone(), app.clone(), id, spec, rx, pid);
        }
    }
}

/// Startup view of persisted jobs: sorted by creation order and
/// renumbered densely (old files have no seq — all 0 — so their stored
/// order is kept), with every unfinished job reset to Queued so it runs
/// again. The OS processes of downloading / paused jobs died with the
/// previous app instance; yt-dlp picks up their partial files.
fn prepare_for_resume(mut persisted: Vec<JobState>) -> Vec<JobState> {
    persisted.sort_by_key(|s| s.seq);
    for (i, state) in persisted.iter_mut().enumerate() {
        state.seq = i as u64 + 1;
        if is_active(state.status) {
            state.status = JobStatus::Queued;
            state.progress = None;
            state.error = None;
        }
    }
    persisted
}

/// Run one job to completion: wait while the queue is paused, take a
/// download slot (or bail out on cancel), run yt-dlp, record the outcome.
/// Shared by `enqueue` and the restart path in `hydrate_from_disk`.
fn spawn_job(
    inner: Arc<QueueInner>,
    app: AppHandle,
    id: JobId,
    spec: JobSpec,
    cancel_rx: oneshot::Receiver<()>,
    pid_for_runner: Arc<Mutex<Option<u32>>>,
) {
    tauri::async_runtime::spawn(async move {
        // Race the permit against cancel so cancelling a job that is
        // still waiting for a slot takes effect immediately instead
        // of once a running download frees its permit.
        let mut cancel_rx = cancel_rx;
        let permit = loop {
            // Hold off while the whole queue is paused, without
            // occupying a download slot.
            let mut paused_rx = inner.paused.subscribe();
            tokio::select! {
                unpaused = paused_rx.wait_for(|p| !*p) => {
                    if unpaused.is_err() {
                        return; // sender dropped (shutdown)
                    }
                }
                _ = &mut cancel_rx => {
                    inner.transition(&app, &id, JobStatus::Cancelled, None);
                    return;
                }
            }
            let permit = tokio::select! {
                acquired = inner.semaphore.clone().acquire_owned() => match acquired {
                    Ok(p) => p,
                    Err(_) => return, // semaphore closed (shutdown)
                },
                _ = &mut cancel_rx => {
                    inner.transition(&app, &id, JobStatus::Cancelled, None);
                    return;
                }
            };
            // "Pause all" may have landed while we waited for the
            // slot: give it back and wait again.
            if *inner.paused.borrow() {
                drop(permit);
                continue;
            }
            break permit;
        };

        inner.transition(&app, &id, JobStatus::Downloading, None);

        let outcome =
            runner::run(&app, &id, &spec, cancel_rx, pid_for_runner).await;

        match outcome {
            Ok(RunOutcome::Completed) => {
                inner.transition(&app, &id, JobStatus::Completed, None);
            }
            Ok(RunOutcome::Cancelled) => {
                inner.transition(&app, &id, JobStatus::Cancelled, None);
            }
            Ok(RunOutcome::Failed(msg)) | Err(AppError::YtdlpExit(msg)) => {
                inner.transition(&app, &id, JobStatus::Failed, Some(msg));
            }
            Err(e) => {
                inner.transition(&app, &id, JobStatus::Failed, Some(e.to_string()));
            }
        }

        drop(permit);
    });
}

impl QueueInner {
    fn transition(&self, app: &AppHandle, id: &str, status: JobStatus, error: Option<String>) {
        if let Some(entry) = self.jobs.lock().unwrap().get_mut(id) {
            entry.state.status = status;
            if error.is_some() {
                entry.state.error = error.clone();
            }
        }
        self.mark_dirty();
        emit_status(app, id, status, error);
    }

    fn mark_dirty(&self) {
        self.dirty.store(true, Ordering::Release);
    }

    fn persist_now(&self, app: &AppHandle) {
        if self.shutting_down.load(Ordering::Acquire) {
            return;
        }
        write_states(app, self.snapshot(), *self.paused.borrow());
    }

    /// Clone of every job's state in creation order. The lock is held
    /// only for the clone; serializing happens outside it.
    fn snapshot(&self) -> Vec<JobState> {
        let mut states: Vec<JobState> = self
            .jobs
            .lock()
            .unwrap()
            .values()
            .map(|e| e.state.clone())
            .collect();
        states.sort_by_key(|s| s.seq);
        states
    }
}

// Persistence: store the whole queue as a single JSON file under
// `<app_config_dir>/queue.json`. Atomic-replaced via tmp+rename so a
// process crash mid-write can't truncate the file. The file is the
// only source of truth across app restarts; the in-memory HashMap is
// the source of truth while the app runs.
//
// We don't persist logs (session-local, can be megabytes per failed
// job) or the cancel/pid handles (process-local, meaningless across
// restarts). On hydration anything that was running flips to
// Cancelled — the OS process is gone, no way to resume.

#[derive(Serialize, Deserialize)]
struct PersistedQueue {
    version: u32,
    jobs: Vec<JobState>,
    /// Queue-wide "Pause all" state, restored on the next start.
    #[serde(default)]
    paused: bool,
}

const PERSIST_VERSION: u32 = 1;
// `static`, not `const` — a const Mutex is re-instantiated on every
// use site, defeating the serialization. The static guarantees one
// lock for the whole process so concurrent writers can't tear JSON.
static PERSIST_LOCK: Mutex<()> = Mutex::new(());

fn queue_file_path(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_config_dir().ok()?;
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir.join("queue.json"))
}

fn write_states(app: &AppHandle, jobs: Vec<JobState>, paused: bool) {
    let Some(path) = queue_file_path(app) else {
        return;
    };
    let payload = PersistedQueue {
        version: PERSIST_VERSION,
        jobs,
        paused,
    };
    // Compact, not pretty: at thousands of jobs the indentation alone
    // was a sizeable share of every write.
    let Ok(json) = serde_json::to_vec(&payload) else {
        return;
    };
    // Serialize concurrent writes via a process-wide lock — torn JSON
    // would lose the entire history on next boot.
    let _guard = PERSIST_LOCK.lock().unwrap();
    let tmp = path.with_extension("json.tmp");
    if std::fs::write(&tmp, &json).is_ok() {
        let _ = std::fs::rename(&tmp, &path);
    }
}

fn load_persisted_jobs(app: &AppHandle) -> (Vec<JobState>, bool) {
    let Some(path) = queue_file_path(app) else {
        return (Vec::new(), false);
    };
    let Ok(bytes) = std::fs::read(&path) else {
        return (Vec::new(), false);
    };
    let parsed: Result<PersistedQueue, _> = serde_json::from_slice(&bytes);
    match parsed {
        Ok(persisted) if persisted.version <= PERSIST_VERSION => (persisted.jobs, persisted.paused),
        _ => {
            // Unreadable or written by a newer YTBR. Move it aside rather
            // than returning empty and letting the next write_states
            // overwrite it — that would silently drop the whole history
            // (e.g. after a downgrade).
            let _ = std::fs::rename(&path, path.with_extension("json.bak"));
            (Vec::new(), false)
        }
    }
}

fn is_active(status: JobStatus) -> bool {
    matches!(
        status,
        JobStatus::Queued | JobStatus::Downloading | JobStatus::Paused
    )
}

fn emit_queue_paused(app: &AppHandle, paused: bool) {
    let _ = app.emit("queue-paused", paused);
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

#[cfg(test)]
mod tests {
    use super::*;

    fn state(id: &str, seq: u64) -> JobState {
        JobState {
            id: id.into(),
            spec: serde_json::from_str(r#"{"url":"u","formatId":null,"outputDir":"."}"#).unwrap(),
            status: JobStatus::Completed,
            progress: None,
            error: None,
            seq,
        }
    }

    #[test]
    fn list_is_in_creation_order_not_hash_order() {
        let q = QueueManager::new(1);
        {
            let mut jobs = q.inner.jobs.lock().unwrap();
            for (id, seq) in [("c", 3), ("a", 1), ("e", 5), ("b", 2), ("d", 4)] {
                jobs.insert(
                    id.into(),
                    JobEntry {
                        state: state(id, seq),
                        cancel_tx: None,
                        pid: Arc::new(Mutex::new(None)),
                    },
                );
            }
        }
        let ids: Vec<_> = q.list().into_iter().map(|s| s.id).collect();
        assert_eq!(ids, ["a", "b", "c", "d", "e"]);
    }

    #[test]
    fn resume_requeues_unfinished_jobs_in_creation_order() {
        let mut downloading = state("d", 7);
        downloading.status = JobStatus::Downloading;
        downloading.progress = Some(JobProgress {
            percent: 42.0,
            speed_bps: None,
            eta_secs: None,
            downloaded_bytes: None,
            total_bytes: None,
        });
        let mut paused = state("p", 3);
        paused.status = JobStatus::Paused;
        let mut queued = state("q", 9);
        queued.status = JobStatus::Queued;
        let mut failed = state("f", 1);
        failed.status = JobStatus::Failed;
        failed.error = Some("boom".into());

        let out = prepare_for_resume(vec![queued, downloading, failed, paused]);
        let view: Vec<_> = out.iter().map(|s| (s.id.as_str(), s.seq, s.status)).collect();
        assert_eq!(
            view,
            [
                ("f", 1, JobStatus::Failed),
                ("p", 2, JobStatus::Queued),
                ("d", 3, JobStatus::Queued),
                ("q", 4, JobStatus::Queued),
            ]
        );
        assert!(out[2].progress.is_none());
        assert_eq!(out[0].error.as_deref(), Some("boom"));
    }

    #[test]
    fn paused_flag_round_trips_and_defaults_off() {
        let q = PersistedQueue { version: 1, jobs: vec![], paused: true };
        let back: PersistedQueue =
            serde_json::from_slice(&serde_json::to_vec(&q).unwrap()).unwrap();
        assert!(back.paused);
        let old: PersistedQueue = serde_json::from_str(r#"{"version":1,"jobs":[]}"#).unwrap();
        assert!(!old.paused);
    }

    #[test]
    fn old_queue_json_without_seq_still_parses() {
        let raw = r#"{"version":1,"jobs":[{"id":"x","spec":{"url":"u","formatId":null,"outputDir":"."},"status":"completed"}]}"#;
        let parsed: PersistedQueue = serde_json::from_str(raw).unwrap();
        assert_eq!(parsed.jobs[0].seq, 0);
    }
}
