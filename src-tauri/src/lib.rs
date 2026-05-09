// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Leon Kasdorf

mod commands;
mod error;
mod ytdlp;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            commands::system::ytdlp_version,
            commands::probe::probe_url,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
