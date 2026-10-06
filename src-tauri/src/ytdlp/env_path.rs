// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Leon Kasdorf

//! PATH for spawned yt-dlp processes.
//!
//! yt-dlp needs a JavaScript runtime (deno, node, bun) from PATH to
//! solve YouTube's n-challenge; without one, YouTube only offers
//! storyboard images and every download fails with "Requested format
//! is not available". A process inherits the PATH of whoever launched
//! it, and when YTBR is relaunched by its own updater / installer that
//! environment can predate the user's PATH (e.g. winget's `Links` dir).
//! On Windows we therefore re-read the machine + user PATH from the
//! registry, like a freshly started Explorer would, and append any
//! entries the current process is missing.
//!
//! Every entry is also checked for accessibility from this process and
//! dropped if that fails. A process relaunched by the Windows installer
//! can inherit the installer's RedirectionGuard mitigation, under which
//! traversing a user-created junction on PATH (e.g. Codex's `bin`)
//! fails with WinError 448 — and yt-dlp aborts the whole download on
//! that while probing PATH for JS runtimes. Children inherit the same
//! mitigation, so what this process can't open, yt-dlp can't either.

/// PATH to hand to yt-dlp, or `None` to inherit unchanged.
pub fn for_child() -> Option<String> {
    let current = std::env::var("PATH").unwrap_or_default();
    let fresh = imp::registry_path()?;
    Some(merge(&current, &fresh, |dir| std::fs::metadata(dir).is_ok()))
}

/// `current` entries first (order preserved), then every entry of
/// `fresh` that isn't already present (case-insensitive, ignoring a
/// trailing backslash — Windows path semantics). Entries for which
/// `accessible` returns false are dropped.
fn merge(current: &str, fresh: &str, accessible: impl Fn(&str) -> bool) -> String {
    let norm = |s: &str| s.trim().trim_end_matches(['\\', '/']).to_lowercase();
    let mut seen: Vec<String> = Vec::new();
    let mut out: Vec<&str> = Vec::new();
    for entry in current.split(';').chain(fresh.split(';')) {
        let key = norm(entry);
        if key.is_empty() || seen.contains(&key) || !accessible(entry.trim()) {
            continue;
        }
        seen.push(key);
        out.push(entry.trim());
    }
    out.join(";")
}

#[cfg(windows)]
mod imp {
    use std::ffi::c_void;

    type Hkey = isize;
    const HKEY_CURRENT_USER: Hkey = 0x8000_0001u32 as i32 as isize;
    const HKEY_LOCAL_MACHINE: Hkey = 0x8000_0002u32 as i32 as isize;
    // REG_SZ, plus REG_EXPAND_SZ auto-expanded to REG_SZ (no
    // RRF_NOEXPAND), so `%USERPROFILE%\...` comes back resolved.
    const RRF_RT_REG_SZ: u32 = 0x0000_0002;

    #[link(name = "advapi32")]
    extern "system" {
        fn RegGetValueW(
            hkey: Hkey,
            sub_key: *const u16,
            value: *const u16,
            flags: u32,
            ty: *mut u32,
            data: *mut c_void,
            len: *mut u32,
        ) -> i32;
    }

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    fn read(root: Hkey, sub_key: &str) -> Option<String> {
        let sub_key = wide(sub_key);
        let value = wide("Path");
        unsafe {
            let mut len: u32 = 0;
            let rc = RegGetValueW(
                root,
                sub_key.as_ptr(),
                value.as_ptr(),
                RRF_RT_REG_SZ,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                &mut len,
            );
            if rc != 0 || len == 0 {
                return None;
            }
            // Expansion can grow the string between the two calls;
            // leave headroom instead of looping on ERROR_MORE_DATA.
            let mut buf = vec![0u16; (len as usize / 2) + 1024];
            let mut len = (buf.len() * 2) as u32;
            let rc = RegGetValueW(
                root,
                sub_key.as_ptr(),
                value.as_ptr(),
                RRF_RT_REG_SZ,
                std::ptr::null_mut(),
                buf.as_mut_ptr().cast(),
                &mut len,
            );
            if rc != 0 {
                return None;
            }
            let chars = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
            Some(String::from_utf16_lossy(&buf[..chars]))
        }
    }

    pub fn registry_path() -> Option<String> {
        let machine = read(
            HKEY_LOCAL_MACHINE,
            r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment",
        );
        let user = read(HKEY_CURRENT_USER, "Environment");
        match (machine, user) {
            (None, None) => None,
            (m, u) => Some(format!("{};{}", m.unwrap_or_default(), u.unwrap_or_default())),
        }
    }
}

#[cfg(not(windows))]
mod imp {
    // Linux desktop sessions don't have the stale-environment problem
    // in the same way, and there's no single registry to re-read.
    pub fn registry_path() -> Option<String> {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::merge;

    #[test]
    fn appends_missing_entries_after_current() {
        let merged = merge(
            r"C:\Windows;C:\Tools",
            r"C:\Windows\;C:\Users\me\WinGet\Links",
            |_| true,
        );
        assert_eq!(merged, r"C:\Windows;C:\Tools;C:\Users\me\WinGet\Links");
    }

    #[test]
    fn dedupes_case_insensitively_and_skips_empty() {
        let merged = merge(r"C:\A;;c:\b", r"C:\a;C:\B\;;C:\C", |_| true);
        assert_eq!(merged, r"C:\A;c:\b;C:\C");
    }

    #[test]
    fn drops_inaccessible_entries_from_both_sides() {
        let merged = merge(r"C:\A;C:\Junction", r"C:\Codex\bin;C:\B", |d| {
            !d.contains("Junction") && !d.contains("Codex")
        });
        assert_eq!(merged, r"C:\A;C:\B");
    }

    #[cfg(windows)]
    #[test]
    fn reads_registry_path() {
        let p = super::imp::registry_path().expect("registry PATH");
        assert!(p.to_lowercase().contains(r"\windows"));
        assert!(!p.contains('%'), "REG_EXPAND_SZ should be expanded: {p}");
    }
}
