// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Leon Kasdorf

use serde::Serialize;

// yt-dlp `--progress-template` line we ask for:
//   PROG|<downloaded>|<total>|<speed>|<eta>|<status>
// Unknown numeric fields render as "NA".
pub const TEMPLATE: &str = "PROG|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.speed)s|%(progress.eta)s|%(progress.status)s";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobProgress {
    pub percent: f64,
    pub speed_bps: Option<f64>,
    pub eta_secs: Option<u64>,
    pub downloaded_bytes: Option<u64>,
    pub total_bytes: Option<u64>,
}

pub fn parse(line: &str) -> Option<JobProgress> {
    let body = line.strip_prefix("PROG|")?;
    let parts: Vec<&str> = body.split('|').collect();
    if parts.len() < 5 {
        return None;
    }

    let downloaded = parse_opt_u64(parts[0]);
    let total = parse_opt_u64(parts[1]);
    let speed = parse_opt_f64(parts[2]);
    let eta = parse_opt_u64(parts[3]);
    // parts[4] is the status string ("downloading" / "finished" / ...);
    // the queue layer cares about exit code instead, so we drop it here.

    let percent = match (downloaded, total) {
        (Some(d), Some(t)) if t > 0 => (d as f64 / t as f64) * 100.0,
        _ => 0.0,
    };

    Some(JobProgress {
        percent,
        speed_bps: speed,
        eta_secs: eta,
        downloaded_bytes: downloaded,
        total_bytes: total,
    })
}

fn parse_opt_u64(s: &str) -> Option<u64> {
    if s == "NA" || s.is_empty() {
        None
    } else {
        // yt-dlp sometimes emits decimals here (e.g. "1024.0"); truncate.
        s.parse::<f64>().ok().map(|v| v as u64)
    }
}

fn parse_opt_f64(s: &str) -> Option<f64> {
    if s == "NA" || s.is_empty() {
        None
    } else {
        s.parse().ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_full_progress_line() {
        let line = "PROG|524288|10485760|123456.78|45|downloading";
        let p = parse(line).unwrap();
        assert_eq!(p.downloaded_bytes, Some(524288));
        assert_eq!(p.total_bytes, Some(10485760));
        assert_eq!(p.speed_bps, Some(123456.78));
        assert_eq!(p.eta_secs, Some(45));
        assert!((p.percent - 5.0).abs() < 0.01);
    }

    #[test]
    fn handles_na_values() {
        let line = "PROG|NA|NA|NA|NA|downloading";
        let p = parse(line).unwrap();
        assert_eq!(p.downloaded_bytes, None);
        assert_eq!(p.total_bytes, None);
        assert_eq!(p.speed_bps, None);
        assert_eq!(p.eta_secs, None);
        assert_eq!(p.percent, 0.0);
    }

    #[test]
    fn ignores_non_progress_lines() {
        assert!(parse("[download] Destination: file.mp4").is_none());
        assert!(parse("").is_none());
        assert!(parse("PROG|").is_none()); // too few fields
    }

    #[test]
    fn tolerates_decimal_byte_counts() {
        // yt-dlp occasionally emits "1024.0" rather than "1024" for byte counts.
        let line = "PROG|1024.0|2048.0|NA|NA|downloading";
        let p = parse(line).unwrap();
        assert_eq!(p.downloaded_bytes, Some(1024));
        assert_eq!(p.total_bytes, Some(2048));
        assert!((p.percent - 50.0).abs() < 0.01);
    }
}
