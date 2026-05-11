// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Leon Kasdorf

import { useEffect, useState } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { readTextFileSafe } from "./tauri-bridge";

/// Window-wide URL drop receiver. Accepts:
///   - text dropped from a browser's address bar (HTML5 `text/uri-list`
///     or `text/plain`) — yields one or more URLs as parsed by
///     [`parseUrls`]
///   - .txt files dropped from the OS file manager — read and parsed
///     the same way as the textarea import in BatchView
///
/// Tauri 2 intercepts OS file drops via the webview's
/// `onDragDropEvent`; HTML5 events stay live for text/URI payloads
/// dropped from inside a browser. We listen to both so users can drag
/// from either source.
///
/// Returns the current drag-active flag so the caller can render a
/// drop-zone overlay across the whole window.
export function useUrlDrop(onUrls: (urls: string[]) => void): boolean {
  const [active, setActive] = useState(false);

  useEffect(() => {
    let dragDepth = 0;

    function onDragEnter(e: DragEvent) {
      if (!hasTextPayload(e)) return;
      dragDepth += 1;
      e.preventDefault();
      setActive(true);
    }
    function onDragOver(e: DragEvent) {
      if (!hasTextPayload(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    }
    function onDragLeave(e: DragEvent) {
      if (!hasTextPayload(e)) return;
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) setActive(false);
    }
    function onDrop(e: DragEvent) {
      if (!hasTextPayload(e)) return;
      e.preventDefault();
      dragDepth = 0;
      setActive(false);
      const text =
        e.dataTransfer?.getData("text/uri-list") ||
        e.dataTransfer?.getData("text/plain") ||
        "";
      const urls = parseUrls(text);
      if (urls.length > 0) onUrls(urls);
    }

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);

    // Tauri-side: file drops bypass the HTML5 path. We use the same
    // drag-active flag so the overlay shows for both sources.
    let unlistenTauri: (() => void) | null = null;
    void getCurrentWebviewWindow()
      .onDragDropEvent(async (event) => {
        if (event.payload.type === "enter" || event.payload.type === "over") {
          setActive(true);
          return;
        }
        if (event.payload.type === "leave") {
          setActive(false);
          return;
        }
        if (event.payload.type === "drop") {
          setActive(false);
          const paths = event.payload.paths;
          const urls: string[] = [];
          for (const path of paths) {
            if (path.toLowerCase().endsWith(".txt")) {
              try {
                const content = await readTextFileSafe(path);
                urls.push(...parseUrls(content));
              } catch {
                // Path unreadable — skip; the user can retry via the
                // BatchView "Import .txt" button which uses the file
                // dialog instead.
              }
            }
          }
          if (urls.length > 0) onUrls(urls);
        }
      })
      .then((fn) => {
        unlistenTauri = fn;
      });

    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
      if (unlistenTauri) unlistenTauri();
    };
  }, [onUrls]);

  return active;
}

function hasTextPayload(e: DragEvent): boolean {
  const types = e.dataTransfer?.types;
  if (!types) return false;
  for (const t of types) {
    if (t === "text/uri-list" || t === "text/plain") return true;
  }
  return false;
}

const URL_RE = /https?:\/\/[^\s<>"']+/g;

export function parseUrls(text: string): string[] {
  const matches = text.match(URL_RE);
  if (!matches) return [];
  // Strip trailing punctuation a browser or text source commonly
  // glues onto URLs (commas, dots, brackets) without breaking
  // legitimate query strings.
  const cleaned = matches.map((u) => u.replace(/[),.;]+$/, ""));
  // Dedupe while preserving order.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of cleaned) {
    if (!seen.has(u)) {
      seen.add(u);
      out.push(u);
    }
  }
  return out;
}

