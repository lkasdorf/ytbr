fn main() {
    // Surface the build target triple as a compile-time env var so we
    // can locate sidecar binaries (named `<name>-<triple>{.exe}`) at
    // runtime without depending on Tauri's resource resolver, which
    // doesn't expose a path for externalBin entries.
    if let Ok(target) = std::env::var("TARGET") {
        println!("cargo:rustc-env=TARGET={target}");
    }
    tauri_build::build()
}
