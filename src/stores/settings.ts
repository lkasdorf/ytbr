// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Leon Kasdorf

import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SettingsStore {
  outputDir: string | null;
  setOutputDir: (dir: string | null) => void;
}

// Persisted in localStorage so the chosen output folder survives reloads.
// Tauri Store-plugin sync (AppConfigDir) lands in iteration 2.
export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      outputDir: null,
      setOutputDir: (dir) => set({ outputDir: dir }),
    }),
    { name: "ytbr.settings.v1" },
  ),
);
