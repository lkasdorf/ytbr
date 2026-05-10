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

/// First line of `ffmpeg -version`, e.g. "ffmpeg version N-... Copyright ...".
/// The full multi-line output dumps every codec/build flag — too noisy for
/// an About dialog. Falls back to stderr because some ffmpeg builds print
/// the banner there.
#[tauri::command]
pub async fn ffmpeg_version(app: tauri::AppHandle) -> Result<String, String> {
    let output = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| format!("sidecar lookup failed: {e}"))?
        .args(["-version"])
        .output()
        .await
        .map_err(|e| format!("sidecar execution failed: {e}"))?;

    let text = if !output.stdout.is_empty() {
        String::from_utf8_lossy(&output.stdout).into_owned()
    } else {
        String::from_utf8_lossy(&output.stderr).into_owned()
    };

    let first = text.lines().next().unwrap_or("").trim().to_string();
    if first.is_empty() {
        Err("ffmpeg printed no version banner".into())
    } else {
        Ok(first)
    }
}
