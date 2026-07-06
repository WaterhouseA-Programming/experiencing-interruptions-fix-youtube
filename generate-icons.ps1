# Rasterises the icon to PNGs (48/96/128) for the manifest and AMO listing.
# Uses GDI+ so there is no dependency on ImageMagick/Inkscape.
# Design mirrors icons/icon.svg: dark rounded square, red screen, white play,
# green "fix" slash.
#
# Usage:  powershell -ExecutionPolicy Bypass -File .\generate-icons.ps1

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
Add-Type -AssemblyName System.Drawing

function New-RoundRect([single]$x, [single]$y, [single]$w, [single]$h, [single]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

function Save-Icon([int]$size, [string]$path) {
  $s = $size / 96.0
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)

  # background rounded square (#0f0f0f)
  $bg = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 15, 15, 15))
  $bgPath = New-RoundRect 0 0 $size $size (18 * $s)
  $g.FillPath($bg, $bgPath)

  # red screen (#ff0033)
  $red = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 255, 0, 51))
  $screen = New-RoundRect (14 * $s) (26 * $s) (68 * $s) (44 * $s) (9 * $s)
  $g.FillPath($red, $screen)

  # white play triangle (42,40)(42,56)(58,48)
  $white = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
  $tri = @(
    (New-Object System.Drawing.PointF((42 * $s), (40 * $s))),
    (New-Object System.Drawing.PointF((42 * $s), (56 * $s))),
    (New-Object System.Drawing.PointF((58 * $s), (48 * $s)))
  )
  $g.FillPolygon($white, $tri)

  # green "fix" slash (#4ade80), rounded caps
  $green = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(230, 74, 222, 128)), (7 * $s)
  $green.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $green.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $g.DrawLine($green, (20 * $s), (20 * $s), (76 * $s), (76 * $s))

  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  Write-Host "  + $path ($size x $size)"
}

Save-Icon 48  (Join-Path $PSScriptRoot 'icons\icon-48.png')
Save-Icon 96  (Join-Path $PSScriptRoot 'icons\icon-96.png')
Save-Icon 128 (Join-Path $PSScriptRoot 'icons\icon-128.png')
Write-Host "Done."
