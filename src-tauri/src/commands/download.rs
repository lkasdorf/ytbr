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
pub async fn clear_completed_jobs(queue: State<'_, QueueManager>) -> Result<(), AppError> {
    queue.clear_completed();
    Ok(())
}
