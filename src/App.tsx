// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Leon Kasdorf

import { useState } from "react";
import { Download, ListVideo, Settings as SettingsIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Route = "download" | "queue" | "settings";

interface NavItem {
  id: Route;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const NAV: NavItem[] = [
  { id: "download", label: "Download", icon: Download },
  { id: "queue", label: "Queue", icon: ListVideo },
  { id: "settings", label: "Settings", icon: SettingsIcon },
];

function App() {
  const [route, setRoute] = useState<Route>("download");

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      <aside className="flex w-56 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
        <div className="flex h-14 items-center border-b border-sidebar-border px-4">
          <span className="text-lg font-semibold tracking-tight">YTBR</span>
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-2">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = route === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setRoute(item.id)}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground",
                )}
              >
                <Icon className="size-4" />
                {item.label}
              </button>
            );
          })}
        </nav>
      </aside>

      <main className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center border-b border-border px-6">
          <h1 className="text-base font-medium capitalize">{route}</h1>
        </header>
        <div className="flex-1 overflow-auto p-6">
          <Placeholder route={route} />
        </div>
      </main>
    </div>
  );
}

function Placeholder({ route }: { route: Route }) {
  const messages: Record<Route, string> = {
    download: "URL input and format picker land here in iteration 1.",
    queue: "Job queue with progress and status arrives in iteration 2.",
    settings: "Default profile, cookies, ffmpeg path arrive in iteration 2.",
  };
  return (
    <div className="rounded-lg border border-border bg-card p-6 text-card-foreground">
      <p className="text-sm text-muted-foreground">{messages[route]}</p>
    </div>
  );
}

export default App;
