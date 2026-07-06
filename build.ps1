# Builds an unsigned .xpi (a zip with manifest.json at its root, using
# forward-slash paths as the ZIP spec and Firefox require) for submission to
# addons.mozilla.org or for loading in a signature-disabled Firefox.
#
# NOTE: we do NOT use Compress-Archive — on Windows PowerShell it writes
# backslash path separators, which produces an invalid xpi (subfolders fail to
# load). We build the zip entry-by-entry with forward slashes instead.
#
# Usage:  powershell -ExecutionPolicy Bypass -File .\build.ps1

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

# Files/folders that ship inside the extension (docs/rules/build excluded).
$include = @('manifest.json', 'background.js', 'content.js', 'icons', 'options', 'popup', 'welcome')

$manifest = Get-Content .\manifest.json -Raw | ConvertFrom-Json
$out = "experiencing-interruptions-fix-$($manifest.version).xpi"
if (Test-Path $out) { Remove-Item $out -Force }

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$root = (Get-Location).Path
$fs = [System.IO.File]::Open((Join-Path $root $out), 'Create')
$zip = New-Object System.IO.Compression.ZipArchive($fs, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  # Gather every file under the included paths.
  $files = foreach ($item in $include) {
    $p = Join-Path $root $item
    if (Test-Path $p -PathType Container) {
      Get-ChildItem -Path $p -Recurse -File
    } else {
      Get-Item $p
    }
  }

  foreach ($file in $files) {
    # Relative path with forward slashes = valid zip entry name.
    $rel = $file.FullName.Substring($root.Length + 1).Replace('\', '/')
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

Write-Host "Built $out"
Write-Host "Submit it at https://addons.mozilla.org/developers/ (listed or unlisted)."
