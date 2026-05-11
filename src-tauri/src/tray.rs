// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Leon Kasdorf

//! System tray icon and close-to-tray plumbing.
//!
//! Two pieces of state cooperate: this module owns the tray icon and its
//! menu, while [`CloseToTray`] is a process-wide atomic toggled from the
//! frontend (see `commands::settings::set_close_to_tray`). When the user
//! clicks the window's X, `lib.rs` consults the atomic — if set, the
//! window hides instead of closing. The tray menu's "Quit" item always
//! calls `app.exit(0)` directly, bypassing the hide path so the user
//! always has an explicit way out.

use std::sync::atomic::AtomicBool;

use tauri::{
    AppHandle, Manager,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};

pub struct CloseToTray(pub AtomicBool);

impl CloseToTray {
    pub fn new() -> Self {
        Self(AtomicBool::new(false))
    }
}

pub fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let show_item = MenuItem::with_id(app, "tray.show", "Show YTBR", true, None::<&str>)?;
    let hide_item = MenuItem::with_id(app, "tray.hide", "Hide", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "tray.quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_item, &hide_item, &quit_item])?;

    let icon = app
        .default_window_icon()
        .cloned()
        .expect("bundle icon configured in tauri.conf.json");

    TrayIconBuilder::with_id("ytbr-tray")
        .icon(icon)
        .tooltip("YTBR")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "tray.show" => show_window(app),
            "tray.hide" => {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.hide();
                }
            }
            "tray.quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            // Left-click toggles window visibility. Right-click opens the
            // context menu (handled by the OS via `show_menu_on_left_click(false)`).
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(win) = app.get_webview_window("main") {
                    let visible = win.is_visible().unwrap_or(false);
                    if visible {
                        let _ = win.hide();
                    } else {
                        show_window(app);
                    }
                }
            }
        })
        .build(app)?;
    Ok(())
}

fn show_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}
