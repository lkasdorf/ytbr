// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Leon Kasdorf

// Heuristics for the Download tab. yt-dlp itself supports ~1800 sites,
// but the redirect-to-Batch banner is just a hint — false negatives
// are fine (user proceeds with the normal probe), false positives
// would be annoying so the patterns stay conservative.
//
// Returned shape:
//   { kind: "channel" }      → bare channel / channel-section URL
//   { kind: "playlist" }     → standalone playlist (?list= without ?v=)
//   { kind: "video-in-playlist" } → /watch?v=…&list=… (might be either)
//   { kind: null }           → looks like a single video, no hint
export type PlaylistHint =
  | { kind: "channel" }
  | { kind: "playlist" }
  | { kind: "video-in-playlist" }
  | { kind: null };

export function detectPlaylistKind(url: string): PlaylistHint {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return { kind: null };
  }

  if (!isYouTubeHost(parsed.hostname)) {
    // Other sites: only redirect on a generic-looking playlist pattern.
    // Most non-YouTube sites use site-specific URL shapes that yt-dlp
    // figures out at probe time — let those flow through.
    return { kind: null };
  }

  const path = parsed.pathname;
  const list = parsed.searchParams.get("list");
  const v = parsed.searchParams.get("v");

  // /channel/UC..., /c/Name, /user/Name, /@handle, plus channel sections
  // (/videos, /streams, /shorts, /playlists, /featured) — anything with
  // an @-handle or /channel root we treat as a channel reference.
  if (
    /^\/@[^/]+/.test(path) ||
    path.startsWith("/channel/") ||
    path.startsWith("/c/") ||
    path.startsWith("/user/")
  ) {
    return { kind: "channel" };
  }

  // /playlist?list=...
  if (path === "/playlist" && list) {
    return { kind: "playlist" };
  }

  // /watch?v=...&list=...  — single video inside a playlist. The
  // user might want either the one video (Download tab) or the
  // whole list (Batch tab); show the hint, don't redirect.
  if (path === "/watch" && v && list) {
    return { kind: "video-in-playlist" };
  }

  return { kind: null };
}

function isYouTubeHost(host: string): boolean {
  const h = host.toLowerCase();
  return (
    h === "youtube.com" ||
    h === "www.youtube.com" ||
    h === "m.youtube.com" ||
    h === "music.youtube.com" ||
    h === "youtu.be"
  );
}
