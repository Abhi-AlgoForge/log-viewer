# Generates a 1024x1024 source icon at src-tauri/icons/source.png.
# Run `npm run tauri icon src-tauri/icons/source.png` afterwards to derive all
# the bundled .png/.ico/.icns variants.

Add-Type -AssemblyName System.Drawing

$size = 1024
$bmp  = New-Object System.Drawing.Bitmap($size, $size)
$g    = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode    = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.PixelOffsetMode  = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g.Clear([System.Drawing.Color]::Transparent)

function New-RoundedRect($x, $y, $w, $h, $r) {
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $path.AddArc($x, $y, $d, $d, 180, 90)
  $path.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $path.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $path.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  return $path
}

# Background panel — dark slate, rounded
$panelPath = New-RoundedRect 32 32 ($size - 64) ($size - 64) 180
$panelBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
  (New-Object System.Drawing.PointF(0, 0)),
  (New-Object System.Drawing.PointF(0, $size)),
  [System.Drawing.Color]::FromArgb(255, 30, 41, 59),
  [System.Drawing.Color]::FromArgb(255, 15, 23, 42))
$g.FillPath($panelBrush, $panelPath)

# Outline
$strokePen = New-Object System.Drawing.Pen(
  [System.Drawing.Color]::FromArgb(60, 148, 163, 184), 6)
$g.DrawPath($strokePen, $panelPath)

# Three log "lines" with color-coded left indicators
$lineX     = 180
$lineW     = 664
$lineH     = 92
$radius    = 20
$gapY      = 70
$startY    = 280
$indicatorW = 14
$indicatorGap = 26

$levels = @(
  @{ Color = [System.Drawing.Color]::FromArgb(255, 239, 68, 68);  TextLen = 520 }, # error red
  @{ Color = [System.Drawing.Color]::FromArgb(255, 234, 179, 8);  TextLen = 600 }, # warn yellow
  @{ Color = [System.Drawing.Color]::FromArgb(255, 34, 197, 94);  TextLen = 440 }  # info green
)

for ($i = 0; $i -lt $levels.Count; $i++) {
  $y = $startY + $i * ($lineH + $gapY)
  $lvl = $levels[$i]

  # Level color stripe
  $indicatorPath = New-RoundedRect $lineX $y $indicatorW $lineH 6
  $brush = New-Object System.Drawing.SolidBrush($lvl.Color)
  $g.FillPath($brush, $indicatorPath)
  $brush.Dispose()

  # Line body (subtle elevated background)
  $bodyX = $lineX + $indicatorW + $indicatorGap
  $bodyPath = New-RoundedRect $bodyX $y ($lineW - ($bodyX - $lineX)) $lineH $radius
  $bodyBrush = New-Object System.Drawing.SolidBrush(
    [System.Drawing.Color]::FromArgb(255, 51, 65, 85))
  $g.FillPath($bodyBrush, $bodyPath)
  $bodyBrush.Dispose()

  # Faux text bar inside the line (lighter slate, length varies per row)
  $textBarH = 24
  $textPath = New-RoundedRect ($bodyX + 28) ($y + ($lineH - $textBarH) / 2) `
    $lvl.TextLen $textBarH 8
  $textBrush = New-Object System.Drawing.SolidBrush(
    [System.Drawing.Color]::FromArgb(255, 148, 163, 184))
  $g.FillPath($textBrush, $textPath)
  $textBrush.Dispose()
}

$g.Dispose()

$dest = Join-Path $PSScriptRoot "..\src-tauri\icons\source.png"
$dest = [System.IO.Path]::GetFullPath($dest)
$bmp.Save($dest, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()

Write-Host "Wrote $dest"
