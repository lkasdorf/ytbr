// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Leon Kasdorf

//! Cross-platform pause / resume for an arbitrary OS process by PID.
//!
//! - Linux: `kill(pid, SIGSTOP)` and `kill(pid, SIGCONT)` via libc.
//! - Windows: `NtSuspendProcess` / `NtResumeProcess` via ntdll, with
//!   `OpenProcess(PROCESS_SUSPEND_RESUME, …)` from kernel32.
//!
//! Both implementations are self-contained FFI; we deliberately do
//! not pull in `nix` / `ntapi` to keep the dep tree small. Other
//! platforms (notably macOS) compile to `false` no-ops so the
//! frontend can hide / disable the buttons gracefully.

#[cfg(target_os = "linux")]
mod imp {
    // From <signal.h> on Linux. SIGSTOP and SIGCONT are stable kernel
    // numbers; if we ever support a non-Linux unix the constants need
    // to come from `nix` (macOS uses 17/19, BSD differs again).
    const SIGSTOP: i32 = 19;
    const SIGCONT: i32 = 18;

    extern "C" {
        fn kill(pid: i32, sig: i32) -> i32;
    }

    pub fn suspend(pid: u32) -> bool {
        unsafe { kill(pid as i32, SIGSTOP) == 0 }
    }

    pub fn resume(pid: u32) -> bool {
        unsafe { kill(pid as i32, SIGCONT) == 0 }
    }
}

#[cfg(target_os = "windows")]
mod imp {
    use std::ffi::c_void;

    type Handle = *mut c_void;
    type NtStatus = i32;
    type Bool = i32;
    type Dword = u32;

    // PROCESS_SUSPEND_RESUME — minimum access right needed by
    // NtSuspend/ResumeProcess. Documented in the Win32 process security
    // table.
    const PROCESS_SUSPEND_RESUME: Dword = 0x0800;

    extern "system" {
        // kernel32
        fn OpenProcess(
            desired_access: Dword,
            inherit_handle: Bool,
            process_id: Dword,
        ) -> Handle;
        fn CloseHandle(handle: Handle) -> Bool;
    }

    #[link(name = "ntdll")]
    extern "system" {
        fn NtSuspendProcess(process_handle: Handle) -> NtStatus;
        fn NtResumeProcess(process_handle: Handle) -> NtStatus;
    }

    fn with_handle<F: FnOnce(Handle) -> NtStatus>(pid: u32, op: F) -> bool {
        unsafe {
            let h = OpenProcess(PROCESS_SUSPEND_RESUME, 0, pid);
            if h.is_null() {
                return false;
            }
            let status = op(h);
            CloseHandle(h);
            status == 0
        }
    }

    pub fn suspend(pid: u32) -> bool {
        with_handle(pid, |h| unsafe { NtSuspendProcess(h) })
    }

    pub fn resume(pid: u32) -> bool {
        with_handle(pid, |h| unsafe { NtResumeProcess(h) })
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
}

pub use imp::{resume, suspend};
