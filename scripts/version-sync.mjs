// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Leon Kasdorf
//
// version-sync — keep the three places that hold the app version in lockstep.
//
//   node scripts/version-sync.mjs            # check (exit 1 on mismatch)
//   node scripts/version-sync.mjs 0.3.0      # bump all three to 0.3.0
//
// Three manifests, one source of truth. Edits are regex-based so existing
// formatting (key order, indentation, comments) is preserved verbatim.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Cargo.toml has many `version = "..."` lines (one per dep) — anchor to the
// [package] section so we only ever touch the package version.
const TARGETS = [
  {
    label: "package.json",
    path: join(ROOT, "package.json"),
    pattern: /^(\s*"version"\s*:\s*")([^"]+)(")/m,
  },
  {
    label: "src-tauri/Cargo.toml",
    path: join(ROOT, "src-tauri", "Cargo.toml"),
    pattern: /(\[package\][\s\S]*?\nversion\s*=\s*")([^"]+)(")/,
  },
  {
    label: "src-tauri/tauri.conf.json",
    path: join(ROOT, "src-tauri", "tauri.conf.json"),
    pattern: /^(\s*"version"\s*:\s*")([^"]+)(")/m,
  },
];

const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;

function read(target) {
  const text = readFileSync(target.path, "utf8");
  const match = text.match(target.pattern);
  if (!match) {
    throw new Error(`could not find a version field in ${target.label}`);
  }
  return { ...target, text, version: match[2] };
}

function check(found) {
  for (const f of found) {
    console.log(`  ${f.version.padEnd(12)}  ${relative(ROOT, f.path)}`);
  }
  const distinct = new Set(found.map((f) => f.version));
  if (distinct.size === 1) {
    console.log(`\n[ok] all three pinned to ${[...distinct][0]}`);
    return 0;
  }
  console.error(`\n[mismatch] ${distinct.size} distinct versions across the three manifests`);
  return 1;
}

function bump(found, next) {
  if (!SEMVER.test(next)) {
    console.error(`[error] "${next}" is not a SemVer string (e.g. 0.3.0 or 1.0.0-rc.1)`);
    return 2;
  }
  const distinct = new Set(found.map((f) => f.version));
  if (distinct.size !== 1) {
    console.error(
      `[abort] manifests are out of sync (${[...distinct].join(", ")}). Resolve by hand before bumping.`,
    );
    return 1;
  }
  const from = [...distinct][0];
  if (from === next) {
    console.log(`[noop] already at ${next}`);
    return 0;
  }
  for (const f of found) {
    const updated = f.text.replace(f.pattern, `$1${next}$3`);
    writeFileSync(f.path, updated);
    console.log(`  ${from} → ${next}  ${relative(ROOT, f.path)}`);
  }
  console.log(`\n[ok] bumped to ${next}`);
  return 0;
}

const arg = process.argv[2];
const found = TARGETS.map(read);
process.exit(arg ? bump(found, arg) : check(found));
