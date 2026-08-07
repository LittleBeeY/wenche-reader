$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing

$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$OutputDir = Join-Path $ProjectRoot "assets\desktop"
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

$Sizes = @(16, 24, 32, 48, 64, 128, 256)
$PngFiles = @()
$TempPngs = @()

foreach ($Size in $Sizes) {
  $Bitmap = New-Object System.Drawing.Bitmap($Size, $Size)
  $Graphics = [System.Drawing.Graphics]::FromImage($Bitmap)
  $Graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $Graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $Graphics.Clear([System.Drawing.Color]::Transparent)

  $Rect = New-Object System.Drawing.Rectangle(0, 0, $Size, $Size)
  $Radius = [Math]::Max(1, [Math]::Round($Size * 0.22))
  $Diameter = $Radius * 2
  $Path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $Path.AddArc($Rect.X, $Rect.Y, $Diameter, $Diameter, 180, 90)
  $Path.AddArc($Rect.Right - $Diameter, $Rect.Y, $Diameter, $Diameter, 270, 90)
  $Path.AddArc($Rect.Right - $Diameter, $Rect.Bottom - $Diameter, $Diameter, $Diameter, 0, 90)
  $Path.AddArc($Rect.X, $Rect.Bottom - $Diameter, $Diameter, $Diameter, 90, 90)
  $Path.CloseFigure()

  $Brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    $Rect,
    [System.Drawing.Color]::FromArgb(255, 34, 118, 118),
    [System.Drawing.Color]::FromArgb(255, 16, 58, 58),
    45
  )
  $Graphics.FillPath($Brush, $Path)

  $Font = New-Object System.Drawing.Font(
    "Microsoft YaHei",
    [single]($Size * 0.54),
    [System.Drawing.FontStyle]::Bold,
    [System.Drawing.GraphicsUnit]::Pixel
  )
  $Format = New-Object System.Drawing.StringFormat
  $Format.Alignment = [System.Drawing.StringAlignment]::Center
  $Format.LineAlignment = [System.Drawing.StringAlignment]::Center
  $Glyph = [string][char]0x6587
  $TextRect = New-Object System.Drawing.RectangleF(0, 0, [single]$Size, [single]$Size)
  $Graphics.DrawString($Glyph, $Font, [System.Drawing.Brushes]::White, $TextRect, $Format)

  $PngPath = Join-Path $OutputDir "icon-$Size.png"
  $Bitmap.Save($PngPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $TempPngs += $PngPath
  $PngFiles += [pscustomobject]@{ Size = $Size; Path = $PngPath }
  $Bitmap.Dispose()
  $Graphics.Dispose()
  $Path.Dispose()
  $Brush.Dispose()
  $Font.Dispose()
  $Format.Dispose()
}

$IcoPath = Join-Path $OutputDir "icon.ico"
$Stream = [System.IO.File]::Create($IcoPath)
$Writer = New-Object System.IO.BinaryWriter($Stream)
try {
  $Writer.Write([uint16]0)
  $Writer.Write([uint16]1)
  $Writer.Write([uint16]$PngFiles.Count)

  $Offset = 6 + (16 * $PngFiles.Count)
  foreach ($Png in $PngFiles) {
    $Bytes = [System.IO.File]::ReadAllBytes($Png.Path)
    $Dimension = if ($Png.Size -ge 256) { 0 } else { $Png.Size }
    $Writer.Write([byte]$Dimension)
    $Writer.Write([byte]$Dimension)
    $Writer.Write([byte]0)
    $Writer.Write([byte]0)
    $Writer.Write([uint16]1)
    $Writer.Write([uint16]32)
    $Writer.Write([uint32]$Bytes.Length)
    $Writer.Write([uint32]$Offset)
    $Offset += $Bytes.Length
  }

  foreach ($Png in $PngFiles) {
    $Writer.Write([System.IO.File]::ReadAllBytes($Png.Path))
  }
} finally {
  $Writer.Dispose()
  $Stream.Dispose()
}

foreach ($Png in $TempPngs) {
  Remove-Item -LiteralPath $Png -Force
}

Write-Host "Generated $IcoPath with $($PngFiles.Count) sizes."
