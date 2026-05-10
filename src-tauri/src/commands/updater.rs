// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Leon Kasdorf

use std::path::PathBuf;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::State;
use tauri_plugin_shell::ShellExt;

use crate::queue::QueueManager;
use crate::ytdlp::runner::ytdlp_sidecar_path;

const RELEASES_API: &str = "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest";
const USER_AGENT: &str = concat!("ytbr-updater/", env!("CARGO_PKG_VERSION"));

#[derive(Debug, Deserialize)]
struct LatestRelease {
    tag_name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateOutcome {
    /// Tag of the just-installed yt-dlp release. Same as `from` if we
    /// were already on it, in which case `replaced` is false.
    pub installed: String,
    /// Version reported by `yt-dlp --version` before this call. `None`
    /// means we couldn't ask (sidecar missing / spawn failure).
    pub from: Option<String>,
    /// Whether the sidecar binary was actually overwritten.
    pub replaced: bool,
}

/// Asset name yt-dlp publishes for the current target plus the path
/// suffix (`.exe` on Windows). The asset name is what shows up in the
/// `SHA2-256SUMS` checksum file — must match the upstream name, not
/// the local rename. Same lesson as `fetch-binaries.{sh,ps1}` learned
/// the hard way (commit b872d31).
fn upstream_asset_name() -> Result<&'static str, String> {
    if cfg!(windows) {
        Ok("yt-dlp.exe")
    } else if cfg!(target_os = "linux") {
        Ok("yt-dlp_linux")
    } else {
        Err("yt-dlp self-update is only wired for Windows and Linux".into())
    }
}

async fn current_ytdlp_version(app: &tauri::AppHandle) -> Option<String> {
    let output = app
        .shell()
        .sidecar("yt-dlp")
        .ok()?
        .args(["--version"])
        .output()
        .await
        .ok()?;
    if output.status.success() {
        Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        None
    }
}

fn parse_sha_for(asset: &str, sums: &str) -> Option<String> {
    for line in sums.lines() {
        let mut parts = line.split_whitespace();
        let hash = parts.next()?;
        let name = parts.next()?;
        if name == asset {
            return Some(hash.to_string());
        }
    }
    None
}

fn hex_sha256(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let digest = hasher.finalize();
    let mut s = String::with_capacity(64);
    for b in digest {
        s.push_str(&format!("{b:02x}"));
    }
    s
}

#[cfg(unix)]
fn ensure_executable(path: &PathBuf) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    let mut perms = std::fs::metadata(path)?.permissions();
    perms.set_mode(0o755);
    std::fs::set_permissions(path, perms)
}

#[cfg(not(unix))]
fn ensure_executable(_path: &PathBuf) -> std::io::Result<()> {
    Ok(())
}

#[tauri::command]
pub async fn update_ytdlp(
    app: tauri::AppHandle,
    queue: State<'_, QueueManager>,
) -> Result<UpdateOutcome, String> {
    if queue.has_active_jobs() {
        return Err(
            "Refusing to update yt-dlp while jobs are queued, downloading, or paused. Cancel or wait for them to finish, then try again."
                .into(),
        );
    }

    let dest: PathBuf = ytdlp_sidecar_path()
        .ok_or_else(|| "could not locate the yt-dlp sidecar to overwrite".to_string())?;

    let asset = upstream_asset_name()?;
    let current = current_ytdlp_version(&app).await;

    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| format!("http client init failed: {e}"))?;

    let release: LatestRelease = client
        .get(RELEASES_API)
        .send()
        .await
        .map_err(|e| format!("github api request failed: {e}"))?
        .error_for_status()
        .map_err(|e| format!("github api status: {e}"))?
        .json()
        .await
        .map_err(|e| format!("github api json: {e}"))?;

    let tag = release.tag_name;

    if current.as_deref() == Some(tag.as_str()) {
        return Ok(UpdateOutcome {
            installed: tag,
            from: current,
            replaced: false,
        });
    }

    let base = format!("https://github.com/yt-dlp/yt-dlp/releases/download/{tag}");
    let asset_url = format!("{base}/{asset}");
    let sums_url = format!("{base}/SHA2-256SUMS");

    let sums_text = client
        .get(&sums_url)
        .send()
        .await
        .map_err(|e| format!("download SHA2-256SUMS failed: {e}"))?
        .error_for_status()
        .map_err(|e| format!("SHA2-256SUMS status: {e}"))?
        .text()
        .await
        .map_err(|e| format!("SHA2-256SUMS body: {e}"))?;

    let expected_sha = parse_sha_for(asset, &sums_text).ok_or_else(|| {
        format!("no SHA-256 entry for upstream asset {asset} in SHA2-256SUMS")
    })?;

    let bytes = client
        .get(&asset_url)
        .send()
        .await
        .map_err(|e| format!("download {asset} failed: {e}"))?
        .error_for_status()
        .map_err(|e| format!("{asset} status: {e}"))?
        .bytes()
        .await
        .map_err(|e| format!("{asset} body: {e}"))?;

    let actual_sha = hex_sha256(&bytes);
    if !actual_sha.eq_ignore_ascii_case(&expected_sha) {
        return Err(format!(
            "SHA-256 mismatch for {asset}: expected {expected_sha}, got {actual_sha}"
        ));
    }

    // Atomic replace via a sibling temp file so a partial write never
    // leaves the sidecar slot empty. std::fs::rename uses MoveFileExW
    // with MOVEFILE_REPLACE_EXISTING on Windows, which is the closest
    // we get to atomic on NTFS.
    let tmp = dest.with_extension("ytbr-update.tmp");
    std::fs::write(&tmp, &bytes).map_err(|e| format!("temp write failed: {e}"))?;
    ensure_executable(&tmp).map_err(|e| format!("chmod +x failed: {e}"))?;
    std::fs::rename(&tmp, &dest).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("rename onto sidecar failed: {e}")
    })?;

    Ok(UpdateOutcome {
        installed: tag,
        from: current,
        replaced: true,
    })
}
