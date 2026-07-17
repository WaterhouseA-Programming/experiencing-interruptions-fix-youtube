# Rasterises the icon to PNGs (48/96/128) for the manifest and AMO listing.
# Uses GDI+ so there is no dependency on ImageMagick/Inkscape.
# Design mirrors icons/icon.svg: dark rounded square, red screen, white play,
# green check badge on the bottom-right corner.
#
# Keep this in sync with icons/icon.svg — the coordinates below are the same
# 96x96 user units the SVG uses, scaled by $s.
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
  $screen = New-RoundRect (12 * $s) (20 * $s) (72 * $s) (48 * $s) (12 * $s)
  $g.FillPath($red, $screen)

  # white play triangle (41,34)(41,54)(59,44)
  $white = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
  $tri = @(
    (New-Object System.Drawing.PointF((41 * $s), (34 * $s))),
    (New-Object System.Drawing.PointF((41 * $s), (54 * $s))),
    (New-Object System.Drawing.PointF((59 * $s), (44 * $s)))
  )
  $g.FillPolygon($white, $tri)

  # green check badge, bottom-right. Dark ring first so the badge separates
  # from the red screen, then the green disc, then the tick.
  $dark = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 15, 15, 15))
  $g.FillEllipse($dark, (53 * $s), (53 * $s), (36 * $s), (36 * $s))
  $green = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 74, 222, 128))
  $g.FillEllipse($green, (57.5 * $s), (57.5 * $s), (27 * $s), (27 * $s))

  # tick (64.5,71.5)(69,76)(78,65.5), dark on green, rounded caps/joins
  $tick = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 15, 15, 15)), (5.5 * $s)
  $tick.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $tick.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $tick.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $pts = @(
    (New-Object System.Drawing.PointF((64.5 * $s), (71.5 * $s))),
    (New-Object System.Drawing.PointF((69 * $s), (76 * $s))),
    (New-Object System.Drawing.PointF((78 * $s), (65.5 * $s)))
  )
  $g.DrawLines($tick, $pts)

  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  Write-Host "  + $path ($size x $size)"
}

Save-Icon 48  (Join-Path $PSScriptRoot 'icons\icon-48.png')
Save-Icon 96  (Join-Path $PSScriptRoot 'icons\icon-96.png')
Save-Icon 128 (Join-Path $PSScriptRoot 'icons\icon-128.png')
Write-Host "Done."
