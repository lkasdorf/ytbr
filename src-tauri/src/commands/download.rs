// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Leon Kasdorf

use tauri::State;

use crate::error::AppError;
use crate::queue::{JobId, JobSpec, JobState, QueueManager};

#[tauri::command]
pub async fn enqueue_job(
    app: tauri::AppHandle,
    queue: State<'_, QueueManager>,
    spec: JobSpec,
) -> Result<JobId, AppError> {
    queue.enqueue(app, spec)
}

#[tauri::command]
pub async fn cancel_job(
    queue: State<'_, QueueManager>,
    id: String,
) -> Result<(), AppError> {
    queue.cancel(&id)
}

#[tauri::command]
pub async fn pause_job(
    app: tauri::AppHandle,
    queue: State<'_, QueueManager>,
    id: String,
) -> Result<(), AppError> {
    queue.pause(&app, &id)
}

#[tauri::command]
pub async fn resume_job(
    app: tauri::AppHandle,
    queue: State<'_, QueueManager>,
    id: String,
) -> Result<(), AppError> {
    queue.resume(&app, &id)
}

#[tauri::command]
pub async fn list_jobs(queue: State<'_, QueueManager>) -> Result<Vec<JobState>, AppError> {
    Ok(queue.list())
}

#[tauri::command]
pub async fn clear_completed_jobs(
    app: tauri::AppHandle,
    queue: State<'_, QueueManager>,
) -> Result<(), AppError> {
    queue.clear_completed(&app);
    Ok(())
}

#[tauri::command]
pub async fn remove_job(
    app: tauri::AppHandle,
    queue: State<'_, QueueManager>,
    id: String,
) -> Result<(), AppError> {
    queue.remove_job(&app, &id);
    Ok(())
}

#[tauri::command]
pub async fn pause_all_jobs(
    app: tauri::AppHandle,
    queue: State<'_, QueueManager>,
) -> Result<usize, AppError> {
    Ok(queue.pause_all(&app))
}

#[tauri::command]
pub async fn resume_all_jobs(
    app: tauri::AppHandle,
    queue: State<'_, QueueManager>,
) -> Result<usize, AppError> {
    Ok(queue.resume_all(&app))
}

#[tauri::command]
pub async fn cancel_all_jobs(
    app: tauri::AppHandle,
    queue: State<'_, QueueManager>,
) -> Result<usize, AppError> {
    Ok(queue.cancel_all(&app))
}

#[tauri::command]
pub async fn queue_paused(queue: State<'_, QueueManager>) -> Result<bool, AppError> {
    Ok(queue.is_paused())
}

/// Called by the frontend right before running the updater's installer.
/// On Windows the updater ends the process with `std::process::exit`, so
/// RunEvent::Exit (and with it `QueueManager::shutdown`) never fires on
/// that path; this does the same work explicitly: persist the queue for
/// resuming after the update and stop the running downloads.
#[tauri::command]
pub async fn prepare_for_update(
    app: tauri::AppHandle,
    queue: State<'_, QueueManager>,
) -> Result<(), AppError> {
    queue.shutdown(&app);
    Ok(())
}
