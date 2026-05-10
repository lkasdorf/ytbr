// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Leon Kasdorf

use serde::{Deserialize, Serialize};
use tauri_plugin_shell::ShellExt;

use crate::error::AppError;
use crate::ytdlp::format::{ProbeResult, VideoInfo};

#[tauri::command]
pub async fn probe_url(app: tauri::AppHandle, url: String) -> Result<ProbeResult, AppError> {
    // The Download tab is single-video by design; playlist URLs are
    // expanded in the Batch tab via `expand_playlist` below. Until the
    // Download tab grows a playlist mode, keep --no-playlist so a
    // playlist URL pasted here resolves to "the first video" instead
    // of failing the VideoInfo parse.
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

/// Wire shape for `expand_playlist`. `title` is `None` when the URL
/// resolved to a single video — caller can still queue the one entry
/// instead of erroring out.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistEntries {
    pub title: Option<String>,
    pub entries: Vec<String>,
}

#[derive(Deserialize)]
struct FlatPlaylist {
    #[serde(rename = "_type")]
    type_: Option<String>,
    title: Option<String>,
    #[serde(default)]
    entries: Vec<FlatEntry>,
    webpage_url: Option<String>,
    url: Option<String>,
}

#[derive(Deserialize)]
struct FlatEntry {
    webpage_url: Option<String>,
    url: Option<String>,
}

/// Resolve a playlist URL to its entries' watch URLs without probing
/// each entry's formats. Used by the Batch tab to seed many jobs from
/// a single playlist link. Single-video URLs come back as a one-entry
/// list with `title: null` — the caller treats them the same way.
///
/// Channel URLs: a `https://youtube.com/@channel/videos`-style URL
/// expands cleanly into the channel's video list. A bare
/// `https://youtube.com/@channel` URL flat-expands into the channel's
/// *sub-playlists* (Videos, Shorts, Live), which the runner can't
/// download as-is because it always passes `--no-playlist`. Append
/// `/videos` (or `/streams`, `/shorts`) for predictable behavior.
#[tauri::command]
pub async fn expand_playlist(
    app: tauri::AppHandle,
    url: String,
) -> Result<PlaylistEntries, AppError> {
    let output = app
        .shell()
        .sidecar("yt-dlp")
        .map_err(|e| AppError::Sidecar(e.to_string()))?
        .args([
            "--flat-playlist",
            "--dump-single-json",
            "--no-warnings",
            url.as_str(),
        ])
        .output()
        .await
        .map_err(|e| AppError::Sidecar(e.to_string()))?;

    if !output.status.success() {
        return Err(AppError::YtdlpExit(
            String::from_utf8_lossy(&output.stderr).trim().to_string(),
        ));
    }

    let info: FlatPlaylist = serde_json::from_slice(&output.stdout)?;

    if info.type_.as_deref() == Some("playlist") {
        let entries = info
            .entries
            .into_iter()
            .filter_map(|e| e.webpage_url.or(e.url))
            .filter(|s| !s.trim().is_empty())
            .collect();
        Ok(PlaylistEntries {
            title: info.title,
            entries,
        })
    } else {
        // Single-video URL fed to a playlist-style probe — return the
        // canonical webpage_url if yt-dlp surfaced one, otherwise the
        // URL the caller passed in.
        let resolved = info.webpage_url.or(info.url).unwrap_or(url);
        Ok(PlaylistEntries {
            title: None,
            entries: vec![resolved],
        })
    }
}
