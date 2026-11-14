// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Leon Kasdorf

import { create } from "zustand";
import { probeUrl, type ProbeResult } from "@/lib/tauri-bridge";
import { probeOptions } from "@/stores/settings";

export type ProbeState =
  | { status: "idle" }
  | { status: "loading"; url: string }
  | { status: "ok"; url: string; result: ProbeResult }
  | { status: "error"; url: string; message: string };

// The Download tab's URL field and probe result. Kept outside the
// component because the tab unmounts on every tab switch: as component
// state, a look at the Queue threw the format list away, and a probe
// still running at that moment was lost with it. Session-only — not
// persisted across restarts.
interface ProbeStore {
  url: string;
  probe: ProbeState;
  // Why queueing a format of the current probe result failed, if it did.
  enqueueError: string | null;
  setUrl: (url: string) => void;
  setEnqueueError: (message: string | null) => void;
  // Probe `url`; clears the previous result and any enqueue error.
  run: (url: string) => Promise<void>;
}

// Only the most recent probe may write its result; an older, slower one
// must not replace what the user asked for after it.
let latest = 0;

export const useProbeStore = create<ProbeStore>((set) => ({
  url: "",
  probe: { status: "idle" },
  enqueueError: null,

  setUrl: (url) => set({ url }),
  setEnqueueError: (enqueueError) => set({ enqueueError }),

  run: async (url) => {
    const token = ++latest;
    set({ probe: { status: "loading", url }, enqueueError: null });
    try {
      const result = await probeUrl(url, probeOptions());
      if (token === latest) set({ probe: { status: "ok", url, result } });
    } catch (err) {
      if (token === latest) {
        set({ probe: { status: "error", url, message: String(err) } });
      }
    }
  },
}));
