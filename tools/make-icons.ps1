# Regenerate extension toolbar icons (16/48/128 px PNG) into extension/icons.
# One-off tool; only needed when icon art is adjusted.
# Usage: pwsh -NoProfile -ExecutionPolicy Bypass -File tools/make-icons.ps1

$outDir = Join-Path $PSScriptRoot "..\extension\icons"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

Add-Type -AssemblyName System.Drawing

function New-RoundedRectPath([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = 2 * $r
    $p.AddArc($x, $y, $d, $d, 180, 90)
    $p.AddArc(($x + $w - $d), $y, $d, $d, 270, 90)
    $p.AddArc(($x + $w - $d), ($y + $h - $d), $d, $d, 0, 90)
    $p.AddArc($x, ($y + $h - $d), $d, $d, 90, 90)
    $p.CloseFigure()
    return $p
}

foreach ($s in 16, 48, 128) {
    $bmp = New-Object System.Drawing.Bitmap($s, $s)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::Transparent)

    # rounded square with diagonal indigo -> cyan gradient
    $r = [math]::Max(2.0, $s * 0.22)
    $path = New-RoundedRectPath 0 0 $s $s $r
    $c1 = [System.Drawing.Color]::FromArgb(255, 99, 102, 241)
    $c2 = [System.Drawing.Color]::FromArgb(255, 34, 211, 238)
    $rect = New-Object System.Drawing.RectangleF(0.0, 0.0, [float]$s, [float]$s)
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $c1, $c2, [float]35.0)
    $g.FillPath($brush, $path)

    # white magnifier (search)
    $penW = [math]::Max(1.6, $s * 0.075)
    $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::White, [float]$penW)
    $cx = $s * 0.44; $cy = $s * 0.46; $rad = $s * 0.20
    $g.DrawEllipse($pen, [float]($cx - $rad), [float]($cy - $rad), [float](2 * $rad), [float](2 * $rad))
    $g.DrawLine($pen, [float]($cx + $rad * 0.72), [float]($cy + $rad * 0.72), [float]($s * 0.80), [float]($s * 0.82))

    # green network dot with dark ring (top-right)
    $dotR = [math]::Max(2.0, $s * 0.10); $dx = $s * 0.76; $dy = $s * 0.24
    $ring = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 30, 41, 89))
    $g.FillEllipse($ring, [float]($dx - $dotR - $penW * 0.9), [float]($dy - $dotR - $penW * 0.9), [float](2 * $dotR + 1.8 * $penW), [float](2 * $dotR + 1.8 * $penW))
    $green = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 74, 222, 128))
    $g.FillEllipse($green, [float]($dx - $dotR), [float]($dy - $dotR), [float](2 * $dotR), [float](2 * $dotR))

    $out = Join-Path $outDir ("icon" + $s + ".png")
    $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose(); $brush.Dispose(); $pen.Dispose(); $path.Dispose(); $ring.Dispose(); $green.Dispose()
    Write-Host "wrote $out"
}
