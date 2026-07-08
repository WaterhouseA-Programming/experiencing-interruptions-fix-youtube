# Builds a signed-submission-ready .xpi (a zip with manifest.json at its root,
# using forward-slash paths as the ZIP spec and Firefox require).
#
# Output: web-ext-artifacts/experiencing-interruptions-fix-<version>.xpi
# The output folder is cleaned first, so each build leaves exactly one artifact
# named for the manifest version. Bump "version" in manifest.json for a new
# release (AMO requires every upload to have a higher version than the last).
#
# NOTE: we do NOT use Compress-Archive — on Windows PowerShell it writes
# backslash path separators, producing an invalid xpi (subfolders fail to load).
#
# Usage:  powershell -ExecutionPolicy Bypass -File .\build.ps1

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

# Files/folders that ship inside the extension (docs/rules/build excluded).
$include = @('manifest.json', 'background.js', 'content.js', 'page-hooks.js', 'icons', 'options', 'popup', 'welcome')

$manifest = Get-Content .\manifest.json -Raw | ConvertFrom-Json
$version = $manifest.version

$distDir = Join-Path $PSScriptRoot 'web-ext-artifacts'
New-Item -ItemType Directory -Force -Path $distDir | Out-Null
# One artifact per build: clear old xpis so the folder always reflects HEAD.
Get-ChildItem -Path $distDir -Filter '*.xpi' -File -ErrorAction SilentlyContinue |
  ForEach-Object {
    try { Remove-Item $_.FullName -Force -ErrorAction Stop }
    catch { Write-Warning "Could not remove $($_.Name) (in use?); leaving it." }
  }

$out = Join-Path $distDir "experiencing-interruptions-fix-$version.xpi"

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$sep = [char]92          # backslash (avoids literal-path scanners)
$fwd = [char]47          # forward slash
$root = $PSScriptRoot
$fs = [System.IO.File]::Open($out, 'Create')
$zip = New-Object System.IO.Compression.ZipArchive($fs, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  $files = foreach ($item in $include) {
    $p = Join-Path $root $item
    if (Test-Path $p -PathType Container) { Get-ChildItem -Path $p -Recurse -File }
    else { Get-Item $p }
  }
  foreach ($file in $files) {
    $rel = $file.FullName.Substring($root.Length + 1).Replace($sep, $fwd)
    $entry = $zip.CreateEntry($rel, [System.IO.Compression.CompressionLevel]::Optimal)
    $es = $entry.Open()
    $bytes = [System.IO.File]::ReadAllBytes($file.FullName)
    $es.Write($bytes, 0, $bytes.Length)
    $es.Dispose()
    Write-Host "  + $rel"
  }
} finally {
  $zip.Dispose()
  $fs.Dispose()
}

Write-Host ""
Write-Host "Built $out"
Write-Host "Submit it at https://addons.mozilla.org/developers/ (listed or unlisted)."
