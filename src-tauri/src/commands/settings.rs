// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Leon Kasdorf

use std::sync::atomic::Ordering;

use tauri::State;
use tauri_plugin_dialog::DialogExt;
use tokio::sync::oneshot;

use crate::queue::QueueManager;
use crate::tray::CloseToTray;

#[tauri::command]
pub async fn pick_output_dir(app: tauri::AppHandle) -> Option<String> {
    let (tx, rx) = oneshot::channel();
    app.dialog().file().pick_folder(move |path| {
        let _ = tx.send(path);
    });
    rx.await
        .ok()
        .flatten()
        .and_then(|p| p.into_path().ok())
        .map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn pick_cookies_file(app: tauri::AppHandle) -> Option<String> {
    let (tx, rx) = oneshot::channel();
    app.dialog()
        .file()
        .add_filter("Netscape cookies", &["txt"])
        .add_filter("All files", &["*"])
        .pick_file(move |path| {
            let _ = tx.send(path);
        });
    rx.await
        .ok()
        .flatten()
        .and_then(|p| p.into_path().ok())
        .map(|p| p.to_string_lossy().into_owned())
}

/// Update the parallel-download limit at runtime. Returns the limit
/// after clamping (1..=MAX_PARALLEL_LIMIT). The frontend pushes its
/// persisted value on mount and on every change.
#[tauri::command]
pub fn set_parallel_limit(queue: State<'_, QueueManager>, limit: usize) -> usize {
    queue.set_parallel_limit(limit)
}

/// Toggle whether the window-close button (X) hides to the tray
/// instead of quitting. Frontend pushes the persisted value on mount
/// and on every change. Read by the `CloseRequested` window listener
/// in `lib.rs::run`.
#[tauri::command]
pub fn set_close_to_tray(state: State<'_, CloseToTray>, enabled: bool) {
    state.0.store(enabled, Ordering::Relaxed);
}
