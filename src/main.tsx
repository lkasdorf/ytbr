// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Leon Kasdorf

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
// JetBrains Mono powers --font-mono. Bundled via @fontsource so the
// desktop app stays offline-capable; the woff2 files land in the Vite
// asset pipeline alongside everything else.
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/600.css";
import "@fontsource/jetbrains-mono/700.css";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
