// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Leon Kasdorf

import { describe, expect, it } from "vitest";
import {
  classifyFormat,
  formatBitrate,
  formatBytes,
  formatDuration,
  formatEta,
  formatFps,
  formatResolution,
  shortCodec,
} from "@/lib/format-utils";

describe("classifyFormat", () => {
  it("tells combined, video-only and audio-only formats apart", () => {
    expect(classifyFormat("avc1.640028", "mp4a.40.2")).toBe("video+audio");
    expect(classifyFormat("avc1.640028", "none")).toBe("video");
    expect(classifyFormat("none", "opus")).toBe("audio");
  });

  it("treats empty and 'none' codecs as absent", () => {
    // Direct media URLs: yt-dlp doesn't know either codec.
    expect(classifyFormat("none", "none")).toBe("none");
    expect(classifyFormat("", "")).toBe("none");
  });
});

describe("formatBytes", () => {
  it("picks the unit and trims decimals as the number grows", () => {
    expect(formatBytes(0)).toBe("0.00 B");
    expect(formatBytes(1023)).toBe("1023 B");
    expect(formatBytes(1024)).toBe("1.00 KB");
    expect(formatBytes(788_493)).toBe("770 KB");
    expect(formatBytes(59 * 1024 * 1024)).toBe("59.0 MB");
    expect(formatBytes(5 * 1024 ** 3)).toBe("5.00 GB");
  });

  it("shows a dash for unknown sizes", () => {
    expect(formatBytes(null)).toBe("—");
    expect(formatBytes(undefined)).toBe("—");
  });
});

describe("formatEta", () => {
  it("uses seconds, then minutes, then hours", () => {
    expect(formatEta(0)).toBe("0s");
    expect(formatEta(42)).toBe("42s");
    expect(formatEta(185)).toBe("3m 5s");
    expect(formatEta(3599)).toBe("59m 59s");
    expect(formatEta(3600)).toBe("1h 0m");
  });

  it("drops the seconds past an hour instead of counting minutes up", () => {
    // Used to read "97m 57s".
    expect(formatEta(97 * 60 + 57)).toBe("1h 37m");
    expect(formatEta(27 * 3600 + 5 * 60)).toBe("27h 5m");
  });

  it("copes with missing, fractional and negative values", () => {
    expect(formatEta(null)).toBe("—");
    expect(formatEta(undefined)).toBe("—");
    expect(formatEta(59.9)).toBe("59s");
    expect(formatEta(-5)).toBe("0s");
  });
});

describe("formatDuration", () => {
  it("formats as m:ss and h:mm:ss", () => {
    expect(formatDuration(9)).toBe("0:09");
    expect(formatDuration(596)).toBe("9:56");
    expect(formatDuration(3725)).toBe("1:02:05");
    expect(formatDuration(null)).toBe("—");
  });
});

describe("small formatters", () => {
  it("formatBitrate switches to Mbps at 1000 kbps", () => {
    expect(formatBitrate(128)).toBe("128 kbps");
    expect(formatBitrate(4500)).toBe("4.5 Mbps");
    expect(formatBitrate(null)).toBe("—");
  });

  it("formatResolution needs both dimensions", () => {
    expect(formatResolution(1920, 1080)).toBe("1920×1080");
    expect(formatResolution(1920, null)).toBe("—");
  });

  it("formatFps keeps integers plain", () => {
    expect(formatFps(30)).toBe("30");
    expect(formatFps(29.97)).toBe("29.97");
    expect(formatFps(null)).toBe("—");
  });

  it("shortCodec strips the profile suffix", () => {
    expect(shortCodec("avc1.640028")).toBe("avc1");
    expect(shortCodec("opus")).toBe("opus");
    expect(shortCodec("none")).toBe("—");
  });
});
