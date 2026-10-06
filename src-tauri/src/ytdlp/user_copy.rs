// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Leon Kasdorf

use std::cmp::Ordering;

use tauri::AppHandle;
use tauri_plugin_shell::process::Command;
use tauri_plugin_shell::ShellExt;

use crate::ytdlp::runner::user_ytdlp_path;

/// The in-app updater drops yt-dlp into the per-user data dir, and that
/// copy shadows the bundled sidecar (see `runner::ytdlp_command`). Once a
/// later YTBR release ships a bundled yt-dlp that is at least as new, the
/// user copy is just a stale override — delete it so the bundled one is
/// used again. A user copy that can't even report its version is broken
/// and gets removed too.
///
/// Runs once at startup in the background. Errors are swallowed: the
/// worst case is that the user copy stays in place, which is the
/// pre-check behavior. Deleting fails harmlessly on Windows if a
/// rehydrated job already spawned that exe.
pub async fn prune_stale(app: AppHandle) {
    let Some(path) = user_ytdlp_path(&app).filter(|p| p.is_file()) else {
        return;
    };

    let user = version_of(app.shell().command(&path)).await;
    let keep = match user.as_deref() {
        None => false,
        Some(user) => {
            let bundled = match app.shell().sidecar("yt-dlp") {
                Ok(cmd) => version_of(cmd).await,
                Err(_) => None,
            };
            match bundled {
                // Can't ask the bundled copy → the user copy is the only
                // working one we know of; keep it.
                None => true,
                // Unparseable versions → don't guess, keep the user copy.
                Some(bundled) => {
                    compare_versions(user, &bundled).map_or(true, |o| o == Ordering::Greater)
                }
            }
        }
    };

    if !keep {
        let _ = std::fs::remove_file(&path);
    }
}

async fn version_of(cmd: Command) -> Option<String> {
    let output = cmd.args(["--version"]).output().await.ok()?;
    if !output.status.success() {
        return None;
    }
    let v = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (!v.is_empty()).then_some(v)
}

/// yt-dlp versions are dot-separated numbers: `2026.03.17` for stable,
/// `2026.03.17.123456` for nightly builds. Compared component-wise, so a
/// nightly sorts after the stable release of the same day. `None` when
/// either side isn't in that shape.
fn compare_versions(a: &str, b: &str) -> Option<Ordering> {
    let parse = |s: &str| -> Option<Vec<u64>> {
        s.trim().split('.').map(|p| p.parse::<u64>().ok()).collect()
    };
    Some(parse(a)?.cmp(&parse(b)?))
}

#[cfg(test)]
mod tests {
    use super::compare_versions;
    use std::cmp::Ordering::*;

    #[test]
    fn compares_stable_dates() {
        assert_eq!(compare_versions("2026.10.01", "2026.03.17"), Some(Greater));
        assert_eq!(compare_versions("2026.03.17", "2026.10.01"), Some(Less));
        assert_eq!(compare_versions("2026.03.17", "2026.03.17"), Some(Equal));
    }

    #[test]
    fn nightly_sorts_after_same_day_stable() {
        assert_eq!(compare_versions("2026.03.17.123456", "2026.03.17"), Some(Greater));
    }

    #[test]
    fn numeric_not_lexicographic() {
        assert_eq!(compare_versions("2026.3.9", "2026.3.17"), Some(Less));
    }

    #[test]
    fn rejects_garbage() {
        assert_eq!(compare_versions("unknown", "2026.03.17"), None);
        assert_eq!(compare_versions("2026.03.17", ""), None);
    }
}
