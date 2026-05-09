---
name: User profile (Leon Kasdorf)
description: Identity and dev environment of the user — name, GitHub handle, OS, project root path, the OneDrive trap
type: user
originSessionId: 502ddcb8-7650-4162-bf85-bdb846566cf8
---
- **Name**: Leon Kasdorf. (The prompt md file says "Leon Stahl" — that's wrong, treat as a placeholder. The user confirmed his real name on 2026-05-10 and chose `dev.leonkasdorf.ytbr` as the bundle identifier.)
- **GitHub**: `lkasdorf` (already authenticated in `gh` CLI on this machine, `repo` scope).
- **Git identity**: `Leon Kasdorf <u53r7@pm.me>`.
- **Org context**: project folder lives under `OneDrive - Kaffon Company Limited`, but YTBR is explicitly a personal project under his name (Apache-2.0, copyright Leon Kasdorf, not Kaffon).
- **Working language**: communicates in German; technical terms stay English. Keep responses German unless he switches.

**Dev environment**
- Windows 11 Pro, PowerShell 7+ via Claude Code's PowerShell tool.
- Project root: `C:\Users\LeonKasdorf\OneDrive - Kaffon Company Limited\16_Projects\YTBR\ytbr\` (note the spaces — quote paths).
- Toolchain installed during Schritt 1: pnpm 11 (via npm), Rust 1.95 stable-msvc (via winget rustup), VS 2022 Build Tools with C++ workload (via winget). All on PATH but a fresh PowerShell session needs a manual PATH refresh — see CLAUDE.md.
- Node 24, npm 11, git 2.53 were already there.

**The OneDrive trap (important)**
The whole project lives in OneDrive. OneDrive's background sync touches file metadata frequently enough that `tauri dev`'s Rust file watcher mistakes it for an edit and rebuilds mid-run, killing in-flight downloads. The user hit this during Iter 1 testing. The accepted workaround is `pnpm tauri dev --no-watch`. If a future task involves heavy dev iteration, suggest `--no-watch` proactively.
