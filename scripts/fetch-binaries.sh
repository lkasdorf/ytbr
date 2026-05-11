#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Copyright (c) 2026 Leon Kasdorf
#
# Downloads yt-dlp and the LGPL build of ffmpeg for the given Rust
# target triple and stages them in src-tauri/binaries/ with the Tauri
# sidecar naming convention (<name>-<triple>{.exe}). Hash-verifies
# downloads where upstream publishes a checksum file.
#
# Usage:
#   ./scripts/fetch-binaries.sh                       # host target
#   ./scripts/fetch-binaries.sh x86_64-unknown-linux-gnu

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BIN_DIR="$REPO_ROOT/src-tauri/binaries"
WORK_DIR="$(mktemp -d -t ytbr-fetch.XXXXXX)"
trap 'rm -rf "$WORK_DIR"' EXIT

target="${1:-}"
if [ -z "$target" ]; then
  if ! command -v rustc >/dev/null 2>&1; then
    echo "rustc not found on PATH. Install Rust or pass a target as the first arg." >&2
    exit 1
  fi
  target="$(rustc -vV | awk '/^host:/ {print $2}')"
fi

# UPX is pinned for reproducible compression of the ffmpeg sidecar.
# Bump UPX_VERSION when upstream ships a fix you need.
UPX_VERSION="5.0.2"

# yt-dlp ships a new dated tag every few weeks. The `latest/download`
# redirect points at whichever tag is current *right now*, so a release
# happening between our binary fetch and our SHA2-256SUMS fetch makes
# the redirect resolve to two different tags — and the hash check
# silently rejects a perfectly fine binary. Resolve "latest" to a
# concrete tag once and pin every subsequent URL to it.
ytdlp_tag="$(
  curl -fsSL --retry 3 --retry-delay 2 \
    "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest" \
    | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
    | head -n 1
)"
if [ -z "$ytdlp_tag" ]; then
  echo "Failed to resolve yt-dlp latest tag from GitHub API" >&2
  exit 1
fi
echo "[yt-dlp] tag: $ytdlp_tag"

# BtbN/FFmpeg-Builds uses a literal `latest` tag they keep republishing,
# and they ship a single per-release `checksums.sha256` (not per-file
# `.sha256` siblings), so the existing script never verified ffmpeg's
# hash anyway. We accept that and just trust the latest/download
# redirect for ffmpeg — each fetch is internally consistent.

case "$target" in
  x86_64-pc-windows-msvc)
    ytdlp_url="https://github.com/yt-dlp/yt-dlp/releases/download/${ytdlp_tag}/yt-dlp.exe"
    ytdlp_sha_url="https://github.com/yt-dlp/yt-dlp/releases/download/${ytdlp_tag}/SHA2-256SUMS"
    ytdlp_name="yt-dlp.exe"
    ffmpeg_url="https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-lgpl.zip"
    ffmpeg_name="ffmpeg.exe"
    ffprobe_name="ffprobe.exe"
    suffix=".exe"
    upx_url="https://github.com/upx/upx/releases/download/v${UPX_VERSION}/upx-${UPX_VERSION}-win64.zip"
    upx_name="upx.exe"
    ;;
  x86_64-unknown-linux-gnu)
    ytdlp_url="https://github.com/yt-dlp/yt-dlp/releases/download/${ytdlp_tag}/yt-dlp_linux"
    ytdlp_sha_url="https://github.com/yt-dlp/yt-dlp/releases/download/${ytdlp_tag}/SHA2-256SUMS"
    ytdlp_name="yt-dlp"
    ffmpeg_url="https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-linux64-lgpl.tar.xz"
    ffmpeg_name="ffmpeg"
    ffprobe_name="ffprobe"
    suffix=""
    upx_url="https://github.com/upx/upx/releases/download/v${UPX_VERSION}/upx-${UPX_VERSION}-amd64_linux.tar.xz"
    upx_name="upx"
    ;;
  *)
    echo "Unsupported target triple: $target" >&2
    exit 1
    ;;
esac

mkdir -p "$BIN_DIR"

dl() {
  curl -fsSL --retry 3 --retry-delay 2 -o "$2" "$1"
}

# ---------- yt-dlp ----------
echo "[yt-dlp] $ytdlp_url"
dl "$ytdlp_url" "$WORK_DIR/$ytdlp_name"

# SHA2-256SUMS lists yt-dlp (Python source), yt-dlp.exe, yt-dlp_linux
# etc. as separate rows. We must match the upstream asset name from
# the URL, not the local-rename `$ytdlp_name` (which collapses to
# `yt-dlp` on Linux and would silently pick the Python source row).
ytdlp_asset="$(basename "$ytdlp_url")"

if dl "$ytdlp_sha_url" "$WORK_DIR/SHA2-256SUMS" 2>/dev/null; then
  expected="$(awk -v n="$ytdlp_asset" '$2==n {print $1; exit}' "$WORK_DIR/SHA2-256SUMS")"
  if [ -n "$expected" ]; then
    actual="$(sha256sum "$WORK_DIR/$ytdlp_name" | awk '{print $1}')"
    if [ "$actual" != "$expected" ]; then
      echo "yt-dlp hash mismatch: expected $expected got $actual" >&2
      exit 1
    fi
    echo "[yt-dlp] sha256 ok (${actual:0:12}...)"
  else
    echo "[yt-dlp] SHA2-256SUMS did not contain $ytdlp_asset; skipping verify" >&2
  fi
else
  echo "[yt-dlp] SHA2-256SUMS download failed; skipping verify" >&2
fi

cp -f "$WORK_DIR/$ytdlp_name" "$BIN_DIR/yt-dlp-${target}${suffix}"
chmod +x "$BIN_DIR/yt-dlp-${target}${suffix}" || true

# ---------- ffmpeg ----------
ffmpeg_archive="$WORK_DIR/$(basename "$ffmpeg_url")"
echo "[ffmpeg] $ffmpeg_url"
dl "$ffmpeg_url" "$ffmpeg_archive"

if dl "${ffmpeg_url}.sha256" "${ffmpeg_archive}.sha256" 2>/dev/null; then
  expected="$(awk '{print $1}' "${ffmpeg_archive}.sha256")"
  actual="$(sha256sum "$ffmpeg_archive" | awk '{print $1}')"
  if [ "$actual" != "$expected" ]; then
    echo "ffmpeg hash mismatch: expected $expected got $actual" >&2
    exit 1
  fi
  echo "[ffmpeg] sha256 ok (${actual:0:12}...)"
else
  echo "[ffmpeg] sidecar .sha256 not published; skipping verify" >&2
fi

extract_dir="$WORK_DIR/ffmpeg-extract"
mkdir -p "$extract_dir"

case "$ffmpeg_archive" in
  *.zip)    unzip -q "$ffmpeg_archive" -d "$extract_dir" ;;
  *.tar.xz) tar -xJf "$ffmpeg_archive" -C "$extract_dir" ;;
  *)        echo "Unknown archive format: $ffmpeg_archive" >&2; exit 1 ;;
esac

ffmpeg_path="$(find "$extract_dir" -type f -name "$ffmpeg_name" | head -n 1)"
if [ -z "$ffmpeg_path" ]; then
  echo "ffmpeg binary $ffmpeg_name not found inside archive" >&2
  exit 1
fi
# ffprobe ships in the same BtbN archive next to ffmpeg. yt-dlp needs
# it for any postprocessing path that inspects streams (muxing
# video+audio, --extract-audio, --embed-metadata, ...). When yt-dlp
# gets --ffmpeg-location <file>, it auto-discovers ffprobe in the same
# directory under the literal name "ffprobe" (or ".exe"). So we stage
# two copies: the triple-suffixed one for the Tauri sidecar manifest,
# and a bare-named sibling for yt-dlp's auto-discover to pick up at
# runtime.
ffprobe_path="$(find "$extract_dir" -type f -name "$ffprobe_name" | head -n 1)"
if [ -z "$ffprobe_path" ]; then
  echo "ffprobe binary $ffprobe_name not found inside archive" >&2
  exit 1
fi

# ---------- upx (compress ffmpeg in place) ----------
# BtbN's LGPL ffmpeg ships ~164 MB statically linked. UPX --best --lzma
# cuts it to ~50-60 MB at the cost of a small startup decompress hit
# (irrelevant: ffmpeg is launched on demand, not on app boot).
upx_archive="$WORK_DIR/$(basename "$upx_url")"
upx_extract="$WORK_DIR/upx"
mkdir -p "$upx_extract"
echo "[upx] $upx_url"
dl "$upx_url" "$upx_archive"
case "$upx_archive" in
  *.zip)    unzip -q "$upx_archive" -d "$upx_extract" ;;
  *.tar.xz) tar -xJf "$upx_archive" -C "$upx_extract" ;;
  *)        echo "Unknown upx archive format: $upx_archive" >&2; exit 1 ;;
esac
upx_bin="$(find "$upx_extract" -type f -name "$upx_name" | head -n 1)"
if [ -z "$upx_bin" ]; then
  echo "upx binary not found inside archive" >&2
  exit 1
fi
chmod +x "$upx_bin" || true
before_bytes="$(stat -c %s "$ffmpeg_path" 2>/dev/null || stat -f %z "$ffmpeg_path")"
echo "[upx] compressing ffmpeg ($((before_bytes / 1024 / 1024)) MB) with --best --lzma ..."
"$upx_bin" --best --lzma --quiet "$ffmpeg_path"
after_bytes="$(stat -c %s "$ffmpeg_path" 2>/dev/null || stat -f %z "$ffmpeg_path")"
echo "[upx] $((before_bytes / 1024 / 1024)) MB -> $((after_bytes / 1024 / 1024)) MB"

probe_before_bytes="$(stat -c %s "$ffprobe_path" 2>/dev/null || stat -f %z "$ffprobe_path")"
echo "[upx] compressing ffprobe ($((probe_before_bytes / 1024 / 1024)) MB) with --best --lzma ..."
"$upx_bin" --best --lzma --quiet "$ffprobe_path"
probe_after_bytes="$(stat -c %s "$ffprobe_path" 2>/dev/null || stat -f %z "$ffprobe_path")"
echo "[upx] $((probe_before_bytes / 1024 / 1024)) MB -> $((probe_after_bytes / 1024 / 1024)) MB"

cp -f "$ffmpeg_path" "$BIN_DIR/ffmpeg-${target}${suffix}"
chmod +x "$BIN_DIR/ffmpeg-${target}${suffix}" || true
# Stage ffprobe twice — see the comment next to the extract step.
cp -f "$ffprobe_path" "$BIN_DIR/ffprobe-${target}${suffix}"
chmod +x "$BIN_DIR/ffprobe-${target}${suffix}" || true
cp -f "$ffprobe_path" "$BIN_DIR/$ffprobe_name"
chmod +x "$BIN_DIR/$ffprobe_name" || true

echo ""
echo "Staged in $BIN_DIR for triple $target :"
ls -lh "$BIN_DIR" | awk -v t="$target" '$0 ~ t {printf "  %s  (%s)\n", $9, $5}'
