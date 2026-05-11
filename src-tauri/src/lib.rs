// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Leon Kasdorf

mod commands;
mod error;
mod queue;
mod ytdlp;

use queue::QueueManager;
use tauri::Manager;

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
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(QueueManager::new(DEFAULT_PARALLEL_LIMIT))
        .setup(|app| {
            // Rehydrate the queue from disk before the frontend mounts.
            // Persistence is opt-out only at the file-system level (delete
            // queue.json); there's no setting to disable it because there's
            // no real cost to keep it on and the alternative is silent loss
            // of every prior job's history on each restart.
            let queue = app.state::<QueueManager>();
            queue.hydrate_from_disk(&app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::system::ytdlp_version,
            commands::system::ffmpeg_version,
            commands::system::reveal_in_folder,
            commands::probe::probe_url,
            commands::probe::expand_playlist,
            commands::download::enqueue_job,
            commands::download::cancel_job,
            commands::download::pause_job,
            commands::download::resume_job,
            commands::download::list_jobs,
            commands::download::clear_completed_jobs,
            commands::download::remove_job,
            commands::settings::pick_output_dir,
            commands::settings::pick_cookies_file,
            commands::settings::set_parallel_limit,
            commands::updater::update_ytdlp,
            commands::updater::check_app_update,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
