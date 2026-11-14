// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Leon Kasdorf

import { describe, expect, it } from "vitest";
import {
  downloadButtonLabel,
  downloadDetail,
  downloadEtaSecs,
  downloadFraction,
  SpeedMeter,
  STALL_HINT_SECS,
  type DownloadProgress,
} from "@/lib/update-progress";

const KB = 1024;
const MB = 1024 * KB;

function at(
  received: number,
  total: number | null,
  extra: Partial<DownloadProgress> = {},
): DownloadProgress {
  return { received, total, speedBps: null, idleSecs: 0, ...extra };
}

describe("downloadFraction", () => {
  it("is the received share of the total", () => {
    expect(downloadFraction(at(0, 100))).toBe(0);
    expect(downloadFraction(at(25, 100))).toBe(0.25);
    expect(downloadFraction(at(100, 100))).toBe(1);
  });

  it("never leaves 0..1, even if more arrives than announced", () => {
    expect(downloadFraction(at(150, 100))).toBe(1);
  });

  it("is null without a usable total", () => {
    expect(downloadFraction(at(50, null))).toBeNull();
    expect(downloadFraction(at(50, 0))).toBeNull();
  });
});

describe("downloadButtonLabel", () => {
  it("shows whole percent, rounded down so 100% means done", () => {
    expect(downloadButtonLabel(at(0, 109 * MB))).toBe("Downloading… 0%");
    expect(downloadButtonLabel(at(42 * MB, 109 * MB))).toBe("Downloading… 38%");
    expect(downloadButtonLabel(at(109 * MB - 1, 109 * MB))).toBe("Downloading… 99%");
    expect(downloadButtonLabel(at(109 * MB, 109 * MB))).toBe("Downloading… 100%");
  });

  it("has no percentage when the size is unknown", () => {
    expect(downloadButtonLabel(at(42 * MB, null))).toBe("Downloading…");
  });
});

describe("downloadEtaSecs", () => {
  it("divides what is left by the current rate", () => {
    expect(downloadEtaSecs(at(9 * MB, 109 * MB, { speedBps: 2 * MB }))).toBe(50);
  });

  it("is null without a rate or a total", () => {
    expect(downloadEtaSecs(at(9 * MB, 109 * MB))).toBeNull();
    expect(downloadEtaSecs(at(9 * MB, 109 * MB, { speedBps: 0 }))).toBeNull();
    expect(downloadEtaSecs(at(9 * MB, null, { speedBps: MB }))).toBeNull();
  });
});

describe("downloadDetail", () => {
  it("names received and total size", () => {
    expect(downloadDetail(at(42 * MB, 109 * MB))).toBe("42.0 MB of 109 MB");
  });

  it("falls back to the received amount alone", () => {
    expect(downloadDetail(at(42 * MB, null))).toBe("42.0 MB");
  });

  it("adds rate and time left once the rate is known", () => {
    // The case that prompted this: 109 MB at ~56 KB/s is half an hour.
    expect(downloadDetail(at(2.5 * MB, 109 * MB, { speedBps: 56 * KB }))).toBe(
      "2.50 MB of 109 MB · 56.0 KB/s · 32m 27s left",
    );
  });

  it("says so when no data has arrived for a while", () => {
    expect(
      downloadDetail(at(2.5 * MB, 109 * MB, { speedBps: 56 * KB, idleSecs: STALL_HINT_SECS })),
    ).toBe("2.50 MB of 109 MB · no data for 20s");
    // Below the threshold the last known rate stays.
    expect(
      downloadDetail(at(2.5 * MB, 109 * MB, { speedBps: 56 * KB, idleSecs: STALL_HINT_SECS - 1 })),
    ).toContain("KB/s");
  });
});

describe("SpeedMeter", () => {
  it("has no rate before a second of data", () => {
    const m = new SpeedMeter();
    expect(m.rate()).toBeNull();
    m.add(0, 0);
    expect(m.rate()).toBeNull();
    m.add(500, 50_000);
    expect(m.rate()).toBeNull();
  });

  it("measures bytes per second", () => {
    const m = new SpeedMeter();
    m.add(0, 0);
    m.add(2000, 200_000);
    expect(m.rate()).toBe(100_000);
  });

  it("follows the recent rate, not the average since the start", () => {
    const m = new SpeedMeter(5000);
    // 10 s fast (1 MB/s), then 10 s slow (10 KB/s), sampled twice a second.
    let received = 0;
    for (let t = 0; t <= 10_000; t += 500) {
      m.add(t, received);
      received += 500_000;
    }
    for (let t = 10_500; t <= 20_000; t += 500) {
      received += 5_000;
      m.add(t, received);
    }
    const rate = m.rate();
    expect(rate).not.toBeNull();
    expect(rate!).toBeGreaterThan(9_000);
    expect(rate!).toBeLessThan(11_000);
  });

  it("drops to zero when nothing arrives any more", () => {
    const m = new SpeedMeter(5000);
    m.add(0, 0);
    m.add(1000, 100_000);
    for (let t = 1500; t <= 12_000; t += 500) m.add(t, 100_000);
    expect(m.rate()).toBe(0);
  });
});
