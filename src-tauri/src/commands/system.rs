// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Leon Kasdorf

use tauri_plugin_opener::OpenerExt;
use tauri_plugin_shell::ShellExt;

/// Open a path in the OS file manager. Called from Rust so we don't
/// have to widen the JS-side `opener:allow-open-path` scope to cover
/// every possible user-chosen output directory; the Rust plugin call
/// has no such scope check.
#[tauri::command]
pub async fn reveal_in_folder(app: tauri::AppHandle, path: String) -> Result<(), String> {
    app.opener()
        .open_path(&path, None::<&str>)
        .map_err(|e| format!("open_path failed: {e}"))
}

#[tauri::command]
pub async fn ytdlp_version(app: tauri::AppHandle) -> Result<String, String> {
    let output = app
        .shell()
        .sidecar("yt-dlp")
        .map_err(|e| format!("sidecar lookup failed: {e}"))?
        .args(["--version"])
        .output()
        .await
        .map_err(|e| format!("sidecar execution failed: {e}"))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}
