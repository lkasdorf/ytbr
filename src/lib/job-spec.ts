// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Leon Kasdorf

import type { JobSpec } from "@/lib/tauri-bridge";
import { useSettingsStore } from "@/stores/settings";

export interface JobRequest {
  url: string;
  /// Known video title (from a probe), if any.
  title?: string | null;
  /// Raw yt-dlp `-f` selector.
  formatId: string;
  /// What the queue card shows instead of the selector.
  formatLabel: string;
  outputDir: string;
  /// Audio-only download. The audio-format setting is applied to these
  /// alone — `--extract-audio` on a video selector strips the video.
  audioOnly: boolean;
}

// The one place a download request plus the current Settings become a
// JobSpec, shared by the Download and Batch tabs so a new setting can't
// be wired into one and forgotten in the other. Settings are read at
// call time: the spec is a snapshot, later changes don't touch jobs
// that are already queued.
export function buildJobSpec({
  url,
  title,
  formatId,
  formatLabel,
  outputDir,
  audioOnly,
}: JobRequest): JobSpec {
  const s = useSettingsStore.getState();
  return {
    url,
    title: title ?? null,
    formatId,
    formatLabel,
    outputDir,
    outputTemplate: s.outputTemplate,
    cookiesFromBrowser: s.cookiesFromBrowser,
    cookiesFile: s.cookiesFile,
    ffmpegLocation: s.ffmpegPath,
    writeSubs: s.writeSubs,
    subLangs: s.subLangs,
    writeAutoSubs: s.writeAutoSubs,
    embedSubs: s.embedSubs,
    embedThumbnail: s.embedThumbnail,
    squareThumbnail: s.squareThumbnail,
    embedMetadata: s.embedMetadata,
    writeThumbnail: s.writeThumbnail,
    writeInfoJson: s.writeInfoJson,
    downloadArchive: s.useDownloadArchive,
    restrictFilenames: s.restrictFilenames,
    rateLimit: s.rateLimit,
    proxy: s.proxy,
    extractorArgs: s.extractorArgs,
    concurrentFragments: s.concurrentFragments,
    retries: s.retries,
    fragmentRetries: s.fragmentRetries,
    audioFormat: audioOnly && s.audioFormat !== "default" ? s.audioFormat : null,
    sponsorblockMode: s.sponsorblockMode,
    sponsorblockCategories: s.sponsorblockCategories,
  };
}
