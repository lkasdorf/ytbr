// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Leon Kasdorf

use tauri_plugin_shell::ShellExt;

use crate::error::AppError;
use crate::ytdlp::format::{ProbeResult, VideoInfo};

#[tauri::command]
pub async fn probe_url(app: tauri::AppHandle, url: String) -> Result<ProbeResult, AppError> {
    // TODO: drop --no-playlist when playlist support lands. yt-dlp -J emits
    // a different shape for playlists (entries[]) that the current
    // VideoInfo struct doesn't model.
    let output = app
        .shell()
        .sidecar("yt-dlp")
        .map_err(|e| AppError::Sidecar(e.to_string()))?
        .args([
            "-J",
            "--no-playlist",
            "--no-warnings",
            url.as_str(),
        ])
        .output()
        .await
        .map_err(|e| AppError::Sidecar(e.to_string()))?;

    if !output.status.success() {
        return Err(AppError::YtdlpExit(
            String::from_utf8_lossy(&output.stderr)
                .trim()
                .to_string(),
        ));
    }

    let info: VideoInfo = serde_json::from_slice(&output.stdout)?;
    Ok(info.into())
}
