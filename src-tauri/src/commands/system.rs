// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Leon Kasdorf

use std::path::Path;

use tauri_plugin_opener::OpenerExt;
use tauri_plugin_shell::ShellExt;

/// Hard cap on the size of a .txt file the drag-drop handler will read.
/// 1 MiB is roughly 30k average-length URLs — far past any realistic
/// batch — and small enough that an accidentally-dropped binary file
/// can't blow up memory while we wait for the parse to fail.
const READ_TXT_MAX_BYTES: u64 = 1024 * 1024;

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

/// Read a .txt file's contents for the drag-drop URL importer.
/// Restricted to `.txt` suffix (case-insensitive) and a 1 MiB hard
/// cap so a stray binary drop can't load tens of MBs into memory
/// before the URL regex throws it all away.
#[tauri::command]
pub async fn read_txt_for_drop(path: String) -> Result<String, String> {
    let p = Path::new(&path);
    let ext_ok = p
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.eq_ignore_ascii_case("txt"))
        .unwrap_or(false);
    if !ext_ok {
        return Err("only .txt files are accepted".into());
    }
    let meta = tokio::fs::metadata(p)
        .await
        .map_err(|e| format!("stat failed: {e}"))?;
    if meta.len() > READ_TXT_MAX_BYTES {
        return Err(format!(
            "file is {} bytes, max is {READ_TXT_MAX_BYTES}",
            meta.len()
        ));
    }
    tokio::fs::read_to_string(p)
        .await
        .map_err(|e| format!("read failed: {e}"))
}
