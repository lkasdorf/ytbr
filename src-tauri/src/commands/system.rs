// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Leon Kasdorf

use tauri_plugin_shell::ShellExt;

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
