// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Leon Kasdorf

//! Pause / resume / kill for a spawned yt-dlp *process tree*.
//!
//! The release yt-dlp binaries (`yt-dlp.exe`, `yt-dlp_linux`) are
//! PyInstaller one-file builds: the pid we spawn is only a bootloader
//! that unpacks Python and launches a second process which does the
//! actual work, and that worker may in turn spawn ffmpeg. Acting on the
//! spawned pid alone therefore suspends / kills an idle bootloader while
//! the download carries on. Every operation here walks the descendants
//! of the root pid (via a process snapshot's parent links) and applies
//! to all of them.
//!
//! - Linux: `/proc/<pid>/stat` for parent links, `kill(2)` with
//!   SIGSTOP / SIGCONT / SIGKILL.
//! - Windows: Toolhelp32 snapshot for parent links,
//!   `NtSuspendProcess` / `NtResumeProcess` / `TerminateProcess`.
//!
//! Self-contained FFI; we deliberately do not pull in `nix` / `ntapi` /
//! `windows-sys` to keep the dep tree small. Other platforms (notably
//! macOS) compile to `false` no-ops so the frontend can hide / disable
//! the buttons gracefully.

/// Suspend `root` and all its descendants. Returns whether the root
/// itself was suspended; descendants are best-effort.
pub fn suspend(root: u32) -> bool {
    apply_to_tree(root, imp::suspend)
}

/// Resume `root` and all its descendants. Returns whether the root
/// itself was resumed; descendants are best-effort.
pub fn resume(root: u32) -> bool {
    apply_to_tree(root, imp::resume)
}

/// Kill every descendant of `root`, deepest first, leaving `root` for
/// the caller (the shell plugin's `CommandChild::kill` owns that handle).
pub fn kill_descendants(root: u32) {
    let pairs = imp::snapshot();
    for pid in descendants(root, &pairs).into_iter().rev() {
        imp::kill(pid);
    }
}

fn apply_to_tree(root: u32, op: fn(u32) -> bool) -> bool {
    // Snapshot before touching the root so a worker spawned in the
    // meantime is still found via its parent link.
    let pairs = imp::snapshot();
    let root_ok = op(root);
    for pid in descendants(root, &pairs) {
        op(pid);
    }
    root_ok
}

/// Breadth-first list of all descendants of `root` given a snapshot of
/// `(pid, parent_pid)` pairs. Excludes `root` itself; parents always
/// precede their children in the result.
fn descendants(root: u32, pairs: &[(u32, u32)]) -> Vec<u32> {
    let mut out = Vec::new();
    let mut frontier = vec![root];
    while let Some(parent) = frontier.pop() {
        for &(pid, ppid) in pairs {
            // pid == ppid guards against the Windows "System Idle
            // Process" (0 → 0) and any other self-parented entry.
            if ppid == parent && pid != ppid && pid != root && !out.contains(&pid) {
                out.push(pid);
                frontier.push(pid);
            }
        }
    }
    out
}

#[cfg(target_os = "linux")]
mod imp {
    // From <signal.h> on Linux. Stable kernel numbers; if we ever
    // support a non-Linux unix the constants need to come from `nix`
    // (macOS uses 17/19, BSD differs again).
    const SIGKILL: i32 = 9;
    const SIGSTOP: i32 = 19;
    const SIGCONT: i32 = 18;

    extern "C" {
        // Renamed so it doesn't clash with our own `pub fn kill` below.
        #[link_name = "kill"]
        fn libc_kill(pid: i32, sig: i32) -> i32;
    }

    fn signal(pid: u32, sig: i32) -> bool {
        unsafe { libc_kill(pid as i32, sig) == 0 }
    }

    pub fn suspend(pid: u32) -> bool {
        signal(pid, SIGSTOP)
    }

    pub fn resume(pid: u32) -> bool {
        signal(pid, SIGCONT)
    }

    pub fn kill(pid: u32) -> bool {
        signal(pid, SIGKILL)
    }

    pub fn snapshot() -> Vec<(u32, u32)> {
        let Ok(dir) = std::fs::read_dir("/proc") else {
            return Vec::new();
        };
        dir.filter_map(|e| {
            let pid: u32 = e.ok()?.file_name().to_str()?.parse().ok()?;
            let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
            // Format: `pid (comm) state ppid …`. `comm` may contain
            // spaces and parens, so split after the *last* ')'.
            let rest = &stat[stat.rfind(')')? + 1..];
            let ppid = rest.split_whitespace().nth(1)?.parse().ok()?;
            Some((pid, ppid))
        })
        .collect()
    }
}

#[cfg(target_os = "windows")]
mod imp {
    use std::ffi::c_void;

    type Handle = *mut c_void;
    type NtStatus = i32;
    type Bool = i32;
    type Dword = u32;

    // Access rights from the Win32 process security table.
    const PROCESS_TERMINATE: Dword = 0x0001;
    const PROCESS_SUSPEND_RESUME: Dword = 0x0800;
    const TH32CS_SNAPPROCESS: Dword = 0x0000_0002;
    const INVALID_HANDLE_VALUE: Handle = -1isize as Handle;

    #[repr(C)]
    struct ProcessEntry32W {
        dw_size: Dword,
        cnt_usage: Dword,
        th32_process_id: Dword,
        th32_default_heap_id: usize,
        th32_module_id: Dword,
        cnt_threads: Dword,
        th32_parent_process_id: Dword,
        pc_pri_class_base: i32,
        dw_flags: Dword,
        sz_exe_file: [u16; 260],
    }

    extern "system" {
        // kernel32
        fn OpenProcess(desired_access: Dword, inherit_handle: Bool, process_id: Dword) -> Handle;
        fn CloseHandle(handle: Handle) -> Bool;
        fn TerminateProcess(handle: Handle, exit_code: u32) -> Bool;
        fn CreateToolhelp32Snapshot(flags: Dword, process_id: Dword) -> Handle;
        fn Process32FirstW(snapshot: Handle, entry: *mut ProcessEntry32W) -> Bool;
        fn Process32NextW(snapshot: Handle, entry: *mut ProcessEntry32W) -> Bool;
    }

    #[link(name = "ntdll")]
    extern "system" {
        fn NtSuspendProcess(process_handle: Handle) -> NtStatus;
        fn NtResumeProcess(process_handle: Handle) -> NtStatus;
    }

    fn with_handle<F: FnOnce(Handle) -> bool>(pid: u32, access: Dword, op: F) -> bool {
        unsafe {
            let h = OpenProcess(access, 0, pid);
            if h.is_null() {
                return false;
            }
            let ok = op(h);
            CloseHandle(h);
            ok
        }
    }

    pub fn suspend(pid: u32) -> bool {
        with_handle(pid, PROCESS_SUSPEND_RESUME, |h| unsafe { NtSuspendProcess(h) == 0 })
    }

    pub fn resume(pid: u32) -> bool {
        with_handle(pid, PROCESS_SUSPEND_RESUME, |h| unsafe { NtResumeProcess(h) == 0 })
    }

    pub fn kill(pid: u32) -> bool {
        with_handle(pid, PROCESS_TERMINATE, |h| unsafe { TerminateProcess(h, 1) != 0 })
    }

    pub fn snapshot() -> Vec<(u32, u32)> {
        let mut out = Vec::new();
        unsafe {
            let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
            if snap == INVALID_HANDLE_VALUE {
                return out;
            }
            let mut entry: ProcessEntry32W = std::mem::zeroed();
            entry.dw_size = std::mem::size_of::<ProcessEntry32W>() as Dword;
            if Process32FirstW(snap, &mut entry) != 0 {
                loop {
                    out.push((entry.th32_process_id, entry.th32_parent_process_id));
                    if Process32NextW(snap, &mut entry) == 0 {
                        break;
                    }
                }
            }
            CloseHandle(snap);
        }
        out
    }
}

#[cfg(not(any(target_os = "linux", target_os = "windows")))]
mod imp {
    pub fn suspend(_pid: u32) -> bool {
        false
    }
    pub fn resume(_pid: u32) -> bool {
        false
    }
    pub fn kill(_pid: u32) -> bool {
        false
    }
    pub fn snapshot() -> Vec<(u32, u32)> {
        Vec::new()
    }
}

#[cfg(test)]
mod tests {
    use super::descendants;

    #[test]
    fn walks_nested_children_parents_first() {
        // 10 → 11 (worker) → 12 (ffmpeg); 20 is unrelated.
        let pairs = [(10, 1), (11, 10), (12, 11), (20, 1), (13, 10)];
        let d = descendants(10, &pairs);
        assert_eq!(d.len(), 3);
        assert!(d.contains(&11) && d.contains(&12) && d.contains(&13));
        let pos = |p| d.iter().position(|&x| x == p).unwrap();
        assert!(pos(11) < pos(12));
    }

    #[test]
    fn excludes_root_and_self_parented_entries() {
        let pairs = [(0, 0), (10, 0), (11, 10)];
        assert_eq!(descendants(0, &pairs), vec![10, 11]);
        assert_eq!(descendants(11, &pairs), Vec::<u32>::new());
    }

    #[cfg(any(target_os = "linux", target_os = "windows"))]
    #[test]
    fn snapshot_contains_current_process() {
        let me = std::process::id();
        assert!(super::imp::snapshot().iter().any(|&(pid, _)| pid == me));
    }
}
