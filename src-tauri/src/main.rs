// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Leon Kasdorf

// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    ytbr_lib::run()
}
