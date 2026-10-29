# Bits of the screen for Capri's teleports to tear open (screengrab.js). Waits on its stdin: one
# line in, rects in physical screen pixels ("x,y,w,h;x,y,w,h"); one line out, a JSON array of
# base64 JPEGs, null for a rect it can't copy. Nothing is kept. Ends when its stdin does.
#
#   powershell -File screengrab.ps1

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class CapriGrab {
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
}
"@
[CapriGrab]::SetProcessDpiAwarenessContext([IntPtr]::new(-4)) | Out-Null # per-monitor v2: real pixels

$jpeg = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$quality = New-Object System.Drawing.Imaging.EncoderParameters 1
$quality.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), 85L

while ($null -ne ($line = [Console]::In.ReadLine())) {
  $out = foreach ($rect in $line.Split(';')) {
    try {
      $v = $rect.Split(',') | ForEach-Object { [int]$_ }
      if ($v.Count -ne 4 -or $v[2] -lt 8 -or $v[3] -lt 8) { 'null'; continue }
      $bmp = New-Object System.Drawing.Bitmap $v[2], $v[3]
      $g = [System.Drawing.Graphics]::FromImage($bmp)
      $g.CopyFromScreen($v[0], $v[1], 0, 0, $bmp.Size)
      $ms = New-Object System.IO.MemoryStream
      $bmp.Save($ms, $jpeg, $quality)
      '"' + [Convert]::ToBase64String($ms.ToArray()) + '"'
      $g.Dispose(); $bmp.Dispose(); $ms.Dispose()
    } catch {
      'null'
    }
  }
  [Console]::Out.WriteLine('[' + (@($out) -join ',') + ']')
  [Console]::Out.Flush()
}
