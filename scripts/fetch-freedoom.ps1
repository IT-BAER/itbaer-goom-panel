#requires -version 5
<#
.SYNOPSIS
  Fetch Freedoom 0.13.0 and extract freedoom1.wad into src/public/wads/.

.DESCRIPTION
  Idempotent: re-running after a successful fetch is a no-op.
  Freedoom is modified-BSD licensed and bundled as the default IWAD so the
  plugin can play immediately without any user-supplied assets. See NOTICE.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$FreedoomVersion = '0.13.0'
$ZipUrl          = "https://github.com/freedoom/freedoom/releases/download/v$FreedoomVersion/freedoom-$FreedoomVersion.zip"
$ZipSha256       = '3f9b264f3e3ce503b4fb7f6bdcb1f419d93c7b546f4df3e874dd878db9688f59'
$WadSha256       = '7323bcc168c5a45ff10749b339960e98314740a734c30d4b9f3337001f9e703d'

$RootDir  = Split-Path -Parent $PSScriptRoot
$CacheDir = Join-Path $RootDir '.cache\freedoom'
$OutDir   = Join-Path $RootDir 'src\public\wads'
$OutWad   = Join-Path $OutDir  'freedoom1.wad'
$ZipPath  = Join-Path $CacheDir "freedoom-$FreedoomVersion.zip"

New-Item -ItemType Directory -Force -Path $CacheDir, $OutDir | Out-Null

function Get-Sha256([string]$Path) {
    (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLower()
}

# Short-circuit if output WAD already verifies.
if (Test-Path -LiteralPath $OutWad) {
    if ((Get-Sha256 $OutWad) -eq $WadSha256) {
        Write-Host "[fetch-freedoom] freedoom1.wad already present and verified. Skipping."
        return
    }
    Write-Host "[fetch-freedoom] freedoom1.wad present but sha256 mismatch; re-fetching."
    Remove-Item -LiteralPath $OutWad -Force
}

# Download ZIP unless a verified copy is cached.
$needDownload = $true
if (Test-Path -LiteralPath $ZipPath) {
    if ((Get-Sha256 $ZipPath) -eq $ZipSha256) {
        $needDownload = $false
        Write-Host "[fetch-freedoom] Using cached $ZipPath"
    }
}

if ($needDownload) {
    Write-Host "[fetch-freedoom] Downloading $ZipUrl"
    Invoke-WebRequest -Uri $ZipUrl -OutFile $ZipPath -UseBasicParsing
    $got = Get-Sha256 $ZipPath
    if ($got -ne $ZipSha256) {
        throw "ZIP sha256 mismatch: expected $ZipSha256, got $got"
    }
    Write-Host "[fetch-freedoom] ZIP sha256 ok."
}

# Extract freedoom1.wad using .NET Zip API (no external deps).
Write-Host "[fetch-freedoom] Extracting freedoom1.wad -> $OutWad"
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
try {
    $entry = $zip.Entries | Where-Object { $_.FullName -eq "freedoom-$FreedoomVersion/freedoom1.wad" } | Select-Object -First 1
    if (-not $entry) { throw "freedoom1.wad not found inside ZIP." }
    [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $OutWad, $true)
} finally {
    $zip.Dispose()
}

$got = Get-Sha256 $OutWad
if ($got -ne $WadSha256) {
    throw "Extracted WAD sha256 mismatch: expected $WadSha256, got $got"
}

$size = (Get-Item -LiteralPath $OutWad).Length
Write-Host "[fetch-freedoom] OK: $OutWad ($size bytes, sha256 $WadSha256)"
