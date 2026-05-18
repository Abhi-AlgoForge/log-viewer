param(
  [Parameter(Mandatory=$true)] [string] $WindowTitleLike,
  [Parameter(Mandatory=$true)] [string] $OutPath
)

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WindowUtils {
  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll", SetLastError=true)]
  public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);
  [DllImport("dwmapi.dll")]
  public static extern int DwmGetWindowAttribute(IntPtr hWnd, int dwAttribute, out RECT pvAttribute, int cbAttribute);
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left, Top, Right, Bottom; }
}
"@

$proc = Get-Process | Where-Object { $_.MainWindowTitle -like $WindowTitleLike } | Select-Object -First 1
if (-not $proc) { Write-Error "No window matching $WindowTitleLike"; exit 1 }

$h = $proc.MainWindowHandle

# Bring to front, maximize-ish size for a nicer screenshot.
[WindowUtils]::ShowWindow($h, 9) | Out-Null  # SW_RESTORE
[WindowUtils]::MoveWindow($h, 80, 60, 1480, 900, $true) | Out-Null
[WindowUtils]::SetForegroundWindow($h) | Out-Null
Start-Sleep -Milliseconds 600

# DWM gives us the actual visible bounds excluding the invisible resize border.
$rect = New-Object WindowUtils+RECT
$ok = [WindowUtils]::DwmGetWindowAttribute($h, 9, [ref]$rect, [System.Runtime.InteropServices.Marshal]::SizeOf($rect))
if ($ok -ne 0) {
  [WindowUtils]::GetWindowRect($h, [ref]$rect) | Out-Null
}

$w = $rect.Right - $rect.Left
$ht = $rect.Bottom - $rect.Top
$bmp = New-Object System.Drawing.Bitmap($w, $ht)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($rect.Left, $rect.Top, 0, 0, (New-Object System.Drawing.Size($w, $ht)))
$g.Dispose()
$bmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()

Write-Host "Wrote $OutPath ($w x $ht)"
