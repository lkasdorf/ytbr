---
name: YTBR external references
description: Where to find the live spec, repo, and key upstream sources for YTBR
type: reference
originSessionId: 502ddcb8-7650-4162-bf85-bdb846566cf8
---
**Repository**: https://github.com/lkasdorf/ytbr (public, default branch `main`). Authenticated as `lkasdorf` in `gh` CLI on this machine.

**Live project root**: `C:\Users\LeonKasdorf\OneDrive - Kaffon Company Limited\16_Projects\YTBR\ytbr\` — paths have spaces, always quote.

**Project spec / original prompt**: `C:\Users\LeonKasdorf\OneDrive - Kaffon Company Limited\16_Projects\YTBR\claude-code-prompt-ytdlp-tauri.md` (the parent of the repo, intentionally NOT committed). Treat as the authoritative requirements doc — the user explicitly chose to keep it out of the repo. When in doubt about a feature's scope or wording, this file is the source of truth.

**In-repo dev guide**: `ytbr/CLAUDE.md` — commands, architecture, gotchas. Auto-loaded when a Claude Code session opens in `ytbr/` or below.

**Upstream sidecar sources** (used by `scripts/fetch-binaries.{ps1,sh}`):
- yt-dlp releases + SHA2-256SUMS: https://github.com/yt-dlp/yt-dlp/releases/latest
- ffmpeg LGPL builds (BtbN, no per-file `.sha256` published — hash verify is best-effort): https://github.com/BtbN/FFmpeg-Builds/releases/latest

**Tauri 2 reference docs** (consult before changing capability/plugin shapes — Tauri 2 changed several things vs v1, including the shell plugin scope location, sidecar lookup, and plugin config):
- Capability schema: https://schema.tauri.app/config/2
- Shell plugin: https://v2.tauri.app/plugin/shell/

**License-text generation tooling** (for the not-yet-built THIRD_PARTY_LICENSES.md):
- Rust: `cargo about` (config in `about.toml`, allowlist of permissive licenses)
- npm: `license-checker-rseidelsohn` with `--failOn 'GPL;AGPL;LGPL'` (LGPL allowed only for ffmpeg sidecar, not in the JS bundle)
