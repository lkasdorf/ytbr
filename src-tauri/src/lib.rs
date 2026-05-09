// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Leon Kasdorf

mod commands;
mod error;
mod queue;
mod ytdlp;

use queue::QueueManager;

// MVP runs one download at a time. Iteration 2 makes this configurable
// via settings; bumping it just changes the semaphore permit count.
const PARALLEL_LIMIT: usize = 1;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(QueueManager::new(PARALLEL_LIMIT))
        .invoke_handler(tauri::generate_handler![
            commands::system::ytdlp_version,
            commands::probe::probe_url,
            commands::download::enqueue_job,
            commands::download::cancel_job,
            commands::download::list_jobs,
            commands::download::clear_completed_jobs,
            commands::settings::pick_output_dir,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
