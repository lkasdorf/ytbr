// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Leon Kasdorf
//
// Sets the `dark` class before the first paint. Loaded as a blocking
// classic script from index.html: the React theme effect (src/lib/theme.ts)
// only runs after the bundle has loaded, and with a hardcoded class the
// window flashed in the wrong theme until then.
//
// A separate file rather than an inline script because the app's CSP
// only allows scripts from 'self'. Keep the storage key and the theme
// values in sync with src/stores/settings.ts.
(function () {
  var theme = "system";
  try {
    var raw = localStorage.getItem("ytbr.settings.v1");
    if (raw) theme = JSON.parse(raw).state.theme || "system";
  } catch (e) {
    // Unreadable settings: fall back to the system preference.
  }
  var dark =
    theme === "dark" ||
    (theme !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
})();
