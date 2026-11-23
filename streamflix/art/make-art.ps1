# Draws StreamFlix's icons and TV banner into streamflix/art/overlay, laid out as the files they
# replace (streamflix/brand.mjs copies them over dx.bi's at release time).
#   powershell -ExecutionPolicy Bypass -File streamflix\art\make-art.ps1
# The letters are Bebas Neue (tv/app/src/mobile/res/font/bebas_neue.ttf, SIL Open Font License), in
# the skin's own red (--dx-accent) on a black tile, like the name in the app's top bar. Plain upright
# letters: nothing here is dx.bi's logo, or a copy of any streaming service's.
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$overlay = Join-Path $PSScriptRoot 'overlay'
$fonts = New-Object System.Drawing.Text.PrivateFontCollection
$fonts.AddFontFile((Join-Path $root 'tv\app\src\mobile\res\font\bebas_neue.ttf'))
$family = $fonts.Families[0]

function New-Art {
    param([int]$Width, [int]$Height, [string]$Text, [double]$WidthShare, [double]$HeightShare, [bool]$Tile, [bool]$Bar, [string]$Out)
    $format = if ($Tile) { [System.Drawing.Imaging.PixelFormat]::Format24bppRgb } else { [System.Drawing.Imaging.PixelFormat]::Format32bppArgb }
    $bmp = New-Object System.Drawing.Bitmap($Width, $Height, $format)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    if ($Tile) {
        $all = New-Object System.Drawing.Rectangle(0, 0, $Width, $Height)
        $g.Clear([System.Drawing.Color]::Black)
    } else {
        $g.Clear([System.Drawing.Color]::Transparent)
    }
    # the letters as a shape, then sized and centred by their real outline (not the font's line box)
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddString($Text, $family, 0, 200.0, (New-Object System.Drawing.PointF(0, 0)), (New-Object System.Drawing.StringFormat))
    $b = $path.GetBounds()
    $scale = [Math]::Min(($Width * $WidthShare) / $b.Width, ($Height * $HeightShare) / $b.Height)
    $lift = if ($Bar) { $Height * 0.04 } else { 0 }
    $m = New-Object System.Drawing.Drawing2D.Matrix
    $m.Translate([single](($Width - $b.Width * $scale) / 2 - $b.X * $scale), [single](($Height - $b.Height * $scale) / 2 - $b.Y * $scale - $lift))
    $m.Scale([single]$scale, [single]$scale)
    $path.Transform($m)
    $t = $path.GetBounds()
    $barTop = $t.Bottom + $Height * 0.05
    $barHeight = [Math]::Max(2.0, $Height * 0.035)
    $span = New-Object System.Drawing.RectangleF($t.X, $t.Y, $t.Width, ($barTop + $barHeight - $t.Y))
    $fill = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 229, 9, 20))
    $g.FillPath($fill, $path)
    if ($Bar) { $g.FillRectangle($fill, [single]$t.X, [single]$barTop, [single]$t.Width, [single]$barHeight) }
    $fill.Dispose(); $g.Dispose()
    $file = Join-Path $overlay $Out
    New-Item -ItemType Directory -Force (Split-Path -Parent $file) | Out-Null
    $bmp.Save($file, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Output ("{0}  {1}x{2}" -f $Out, $Width, $Height)
}

$res = 'tv\app\src\main\res'
$sizes = @{ mdpi = 1.0; hdpi = 1.5; xhdpi = 2.0; xxhdpi = 3.0; xxxhdpi = 4.0 }
foreach ($d in $sizes.Keys) {
    $k = $sizes[$d]
    # the square icon (Android TV, and phones before Android 8)
    New-Art -Width ([int](48 * $k)) -Height ([int](48 * $k)) -Text 'SF' -WidthShare 0.60 -HeightShare 0.54 -Tile $true -Bar $false -Out "$res\mipmap-$d\ic_launcher.png"
    # the adaptive icon's front layer: only the middle two thirds is sure to show
    New-Art -Width ([int](108 * $k)) -Height ([int](108 * $k)) -Text 'SF' -WidthShare 0.34 -HeightShare 0.30 -Tile $false -Bar $false -Out "$res\mipmap-$d\ic_launcher_foreground.png"
}
# the tile on a TV's home screen
New-Art -Width 960 -Height 540 -Text 'STREAMFLIX' -WidthShare 0.80 -HeightShare 0.44 -Tile $true -Bar $false -Out "$res\drawable\banner.png"
# the iPhone and iPad icon (no transparency)
New-Art -Width 1024 -Height 1024 -Text 'SF' -WidthShare 0.60 -HeightShare 0.54 -Tile $true -Bar $false -Out 'ios\Dxbi\Assets.xcassets\AppIcon.appiconset\icon-1024.png'
