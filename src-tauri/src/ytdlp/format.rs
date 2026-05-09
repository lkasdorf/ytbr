// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Leon Kasdorf

use serde::{Deserialize, Serialize};

// ---------- yt-dlp -J shape (only the fields we consume) ----------

#[derive(Debug, Deserialize)]
pub struct VideoInfo {
    pub id: String,
    pub title: String,
    pub uploader: Option<String>,
    pub duration: Option<f64>,
    pub thumbnail: Option<String>,
    pub formats: Vec<RawFormat>,
}

#[derive(Debug, Deserialize)]
pub struct RawFormat {
    pub format_id: String,
    pub ext: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub fps: Option<f64>,
    #[serde(default = "default_codec")]
    pub vcodec: String,
    #[serde(default = "default_codec")]
    pub acodec: String,
    pub filesize: Option<u64>,
    pub filesize_approx: Option<u64>,
    pub tbr: Option<f64>,
}

fn default_codec() -> String {
    "none".to_string()
}

// ---------- wire shape returned to the frontend ----------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeResult {
    pub id: String,
    pub title: String,
    pub uploader: Option<String>,
    pub duration_secs: Option<f64>,
    pub thumbnail: Option<String>,
    pub formats: Vec<Format>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Format {
    pub format_id: String,
    pub container: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub fps: Option<f64>,
    pub vcodec: String,
    pub acodec: String,
    pub filesize_bytes: Option<u64>,
    pub bitrate_kbps: Option<f64>,
}

impl From<RawFormat> for Format {
    fn from(raw: RawFormat) -> Self {
        Self {
            format_id: raw.format_id,
            container: raw.ext,
            width: raw.width,
            height: raw.height,
            fps: raw.fps,
            vcodec: raw.vcodec,
            acodec: raw.acodec,
            filesize_bytes: raw.filesize.or(raw.filesize_approx),
            bitrate_kbps: raw.tbr,
        }
    }
}

impl From<VideoInfo> for ProbeResult {
    fn from(info: VideoInfo) -> Self {
        Self {
            id: info.id,
            title: info.title,
            uploader: info.uploader,
            duration_secs: info.duration,
            thumbnail: info.thumbnail,
            formats: info.formats.into_iter().map(Format::from).collect(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_minimal_yt_dlp_output() {
        let raw = r#"{
            "id": "abc",
            "title": "demo",
            "formats": [
                {"format_id": "140", "ext": "m4a",
                 "vcodec": "none", "acodec": "mp4a.40.2",
                 "filesize": 100000, "tbr": 128.0},
                {"format_id": "137", "ext": "mp4",
                 "width": 1920, "height": 1080, "fps": 30,
                 "vcodec": "avc1.640028", "acodec": "none",
                 "filesize_approx": 5000000, "tbr": 4500.0}
            ]
        }"#;

        let info: VideoInfo = serde_json::from_str(raw).unwrap();
        let probe: ProbeResult = info.into();

        assert_eq!(probe.id, "abc");
        assert_eq!(probe.formats.len(), 2);

        let audio = &probe.formats[0];
        assert_eq!(audio.container, "m4a");
        assert_eq!(audio.vcodec, "none");
        assert_eq!(audio.filesize_bytes, Some(100_000));

        let video = &probe.formats[1];
        assert_eq!(video.height, Some(1080));
        assert_eq!(video.acodec, "none");
        assert_eq!(video.filesize_bytes, Some(5_000_000)); // from filesize_approx
    }

    #[test]
    fn defaults_missing_codecs_to_none() {
        let raw = r#"{
            "id": "x", "title": "t",
            "formats": [{"format_id": "1", "ext": "mp4"}]
        }"#;

        let info: VideoInfo = serde_json::from_str(raw).unwrap();
        let f = &info.formats[0];
        assert_eq!(f.vcodec, "none");
        assert_eq!(f.acodec, "none");
    }
}
