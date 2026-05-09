# YTBR

Cross-platform desktop frontend for [yt-dlp](https://github.com/yt-dlp/yt-dlp).
Built with [Tauri 2](https://tauri.app/), React, and TypeScript. Targets
Windows 11 and Linux (Ubuntu/Debian + AppImage). Small binary, fast cold
start, predictable behavior.

> **Status:** early development. The MVP (URL probe, format picker,
> single download with live progress) is the current iteration. APIs and
> on-disk layout may change without notice.

---

## Screenshots

_Coming once the MVP UI lands._

---

## Installation

### Windows 11

1. Download the latest `YTBR-x.y.z-x64.msi` (or `.exe` installer) from
   the [Releases](#) page.
2. Run the installer. The app installs into
   `%LocalAppData%\Programs\YTBR\` by default and registers a Start
   menu entry.
3. Launch YTBR from the Start menu.

The installer bundles the matching `yt-dlp` and `ffmpeg` binaries; no
extra setup is required.

### Linux (Ubuntu / Debian)

```bash
sudo dpkg -i ytbr_x.y.z_amd64.deb
ytbr
```

### Linux (any distribution, AppImage)

```bash
chmod +x YTBR-x.y.z-x86_64.AppImage
./YTBR-x.y.z-x86_64.AppImage
```

---

## Build from source

### Prerequisites

- Node.js 20+ and pnpm 9+
- Rust stable toolchain (`rustup default stable`)
- On Windows: Visual Studio 2022 Build Tools with the C++ workload
  (provides `link.exe` and the Windows SDK)
- On Linux: `libwebkit2gtk-4.1-dev`, `libssl-dev`, `librsvg2-dev`,
  `libayatana-appindicator3-dev`, `build-essential`

### Build

```bash
git clone https://github.com/<user>/ytbr.git
cd ytbr

# Fetch yt-dlp + ffmpeg sidecar binaries (LGPL ffmpeg only).
# Skip with care: tauri build will fail without them present in src-tauri/binaries/.
./scripts/fetch-binaries.sh        # Linux / macOS
./scripts/fetch-binaries.ps1       # Windows PowerShell

pnpm install
pnpm tauri build
```

Artifacts land in `src-tauri/target/release/bundle/`.

For development with hot reload:

```bash
pnpm tauri dev
```

---

## License

YTBR is released under the [Apache License 2.0](LICENSE). See the
[NOTICE](NOTICE) file for copyright and required attribution, and
[THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md) for the full list of
bundled and linked open-source components with their license texts.

The bundled `ffmpeg` is the LGPL build from
[BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds); per LGPL
Section 6, the binary inside the installation directory may be replaced
by the end user with a compatible build.

---

## Disclaimer

YTBR is an independent open-source project and is **not affiliated with,
endorsed by, or sponsored by** any video platform, streaming service, or
content provider. Names of third-party platforms, formats, codecs, or
tools that may appear in the user interface, source files, or
documentation are the property of their respective owners and are used
solely to describe what YTBR interoperates with.

YTBR is a generic frontend for `yt-dlp`. It does not bypass platform
protection, does not host or distribute media, and does not encourage
infringement.

---

## User responsibility

You are solely responsible for ensuring that your use of YTBR complies
with the Terms of Service of every platform you interact with and with
the copyright law applicable in your jurisdiction. Downloading,
storing, redistributing, or otherwise using third-party content without
permission may be illegal in your country.

The YTBR authors disclaim all liability for misuse. See the warranty
and liability sections of the Apache License 2.0 in `LICENSE`.
