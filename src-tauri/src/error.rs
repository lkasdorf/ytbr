// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Leon Kasdorf

use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("sidecar invocation failed: {0}")]
    Sidecar(String),

    #[error("yt-dlp exited non-zero: {0}")]
    YtdlpExit(String),

    #[error("failed to parse yt-dlp output: {0}")]
    Json(#[from] serde_json::Error),
}

// Tauri commands need errors to be Serialize. Marshal as a plain string —
// the frontend just renders the message; richer typing isn't worth the
// bookkeeping yet.
impl serde::Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}
