// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Leon Kasdorf

import { createContext, useContext, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { JobCard } from "@/features/queue/QueueView";

// The element that actually scrolls (App's main content pane). Lists
// virtualize against it instead of owning a nested scroll box, so the
// page keeps a single scrollbar.
export const ScrollContainerContext = createContext<RefObject<HTMLDivElement | null> | null>(
  null,
);

// Rough card height before measurement; real heights (error box, open
// log panel) are measured per row via ResizeObserver.
const ESTIMATED_ROW_PX = 112;
// Matches the former `gap-3` between cards.
const ROW_GAP_PX = 12;

/**
 * Renders only the job cards in and near the viewport. With thousands
 * of queued jobs, mounting every card made the Queue / History tabs
 * slow to open and scroll.
 */
export function VirtualJobList({ ids }: { ids: string[] }) {
  const scrollRef = useContext(ScrollContainerContext);
  const listRef = useRef<HTMLDivElement>(null);
  // Distance from the scroll container's content top to this list —
  // the controls rendered above it scroll along with the cards.
  const [scrollMargin, setScrollMargin] = useState(0);

  useLayoutEffect(() => {
    const list = listRef.current;
    const scroller = scrollRef?.current;
    if (!list || !scroller) return;
    const margin =
      list.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    if (Math.abs(margin - scrollMargin) > 1) setScrollMargin(margin);
  });

  const virtualizer = useVirtualizer({
    count: ids.length,
    getScrollElement: () => scrollRef?.current ?? null,
    estimateSize: () => ESTIMATED_ROW_PX + ROW_GAP_PX,
    getItemKey: (index) => ids[index],
    overscan: 6,
    scrollMargin,
    useFlushSync: false,
  });

  return (
    <div ref={listRef} className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
      {virtualizer.getVirtualItems().map((row) => (
        <div
          key={row.key}
          data-index={row.index}
          ref={virtualizer.measureElement}
          className="absolute left-0 top-0 w-full"
          style={{
            transform: `translateY(${row.start - virtualizer.options.scrollMargin}px)`,
            paddingBottom: ROW_GAP_PX,
          }}
        >
          <JobCard id={ids[row.index]} />
        </div>
      ))}
    </div>
  );
}
