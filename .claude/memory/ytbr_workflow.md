---
name: YTBR workflow preferences
description: How Leon wants to drive YTBR development — checkpointing rhythm, question style, commit cadence
type: feedback
originSessionId: 502ddcb8-7650-4162-bf85-bdb846566cf8
---
**Stop after each major step and show the state.** Per the prompt's "Vorgehen" closing line and reinforced behaviorally throughout the session. Don't roll multiple Schritte into one push without a visible pause for review — even when momentum tempts otherwise.
- Why: the project is being scaffolded under his observation; he reviews diffs and asks clarifying questions between steps.
- How to apply: at the end of a numbered step from the prompt, summarize what landed, list any deferred work, then ask what's next instead of barreling forward.

**Ask one question at a time when in doubt.** Explicit feedback on 2026-05-09: "Stelle mir die Fragen einzeln". Batched `AskUserQuestion` calls felt like a wall.
- Why: he answers conversationally and a multi-question prompt mixes signal.
- How to apply: only batch into a single `AskUserQuestion` call when the questions are tightly coupled (e.g. "X scope + commit message style" together). Otherwise serialize them.

**Commit at logical boundaries with rich messages.** He confirmed the `feat(scope): one-liner + multi-paragraph body` pattern and accepts the Co-Authored-By Claude trailer. Pushes happen on his explicit "ja, commit and push" or equivalent — never silently.
- Why: keeps `main` clean and the commit log usable as a project diary.
- How to apply: before committing, check `git status --short`; in the message body explain *why* and call out anything surprising (the Iter 1 commits are a good template). Push only after confirmation.

**Future-of-feature notes mid-session.** He drops them while you're working — e.g. "Playlists sollen auch möglich sein (evtl. später)" and "App soll möglichst schnell starten und schlank sein". Treat these as inputs to the backlog memory and any TODO comments in the affected files, not as an immediate-fix demand.
- Why: he thinks ahead while the current task is in flight.
- How to apply: acknowledge, save to backlog memory (or update `ytbr_perf_constraints.md` if NFR-shaped), drop a TODO in the relevant code, then continue the in-flight task.

**Concise German, technical English.** Default to German prose; keep API/CLI/code identifiers in English. Don't over-explain — he picks up implications from short sentences.

**Update CHANGELOG.md inline, not just at session end.** Convention adopted on 2026-05-10 alongside the `/end-session` skill. Every commit that ships user-facing or notable internal change should also touch `CHANGELOG.md` under `[Unreleased]` (Keep a Changelog 1.1.0 categories: Added / Changed / Deprecated / Removed / Fixed / Security, plus `Notes` for caveats). The skill is the safety net, not the primary path.
- Why: the changelog is consumed by future Leon and external readers; doing it inline keeps the wording grounded in the change while it's fresh.
- How to apply: when a feat/fix commit is being prepared, glance at CHANGELOG.md — if the change isn't already mentioned in `[Unreleased]`, add a bullet in the same commit.

**Memories live in two places, kept in sync.** Source of truth is `~/.claude/projects/<hash>/memory/` (auto-loaded). A versioned copy lives at `<repo>/.claude/memory/`. The `/end-session` skill is responsible for the sync — manual edits should still go through the live dir first, then get mirrored.
- Why: the user wants memory state visible on the public repo and to survive a fresh clone, but Claude Code's auto-memory only reads from the user-side path.
- How to apply: after editing memory files, copy them into `<repo>/.claude/memory/` (overwrite). On a fresh clone, manually seed `~/.claude/projects/<hash>/memory/` from the repo copy before the first session.

**Only memory is versioned, skills and settings stay user-local.** Confirmed on 2026-05-10. The `.gitignore` excludes everything under `.claude/` except `.claude/memory/`. The `/end-session` skill itself lives at `~/.claude/skills/end-session/SKILL.md` (user-global), not in the repo.
- Why: the user wants the repo to stay focused on the app — Claude tooling is personal.
- How to apply: when adding new Claude artifacts (skills, hooks, settings), put them under `~/.claude/`, not in the project. If a future case actually needs project-shared Claude config, ask the user first before changing the .gitignore.
