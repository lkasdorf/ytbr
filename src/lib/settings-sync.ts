// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Leon Kasdorf

import { useEffect } from "react";
import { setParallelLimit } from "./tauri-bridge";
import { useSettingsStore } from "@/stores/settings";

/// Push every settings field that the Rust backend cares about
/// whenever the persisted UI value changes. Mount once in `App.tsx`.
///
/// The Rust queue boots with `DEFAULT_PARALLEL_LIMIT` from `lib.rs`;
/// this hook overwrites it on first render with the persisted value
/// and re-syncs on each later change.
export function useSettingsSync(): void {
  const parallelLimit = useSettingsStore((s) => s.parallelLimit);

  useEffect(() => {
    void setParallelLimit(parallelLimit).catch((err) => {
      console.error("setParallelLimit failed", err);
    });
  }, [parallelLimit]);
}
