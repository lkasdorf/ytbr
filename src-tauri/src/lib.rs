// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Leon Kasdorf

mod commands;
mod error;
mod queue;
mod ytdlp;

use queue::QueueManager;

/// Parallel-download limit at boot. The frontend pushes its persisted
/// value (`useSettingsStore.parallelLimit`) right after mount, so this
/// is only the value used until the first sync lands. Mirrors
/// `DEFAULT_PARALLEL_LIMIT` in `src/stores/settings.ts`.
const DEFAULT_PARALLEL_LIMIT: usize = 2;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(QueueManager::new(DEFAULT_PARALLEL_LIMIT))
        .invoke_handler(tauri::generate_handler![
            commands::system::ytdlp_version,
            commands::probe::probe_url,
            commands::probe::expand_playlist,
            commands::download::enqueue_job,
            commands::download::cancel_job,
            commands::download::pause_job,
            commands::download::resume_job,
            commands::download::list_jobs,
            commands::download::clear_completed_jobs,
            commands::settings::pick_output_dir,
            commands::settings::set_parallel_limit,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
