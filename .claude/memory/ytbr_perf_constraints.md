---
name: YTBR performance constraints
description: Hard non-functional requirements for the ytbr Tauri app — startup speed and overall leanness — that should weight design decisions
type: feedback
originSessionId: 502ddcb8-7650-4162-bf85-bdb846566cf8
---
The YTBR project has explicit performance non-functional requirements that the user reinforced beyond what's in the prompt spec:

- Cold-start under 1.5 s on a modern laptop (per prompt)
- Installer size: <10 MB without sidecars, <80 MB with sidecars (per prompt)
- App must remain lean overall — user repeated this on 2026-05-10

**Why:** the user is building a polished native-feel desktop tool (Tauri choice over Electron is itself this signal). Slow startup or bloated install are dealbreakers. The bundled LGPL ffmpeg from BtbN is already 164 MB on its own, blowing the <80 MB target — that's an open issue to address before release.

**How to apply:**
- Avoid heavy npm dependencies for things solvable with ~50 lines (e.g., picked native table over TanStack Table for MVP)
- Avoid Rust deps that pull large transitive trees when a small one suffices
- Don't add splash screens or "warming up" patterns to mask startup — make it actually fast
- Lazy-load heavy frontend code (charts, icons in bulk imports) once we get past MVP
- For ffmpeg specifically: investigate slimmer LGPL builds (essentials variant, custom-compiled without unused codecs) before shipping
- When tempted to add a feature flag / abstraction "for flexibility," default to the simpler concrete path and only abstract when a second concrete need exists
