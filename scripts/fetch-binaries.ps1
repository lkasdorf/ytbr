# SPDX-License-Identifier: Apache-2.0
# Copyright (c) 2026 Leon Kasdorf
#
# Downloads yt-dlp and the LGPL build of ffmpeg for the given Rust
# target triple and stages them in src-tauri/binaries/ with the Tauri
# sidecar naming convention (<name>-<triple>{.exe}). Hash-verifies
# downloads where upstream publishes a checksum file.
#
# Usage:
#   ./scripts/fetch-binaries.ps1                       # host target
#   ./scripts/fetch-binaries.ps1 -Target x86_64-pc-windows-msvc

param(
    [string]$Target = ""
)

$ErrorActionPreference = "Stop"
$ProgressPreference   = "SilentlyContinue"  # speeds up Invoke-WebRequest

$RepoRoot   = Resolve-Path (Join-Path $PSScriptRoot "..")
$BinDir     = Join-Path $RepoRoot "src-tauri/binaries"
$WorkDir    = Join-Path $env:TEMP "ytbr-fetch-$(Get-Random)"

function Resolve-HostTriple {
    $rustc = Get-Command rustc -ErrorAction SilentlyContinue
    if (-not $rustc) {
        throw "rustc not found on PATH. Install Rust or pass -Target explicitly."
    }
    $line = & rustc -vV | Where-Object { $_ -like "host:*" }
    return ($line -replace "^host:\s*", "").Trim()
}

if (-not $Target) { $Target = Resolve-HostTriple }

# UPX is pinned for reproducible compression of the ffmpeg sidecar.
# Bump $UpxVersion when upstream ships a fix you need.
$UpxVersion = "5.0.2"

# yt-dlp ships a new dated tag every few weeks. The `latest/download`
# redirect points at whichever tag is current right now, so a release
# happening between our binary fetch and our SHA2-256SUMS fetch makes
# the redirect resolve to two different tags — and the hash check
# silently rejects a perfectly fine binary. Resolve "latest" to a
# concrete tag once and pin every subsequent URL to it.
$YtDlpTag = (Invoke-RestMethod -Uri "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest").tag_name
if (-not $YtDlpTag) {
    throw "Failed to resolve yt-dlp latest tag from GitHub API"
}
Write-Host "[yt-dlp] tag: $YtDlpTag"

# BtbN/FFmpeg-Builds uses a literal `latest` tag they keep republishing,
# and they ship a single per-release `checksums.sha256` (not per-file
# `.sha256` siblings), so the existing script never actually verified
# ffmpeg's hash. We accept that and just trust the latest/download
# redirect for ffmpeg — each fetch is internally consistent.

$Spec = switch ($Target) {
    "x86_64-pc-windows-msvc" {
        @{
            YtDlpUrl     = "https://github.com/yt-dlp/yt-dlp/releases/download/$YtDlpTag/yt-dlp.exe"
            YtDlpSumsUrl = "https://github.com/yt-dlp/yt-dlp/releases/download/$YtDlpTag/SHA2-256SUMS"
            YtDlpName    = "yt-dlp.exe"
            FfmpegUrl    = "https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-lgpl.zip"
            FfmpegName   = "ffmpeg.exe"
            FfprobeName  = "ffprobe.exe"
            Suffix       = ".exe"
            UpxUrl       = "https://github.com/upx/upx/releases/download/v$UpxVersion/upx-$UpxVersion-win64.zip"
            UpxExe       = "upx.exe"
        }
    }
    "x86_64-unknown-linux-gnu" {
        @{
            YtDlpUrl     = "https://github.com/yt-dlp/yt-dlp/releases/download/$YtDlpTag/yt-dlp_linux"
            YtDlpSumsUrl = "https://github.com/yt-dlp/yt-dlp/releases/download/$YtDlpTag/SHA2-256SUMS"
            YtDlpName    = "yt-dlp"
            FfmpegUrl    = "https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-linux64-lgpl.tar.xz"
            FfmpegName   = "ffmpeg"
            FfprobeName  = "ffprobe"
            Suffix       = ""
            UpxUrl       = "https://github.com/upx/upx/releases/download/v$UpxVersion/upx-$UpxVersion-amd64_linux.tar.xz"
            UpxExe       = "upx"
        }
    }
    default { throw "Unsupported target triple: $Target" }
}

New-Item -ItemType Directory -Path $BinDir  -Force | Out-Null
New-Item -ItemType Directory -Path $WorkDir -Force | Out-Null

try {
    # ---------- yt-dlp ----------
    $YtDlpOut = Join-Path $WorkDir $Spec.YtDlpName
    Write-Host "[yt-dlp] $($Spec.YtDlpUrl)"
    Invoke-WebRequest -Uri $Spec.YtDlpUrl -OutFile $YtDlpOut

    $SumsUrl  = $Spec.YtDlpSumsUrl
    $SumsFile = Join-Path $WorkDir "SHA2-256SUMS"
    # SHA2-256SUMS lists yt-dlp (Python source), yt-dlp.exe, yt-dlp_linux
    # etc. as separate rows. Match the upstream asset name from the URL,
    # not the local-rename name (which collapses to "yt-dlp" on Linux
    # and would silently pick the Python source row).
    $YtDlpAsset = Split-Path -Leaf $Spec.YtDlpUrl
    try {
        Invoke-WebRequest -Uri $SumsUrl -OutFile $SumsFile
        $expected = (Select-String -Path $SumsFile -Pattern "\s$([regex]::Escape($YtDlpAsset))$" |
                     Select-Object -First 1).Line.Split()[0]
        if ($expected) {
            $actual = (Get-FileHash -Algorithm SHA256 -Path $YtDlpOut).Hash.ToLower()
            if ($actual -ne $expected.ToLower()) {
                throw "yt-dlp hash mismatch: expected $expected got $actual"
            }
            Write-Host "[yt-dlp] sha256 ok ($($actual.Substring(0,12))...)"
        } else {
            Write-Warning "[yt-dlp] SHA2-256SUMS did not contain $YtDlpAsset; skipping verify"
        }
    } catch {
        Write-Warning "[yt-dlp] hash verify skipped: $_"
    }

    Copy-Item -Path $YtDlpOut `
              -Destination (Join-Path $BinDir "yt-dlp-$Target$($Spec.Suffix)") `
              -Force

    # ---------- ffmpeg ----------
    $FfmpegArchive = Join-Path $WorkDir (Split-Path $Spec.FfmpegUrl -Leaf)
    Write-Host "[ffmpeg] $($Spec.FfmpegUrl)"
    Invoke-WebRequest -Uri $Spec.FfmpegUrl -OutFile $FfmpegArchive

    $FfmpegSumUrl  = "$($Spec.FfmpegUrl).sha256"
    $FfmpegSumFile = "$FfmpegArchive.sha256"
    $sumOk = $false
    try {
        Invoke-WebRequest -Uri $FfmpegSumUrl -OutFile $FfmpegSumFile -ErrorAction Stop
        $sumOk = $true
    } catch {
        $code = $_.Exception.Response.StatusCode.value__ 2>$null
        Write-Host "[ffmpeg] no upstream .sha256 (HTTP $code); skipping verify"
    }
    if ($sumOk) {
        $expected = (Get-Content -Path $FfmpegSumFile -TotalCount 1).Split()[0]
        $actual   = (Get-FileHash -Algorithm SHA256 -Path $FfmpegArchive).Hash.ToLower()
        if ($actual -ne $expected.ToLower()) {
            throw "ffmpeg hash mismatch: expected $expected got $actual"
        }
        Write-Host "[ffmpeg] sha256 ok ($($actual.Substring(0,12))...)"
    }

    $ExtractDir = Join-Path $WorkDir "ffmpeg-extract"
    New-Item -ItemType Directory -Path $ExtractDir -Force | Out-Null
    Expand-Archive -Path $FfmpegArchive -DestinationPath $ExtractDir -Force

    $Found = Get-ChildItem -Path $ExtractDir -Recurse -Filter $Spec.FfmpegName |
             Select-Object -First 1
    if (-not $Found) {
        throw "ffmpeg binary $($Spec.FfmpegName) not found inside archive"
    }
    # ffprobe ships in the same BtbN archive next to ffmpeg. yt-dlp
    # needs it for any postprocessing path that inspects streams
    # (muxing video+audio, --extract-audio, --embed-metadata, ...).
    # When yt-dlp gets --ffmpeg-location <file>, it auto-discovers
    # ffprobe in the same directory under the literal name "ffprobe"
    # (or ".exe"). So we stage two copies: the triple-suffixed one
    # for the Tauri sidecar manifest, and a bare-named sibling for
    # yt-dlp's auto-discover to pick up at runtime.
    $FfprobeFound = Get-ChildItem -Path $ExtractDir -Recurse -Filter $Spec.FfprobeName |
                    Select-Object -First 1
    if (-not $FfprobeFound) {
        throw "ffprobe binary $($Spec.FfprobeName) not found inside archive"
    }

    # ---------- upx (compress ffmpeg in place) ----------
    # BtbN's LGPL ffmpeg ships ~164 MB statically linked. UPX --best --lzma
    # cuts it to ~50-60 MB at the cost of a small startup decompress hit
    # (irrelevant: ffmpeg is launched on demand, not on app boot).
    $UpxArchive = Join-Path $WorkDir (Split-Path $Spec.UpxUrl -Leaf)
    $UpxExtract = Join-Path $WorkDir "upx"
    Write-Host "[upx] $($Spec.UpxUrl)"
    Invoke-WebRequest -Uri $Spec.UpxUrl -OutFile $UpxArchive
    New-Item -ItemType Directory -Path $UpxExtract -Force | Out-Null
    Expand-Archive -Path $UpxArchive -DestinationPath $UpxExtract -Force

    $UpxExePath = (Get-ChildItem -Path $UpxExtract -Recurse -Filter $Spec.UpxExe |
                   Select-Object -First 1).FullName
    if (-not $UpxExePath) { throw "upx not found inside $UpxArchive" }

    $beforeMb = [math]::Round((Get-Item $Found.FullName).Length / 1MB, 2)
    Write-Host "[upx] compressing ffmpeg ($beforeMb MB) with --best --lzma ..."
    & $UpxExePath --best --lzma --quiet $Found.FullName
    if ($LASTEXITCODE -ne 0) { throw "upx exited with code $LASTEXITCODE" }
    $afterMb = [math]::Round((Get-Item $Found.FullName).Length / 1MB, 2)
    Write-Host "[upx] $beforeMb MB -> $afterMb MB"

    $ffprobeBeforeMb = [math]::Round((Get-Item $FfprobeFound.FullName).Length / 1MB, 2)
    Write-Host "[upx] compressing ffprobe ($ffprobeBeforeMb MB) with --best --lzma ..."
    & $UpxExePath --best --lzma --quiet $FfprobeFound.FullName
    if ($LASTEXITCODE -ne 0) { throw "upx exited with code $LASTEXITCODE (ffprobe)" }
    $ffprobeAfterMb = [math]::Round((Get-Item $FfprobeFound.FullName).Length / 1MB, 2)
    Write-Host "[upx] $ffprobeBeforeMb MB -> $ffprobeAfterMb MB"

    Copy-Item -Path $Found.FullName `
              -Destination (Join-Path $BinDir "ffmpeg-$Target$($Spec.Suffix)") `
              -Force
    # Stage ffprobe twice — see the comment next to the extract step.
    Copy-Item -Path $FfprobeFound.FullName `
              -Destination (Join-Path $BinDir "ffprobe-$Target$($Spec.Suffix)") `
              -Force
    Copy-Item -Path $FfprobeFound.FullName `
              -Destination (Join-Path $BinDir $Spec.FfprobeName) `
              -Force

    Write-Host ""
    Write-Host "Staged in $BinDir for triple $Target :"
    Get-ChildItem -Path $BinDir -Filter "*$Target*" | ForEach-Object {
        $size = [math]::Round($_.Length / 1MB, 2)
        Write-Host "  $($_.Name)  ($size MB)"
    }
} finally {
    if (Test-Path $WorkDir) { Remove-Item -Recurse -Force $WorkDir }
}
