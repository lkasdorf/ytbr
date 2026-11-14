// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Leon Kasdorf

import type { ComponentType } from "react";

interface PlaceholderProps {
  icon?: ComponentType<{ className?: string; strokeWidth?: number }>;
  title?: string;
  text: string;
}

// Empty state of a tab (nothing probed yet, empty queue, empty history):
// one dashed card with an icon, a headline and a hint what to do next.
export function Placeholder({ icon: Icon, title, text }: PlaceholderProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-card/40 px-6 py-12 text-card-foreground">
      {Icon && (
        <Icon className="size-10 text-muted-foreground/40" strokeWidth={1.5} />
      )}
      {title && <p className="text-sm font-medium text-foreground">{title}</p>}
      <p className="max-w-xs text-center text-xs text-muted-foreground">{text}</p>
    </div>
  );
}
