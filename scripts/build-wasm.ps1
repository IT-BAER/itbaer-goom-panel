#requires -version 5
<#
.SYNOPSIS
  Build cloudflare/doom-wasm via the official emscripten/emsdk Docker image.
  Outputs src\wasm\doom.js + src\wasm\doom.wasm.
#>
[CmdletBinding()]
param(
    [string]$EmsdkTag = '3.1.56',
    [switch]$Clean
)

$ErrorActionPreference = 'Stop'

$RootDir   = Split-Path -Parent $PSScriptRoot
$VendorDir = Join-Path $RootDir 'vendor\doom-wasm'
$OutDir    = Join-Path $RootDir 'src\wasm'

if (-not (Test-Path -LiteralPath $VendorDir)) {
    throw "vendor/doom-wasm missing. Run: git submodule update --init --recursive"
}
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw 'Docker is required (Path 3a). Install Docker Desktop or adjust to a host build.'
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$image = "emscripten/emsdk:$EmsdkTag"
Write-Host "[build-wasm] Using $image"

$cleanFlag = if ($Clean) { '1' } else { '0' }

# Build inside container.
$bashScript = @"
set -euo pipefail
if ! command -v autoreconf >/dev/null 2>&1; then
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -yqq --no-install-recommends autoconf automake libtool pkg-config dos2unix
elif ! command -v dos2unix >/dev/null 2>&1; then
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -yqq --no-install-recommends dos2unix
fi
# Normalize CRLF -> LF on ALL files in source tree (dos2unix auto-skips binaries).
find . -type f -print0 | xargs -0 -r dos2unix -q 2>/dev/null || true
if [ '$cleanFlag' = '1' ] || [ ! -f configure ]; then
  emmake make clean 2>/dev/null || true
fi
emconfigure autoreconf -fiv
ac_cv_exeext='.html' emconfigure ./configure --host=none-none-none
emmake make -j`$(nproc)
"@

# Normalize mount path for Docker on Windows.
$mount = (Resolve-Path -LiteralPath $VendorDir).Path
docker run --rm -v "${mount}:/src" -w /src $image bash -lc $bashScript
if ($LASTEXITCODE -ne 0) { throw "Docker build failed (exit $LASTEXITCODE)." }

$jsSrc   = Join-Path $VendorDir 'src\websockets-doom.js'
$wasmSrc = Join-Path $VendorDir 'src\websockets-doom.wasm'

if (-not (Test-Path -LiteralPath $jsSrc) -or -not (Test-Path -LiteralPath $wasmSrc)) {
    Write-Host "[build-wasm] ERROR: expected outputs not found:"
    Write-Host "  $jsSrc"
    Write-Host "  $wasmSrc"
    if (Test-Path (Join-Path $VendorDir 'src\doom')) {
        Get-ChildItem (Join-Path $VendorDir 'src\doom') | ForEach-Object { Write-Host "  $($_.Name)" }
    }
    throw 'Build outputs missing.'
}

Copy-Item -LiteralPath $jsSrc   -Destination (Join-Path $OutDir 'doom.js')   -Force
Copy-Item -LiteralPath $wasmSrc -Destination (Join-Path $OutDir 'doom.wasm') -Force

Write-Host "[build-wasm] OK:"
Get-ChildItem (Join-Path $OutDir 'doom.js'), (Join-Path $OutDir 'doom.wasm') |
    ForEach-Object { Write-Host "  $($_.Length) bytes  $($_.Name)" }
