// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Leon Kasdorf

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{oneshot, watch, OwnedSemaphorePermit, Semaphore};

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
    /// Video title for the queue / history cards. The Download tab
    /// sends it from the probe result; for every other job the runner
    /// fills it in once yt-dlp has resolved the URL (see `set_title`).
    #[serde(default)]
    pub title: Option<String>,
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
    /// `QueueInner::generation` at the time this job's task was spawned.
    /// A task from an older generation was orphaned by `shutdown` and
    /// must not touch the job any more.
    generation: u64,
}

/// What `spawn_job` needs to start (or restart) one job's task.
struct PendingSpawn {
    id: JobId,
    spec: JobSpec,
    cancel_rx: oneshot::Receiver<()>,
    pid: Arc<Mutex<Option<u32>>>,
}

/// Download-slot accounting next to the semaphore.
struct Slots {
    /// Current target permit count.
    limit: usize,
    /// Permits that still have to leave the pool after the limit was
    /// lowered while they were held by running downloads. Each one is
    /// forgotten instead of returned when its download ends.
    debt: usize,
}

pub struct QueueManager {
    inner: Arc<QueueInner>,
}

struct QueueInner {
    jobs: Mutex<HashMap<JobId, JobEntry>>,
    semaphore: Arc<Semaphore>,
    /// Source of truth alongside the semaphore — guarded together so
    /// concurrent set_parallel_limit calls and permit releases don't
    /// compute a wrong delta.
    slots: Mutex<Slots>,
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
    /// overwrite their resumable state in queue.json. Cleared again by
    /// `resume_after_shutdown` when the app keeps running after all.
    shutting_down: AtomicBool,
    /// Bumped by `shutdown`. Every job task remembers the value it was
    /// spawned under and stops reporting once it no longer matches, so
    /// the tasks orphaned by a shutdown neither start new downloads nor
    /// mark their killed ones as failed.
    generation: AtomicU64,
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
                slots: Mutex::new(Slots { limit, debt: 0 }),
                paused: watch::Sender::new(false),
                dirty: AtomicBool::new(false),
                next_seq: AtomicU64::new(1),
                shutting_down: AtomicBool::new(false),
                generation: AtomicU64::new(0),
            }),
        }
    }

    /// Adjust the parallel-download limit at runtime.
    ///
    /// Growing is instant: extra permits are released onto the
    /// semaphore and any queued jobs unblock immediately.
    ///
    /// Shrinking never disturbs in-flight downloads. Idle permits are
    /// removed from the pool right away; the ones held by running jobs
    /// are booked as `debt` and forgotten when those jobs end (see
    /// `QueueInner::release`). An earlier version queued an "absorber"
    /// on the semaphore instead — the semaphore is FIFO, so it sat
    /// behind every waiting job and the lower limit only took effect
    /// once the whole backlog had drained.
    ///
    /// Returns the clamped, accepted limit.
    pub fn set_parallel_limit(&self, requested: usize) -> usize {
        let new_limit = clamp_limit(requested);
        let mut slots = self.inner.slots.lock().unwrap();
        let old_limit = slots.limit;

        if new_limit > old_limit {
            // Permits still owed from an earlier shrink cancel out first.
            let grow = new_limit - old_limit;
            let settled = grow.min(slots.debt);
            slots.debt -= settled;
            self.inner.semaphore.add_permits(grow - settled);
        } else if new_limit < old_limit {
            let shrink = old_limit - new_limit;
            let removed = self.inner.semaphore.forget_permits(shrink);
            slots.debt += shrink - removed;
        }

        slots.limit = new_limit;
        new_limit
    }

    pub fn enqueue(&self, app: AppHandle, spec: JobSpec) -> Result<JobState, AppError> {
        validate_spec(&spec)?;
        Ok(self.insert_and_spawn(&app, spec))
    }

    /// Enqueue a whole batch in one call. All-or-nothing on validation:
    /// one bad spec rejects the batch before anything is queued, so the
    /// caller never has to clean up half a playlist. Jobs start in the
    /// order given.
    pub fn enqueue_many(
        &self,
        app: &AppHandle,
        specs: Vec<JobSpec>,
    ) -> Result<Vec<JobState>, AppError> {
        specs.iter().try_for_each(validate_spec)?;
        Ok(specs
            .into_iter()
            .map(|spec| self.insert_and_spawn(app, spec))
            .collect())
    }

    fn insert_and_spawn(&self, app: &AppHandle, spec: JobSpec) -> JobState {
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
        let generation = self.inner.generation.load(Ordering::Acquire);
        self.inner.jobs.lock().unwrap().insert(
            id.clone(),
            JobEntry {
                state: state.clone(),
                cancel_tx: Some(cancel_tx),
                pid: pid.clone(),
                generation,
            },
        );
        self.inner.mark_dirty();
        emit_status(app, &id, JobStatus::Queued, None);
        spawn_job(
            self.inner.clone(),
            app.clone(),
            generation,
            PendingSpawn { id, spec, cancel_rx, pid },
        );
        state
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
    ///
    /// Bumping the generation orphans every job task: the killed
    /// downloads are not reported as failed and waiting jobs don't grab
    /// the freed slots to start new yt-dlp processes on the way out.
    pub fn shutdown(&self, app: &AppHandle) {
        if self.inner.shutting_down.load(Ordering::Acquire) {
            return;
        }
        self.inner.persist_now(app);
        self.inner.shutting_down.store(true, Ordering::Release);
        self.inner.generation.fetch_add(1, Ordering::AcqRel);
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

    /// Undo `shutdown` when the app keeps running after all — the update
    /// installer failed or was declined (e.g. a cancelled pkexec prompt
    /// on Linux). Persistence is switched back on and every job that was
    /// unfinished at shutdown is queued again, in creation order; yt-dlp
    /// continues their partial files. Returns how many jobs were
    /// requeued. No-op unless `shutdown` ran before.
    pub fn resume_after_shutdown(&self, app: &AppHandle) -> usize {
        if !self.inner.shutting_down.swap(false, Ordering::AcqRel) {
            return 0;
        }
        let generation = self.inner.generation.load(Ordering::Acquire);
        let mut restart: Vec<PendingSpawn> = Vec::new();
        {
            let mut jobs = self.inner.jobs.lock().unwrap();
            let mut orphaned: Vec<&mut JobEntry> = jobs
                .values_mut()
                .filter(|e| e.generation != generation && is_active(e.state.status))
                .collect();
            orphaned.sort_by_key(|e| e.state.seq);
            for entry in orphaned {
                let (tx, cancel_rx) = oneshot::channel::<()>();
                // Fresh handles: the orphaned task still owns the old
                // ones and may not have wound down yet.
                entry.cancel_tx = Some(tx);
                entry.pid = Arc::new(Mutex::new(None));
                entry.generation = generation;
                entry.state.status = JobStatus::Queued;
                entry.state.progress = None;
                entry.state.error = None;
                restart.push(PendingSpawn {
                    id: entry.state.id.clone(),
                    spec: entry.state.spec.clone(),
                    cancel_rx,
                    pid: entry.pid.clone(),
                });
            }
        }
        self.inner.mark_dirty();
        let requeued = restart.len();
        for pending in restart {
            emit_status(app, &pending.id, JobStatus::Queued, None);
            spawn_job(self.inner.clone(), app.clone(), generation, pending);
        }
        requeued
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
        let mut resume: Vec<PendingSpawn> = Vec::new();
        let persisted = prepare_for_resume(persisted);
        self.inner
            .next_seq
            .store(persisted.len() as u64 + 1, Ordering::Relaxed);
        let generation = self.inner.generation.load(Ordering::Acquire);
        let mut jobs = self.inner.jobs.lock().unwrap();
        for state in persisted {
            let pid = Arc::new(Mutex::new(None));
            let mut cancel_tx = None;
            if state.status == JobStatus::Queued {
                let (tx, cancel_rx) = oneshot::channel::<()>();
                cancel_tx = Some(tx);
                resume.push(PendingSpawn {
                    id: state.id.clone(),
                    spec: state.spec.clone(),
                    cancel_rx,
                    pid: pid.clone(),
                });
            }
            jobs.insert(
                state.id.clone(),
                JobEntry {
                    state,
                    cancel_tx,
                    pid,
                    generation,
                },
            );
        }
        drop(jobs);
        self.inner.persist_now(app);
        // In creation order, so the FIFO semaphore keeps queue order.
        for pending in resume {
            spawn_job(self.inner.clone(), app.clone(), generation, pending);
        }
    }
}

fn validate_spec(spec: &JobSpec) -> Result<(), AppError> {
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
    Ok(())
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
/// Shared by `enqueue`, the restart path in `hydrate_from_disk` and
/// `resume_after_shutdown`.
///
/// `generation` is the queue generation the task belongs to. Once
/// `shutdown` has moved on to the next one the task is orphaned: it
/// returns its slot and leaves the job's state alone, so the job can be
/// persisted as resumable and picked up again by a fresh task.
fn spawn_job(inner: Arc<QueueInner>, app: AppHandle, generation: u64, job: PendingSpawn) {
    let PendingSpawn { id, spec, cancel_rx, pid } = job;
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
                // Also fires when the sender is dropped, which is what
                // resume_after_shutdown does to an orphaned task.
                _ = &mut cancel_rx => {
                    if inner.is_current(generation) {
                        inner.transition(&app, &id, JobStatus::Cancelled, None);
                    }
                    return;
                }
            }
            let permit = tokio::select! {
                acquired = inner.semaphore.clone().acquire_owned() => match acquired {
                    Ok(p) => p,
                    Err(_) => return, // semaphore closed (shutdown)
                },
                _ = &mut cancel_rx => {
                    if inner.is_current(generation) {
                        inner.transition(&app, &id, JobStatus::Cancelled, None);
                    }
                    return;
                }
            };
            if !inner.is_current(generation) {
                inner.release(permit);
                return;
            }
            // "Pause all" may have landed while we waited for the
            // slot: give it back and wait again.
            if *inner.paused.borrow() {
                inner.release(permit);
                continue;
            }
            break permit;
        };

        inner.transition(&app, &id, JobStatus::Downloading, None);

        let outcome = runner::run(
            &app,
            &id,
            &spec,
            cancel_rx,
            pid,
            |title| inner.set_title(&app, &id, title),
            |progress| inner.set_progress(&id, progress),
        )
        .await;

        // An orphaned task's download was killed by `shutdown`; that is
        // not a failure of the job.
        if inner.is_current(generation) {
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
        }

        inner.release(permit);
    });
}

impl QueueInner {
    fn transition(&self, app: &AppHandle, id: &str, status: JobStatus, error: Option<String>) {
        if let Some(entry) = self.jobs.lock().unwrap().get_mut(id) {
            entry.state.status = status;
            if error.is_some() {
                entry.state.error = error.clone();
            }
            // A finished job can't be cancelled any more. Dropping the
            // sender also ends the runner's cancel watcher, which would
            // otherwise sit on the yt-dlp process handle for as long as
            // the job stays in the history.
            if !is_active(status) {
                entry.cancel_tx = None;
            }
        }
        self.mark_dirty();
        emit_status(app, id, status, error);
    }

    /// Record the title yt-dlp resolved for a job and tell the frontend.
    /// No-op when the job already carries that title (probed jobs).
    fn set_title(&self, app: &AppHandle, id: &str, title: &str) {
        {
            let mut jobs = self.jobs.lock().unwrap();
            let Some(entry) = jobs.get_mut(id) else { return };
            if entry.state.spec.title.as_deref() == Some(title) {
                return;
            }
            entry.state.spec.title = Some(title.to_string());
        }
        self.mark_dirty();
        let _ = app.emit("job-title", TitlePayload { id, title });
    }

    /// Keep the latest progress on the job, so `list_jobs` (a webview
    /// reload) and queue.json (the history after a restart) carry it.
    /// The field existed but nothing ever wrote it: a finished job lost
    /// its size line as soon as the frontend copy was gone.
    ///
    /// Deliberately not marked dirty: this runs several times a second
    /// per download, and the next status change persists the value.
    fn set_progress(&self, id: &str, progress: &JobProgress) {
        if let Some(entry) = self.jobs.lock().unwrap().get_mut(id) {
            entry.state.progress = Some(progress.clone());
        }
    }

    fn is_current(&self, generation: u64) -> bool {
        self.generation.load(Ordering::Acquire) == generation
    }

    /// Give a download slot back. Every permit must come back through
    /// here rather than being dropped: after the limit was lowered, the
    /// permits still owed are taken out of the pool at this point.
    fn release(&self, permit: OwnedSemaphorePermit) {
        let mut slots = self.slots.lock().unwrap();
        if slots.debt > 0 {
            slots.debt -= 1;
            permit.forget();
        } else {
            // Under the lock, so a concurrent set_parallel_limit sees
            // the permit either still held or already back in the pool.
            drop(permit);
        }
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
// restarts). On hydration every unfinished job goes back to Queued
// and runs again (see `prepare_for_resume`).

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

#[derive(Serialize, Clone)]
struct TitlePayload<'a> {
    id: &'a str,
    title: &'a str,
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
                        generation: 0,
                    },
                );
            }
        }
        let ids: Vec<_> = q.list().into_iter().map(|s| s.id).collect();
        assert_eq!(ids, ["a", "b", "c", "d", "e"]);
    }

    #[test]
    fn progress_is_kept_on_the_job_and_survives_persistence() {
        let q = QueueManager::new(1);
        q.inner.jobs.lock().unwrap().insert(
            "a".into(),
            JobEntry {
                state: state("a", 1),
                cancel_tx: None,
                pid: Arc::new(Mutex::new(None)),
                generation: 0,
            },
        );
        let progress = JobProgress {
            percent: 100.0,
            speed_bps: None,
            eta_secs: None,
            downloaded_bytes: Some(788_493),
            total_bytes: Some(788_493),
        };
        q.inner.set_progress("a", &progress);
        // Unknown ids are ignored (the job may have been removed).
        q.inner.set_progress("gone", &progress);

        let listed = q.list();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].progress.as_ref().unwrap().total_bytes, Some(788_493));

        let file = PersistedQueue { version: 1, jobs: listed, paused: false };
        let back: PersistedQueue =
            serde_json::from_str(&serde_json::to_string(&file).unwrap()).unwrap();
        assert_eq!(back.jobs[0].progress.as_ref().unwrap().downloaded_bytes, Some(788_493));
    }

    fn take_slot(q: &QueueManager) -> OwnedSemaphorePermit {
        q.inner.semaphore.clone().try_acquire_owned().expect("free slot")
    }

    #[test]
    fn lowering_the_limit_applies_as_running_jobs_finish() {
        let q = QueueManager::new(3);
        let (a, b, c) = (take_slot(&q), take_slot(&q), take_slot(&q));

        // All three slots busy: nothing to remove yet, two are owed.
        assert_eq!(q.set_parallel_limit(1), 1);
        q.inner.release(a);
        q.inner.release(b);
        assert_eq!(q.inner.semaphore.available_permits(), 0);

        // The third one is the single slot the new limit allows.
        q.inner.release(c);
        assert_eq!(q.inner.semaphore.available_permits(), 1);
    }

    #[test]
    fn lowering_the_limit_removes_idle_slots_at_once() {
        let q = QueueManager::new(4);
        let busy = take_slot(&q);
        q.set_parallel_limit(2);
        assert_eq!(q.inner.semaphore.available_permits(), 1);
        q.inner.release(busy);
        assert_eq!(q.inner.semaphore.available_permits(), 2);
    }

    #[test]
    fn raising_the_limit_settles_owed_slots_first() {
        let q = QueueManager::new(3);
        let (a, b, c) = (take_slot(&q), take_slot(&q), take_slot(&q));
        q.set_parallel_limit(1);
        // Back up to 3 before any job finished: no slot may be added,
        // or four downloads could run.
        q.set_parallel_limit(3);
        assert_eq!(q.inner.semaphore.available_permits(), 0);
        for permit in [a, b, c] {
            q.inner.release(permit);
        }
        assert_eq!(q.inner.semaphore.available_permits(), 3);
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
