# The uploader's window and tray icon (Windows only). main.ts writes this
# file, with the WebView2 DLLs and the icon, to %LOCALAPPDATA%\JourneyForever\host\<version>\
# and runs it with Windows PowerShell 5.1, which every Windows 10 and 11 PC has.
#
# It talks to the uploader only over 127.0.0.1, with the instance token:
#   GET  /host/state  -> { dot, tip, paused, show, quit }   (every second)
#   POST /host/cmd    <- { cmd }  (menu clicks, "nowebview")
# When the uploader stops answering, this exits too.
#
# Inputs (environment): JF_HOST_DIR, JF_PORT, JF_TOKEN, JF_SHOW ("1" = open
# the window now). JF_HOST_TEST=1 opens the window on about:blank, prints
# "webview-ok" once it has loaded (or "webview-fail"), and exits: CI uses it.

$ErrorActionPreference = 'Stop'
$dir = $env:JF_HOST_DIR
$port = $env:JF_PORT
$token = $env:JF_TOKEN
$test = $env:JF_HOST_TEST -eq '1'
$base = "http://127.0.0.1:$port"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -Path (Join-Path $dir 'Microsoft.Web.WebView2.Core.dll')
Add-Type -Path (Join-Path $dir 'Microsoft.Web.WebView2.WinForms.dll')
[Microsoft.Web.WebView2.Core.CoreWebView2Environment]::SetLoaderDllFolderPath($dir)

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class JfNative {
  [DllImport("shell32.dll", CharSet = CharSet.Unicode)] public static extern int SetCurrentProcessExplicitAppUserModelID(string id);
  [DllImport("user32.dll")] public static extern bool DestroyIcon(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
}
'@
# The window and its taskbar button belong to Journey Forever, not PowerShell
# (same id as the notifications).
[void][JfNative]::SetCurrentProcessExplicitAppUserModelID('JourneyForever.Uploader')
[System.Windows.Forms.Application]::EnableVisualStyles()
# A failure inside a click or a timer tick must not pop up an error box.
[System.Windows.Forms.Application]::SetUnhandledExceptionMode([System.Windows.Forms.UnhandledExceptionMode]::CatchException)
# It's reported instead (see Send-Error), a few times per run at most.
$script:errorsSent = 0
[System.Windows.Forms.Application]::add_ThreadException({ param($s, $e) Send-Error $e.Exception.Message })

$iconPath = Join-Path $dir 'icon.ico'
$appIcon = New-Object System.Drawing.Icon($iconPath)

# ---- talking to the uploader -------------------------------------------------

function Invoke-Uploader([string]$method, [string]$path, [string]$body) {
  $req = [System.Net.HttpWebRequest]::Create("$base$path")
  $req.Method = $method
  $req.Proxy = $null
  $req.Timeout = 3000
  $req.ReadWriteTimeout = 3000
  $req.Headers.Add('x-token', $token)
  if ($body) {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
    $req.ContentType = 'application/json'
    $req.ContentLength = $bytes.Length
    $s = $req.GetRequestStream(); $s.Write($bytes, 0, $bytes.Length); $s.Close()
  }
  $res = $req.GetResponse()
  try {
    $reader = New-Object System.IO.StreamReader($res.GetResponseStream())
    return $reader.ReadToEnd()
  } finally { $res.Close() }
}

function Send-Command([string]$cmd) {
  try { [void](Invoke-Uploader 'POST' '/host/cmd' ("{""cmd"":""$cmd""}")) } catch {}
}

# The installed Edge WebView2 version, or $null when there's none.
function Get-WebViewVersion {
  try { return [Microsoft.Web.WebView2.Core.CoreWebView2Environment]::GetAvailableBrowserVersionString() } catch { return $null }
}

# A problem in the window or tray: the uploader cleans it and reports it.
function Send-Error([string]$message) {
  if ($test -or $script:errorsSent -ge 3) { return }
  $script:errorsSent++
  try {
    $body = ConvertTo-Json -Compress @{ cmd = 'error'; message = "$message"; webview = (Get-WebViewVersion) }
    [void](Invoke-Uploader 'POST' '/host/cmd' $body)
  } catch {}
}

# ---- tray icon ---------------------------------------------------------------

$dotColors = @{
  live = [System.Drawing.Color]::FromArgb(127, 224, 168)
  busy = [System.Drawing.Color]::FromArgb(229, 103, 92)
  warn = [System.Drawing.Color]::FromArgb(242, 196, 109)
  off  = [System.Drawing.Color]::FromArgb(138, 138, 138)
}
$trayIcons = @{}
function Get-TrayIcon([string]$dot) {
  if ($trayIcons.ContainsKey($dot)) { return $trayIcons[$dot] }
  $size = [System.Windows.Forms.SystemInformation]::SmallIconSize.Width
  if ($size -lt 16) { $size = 16 }
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $src = New-Object System.Drawing.Icon($iconPath, $size, $size)
  $g.DrawIcon($src, (New-Object System.Drawing.Rectangle(0, 0, $size, $size)))
  $d = [int][Math]::Round($size * 0.5)
  $x = $size - $d
  $g.FillEllipse((New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(32, 32, 32))), $x - 1, $x - 1, $d + 1, $d + 1)
  $g.FillEllipse((New-Object System.Drawing.SolidBrush($dotColors[$dot])), $x + 1, $x + 1, $d - 3, $d - 3)
  $g.Dispose(); $src.Dispose()
  $h = $bmp.GetHicon()
  $icon = [System.Drawing.Icon]::FromHandle($h).Clone()
  [void][JfNative]::DestroyIcon($h)
  $bmp.Dispose()
  $trayIcons[$dot] = $icon
  return $icon
}

$tray = New-Object System.Windows.Forms.NotifyIcon
$tray.Icon = Get-TrayIcon 'off'
$tray.Text = 'Journey Forever uploader'
$menu = New-Object System.Windows.Forms.ContextMenuStrip
$miOpen = $menu.Items.Add('Open uploader')
$miOpen.Font = New-Object System.Drawing.Font($miOpen.Font, [System.Drawing.FontStyle]::Bold)
$miSync = $menu.Items.Add('Upload now')
$miPause = $menu.Items.Add('Pause uploads')
$miJourney = $menu.Items.Add('Open my journey')
[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
$miUpdate = $menu.Items.Add('Check for updates')
$miQuit = $menu.Items.Add('Quit')
$tray.ContextMenuStrip = $menu

# ---- window ------------------------------------------------------------------

$script:quitting = $false
$script:paused = $false
$form = New-Object System.Windows.Forms.Form
$form.Text = 'Journey Forever Uploader'
$form.Icon = $appIcon
$form.StartPosition = 'CenterScreen'
$form.ClientSize = New-Object System.Drawing.Size(920, 680)
$form.MinimumSize = New-Object System.Drawing.Size(480, 420)
$form.BackColor = [System.Drawing.Color]::FromArgb(18, 13, 13)
$script:webview = $null
# The uploader starts this process hidden, and Windows applies that to the
# first window the process shows, whatever it asks for. Spend that first
# show on a hide now, so the real one later actually appears.
[void][JfNative]::ShowWindow($form.Handle, 0)

function Test-OwnUrl([string]$u) {
  return $u -eq $base -or $u.StartsWith("$base/") -or $u.StartsWith("$base?")
}

function Open-Browser([string]$u) {
  if ($u -match '^https?://') { Start-Process $u }
}

function New-WebView([string]$url) {
  $wv = New-Object Microsoft.Web.WebView2.WinForms.WebView2
  $wv.Dock = 'Fill'
  $wv.DefaultBackgroundColor = $form.BackColor
  $props = New-Object Microsoft.Web.WebView2.WinForms.CoreWebView2CreationProperties
  $props.UserDataFolder = Join-Path (Split-Path (Split-Path $dir)) 'webview-data'
  $wv.CreationProperties = $props
  $wv.add_CoreWebView2InitializationCompleted({
    param($s, $e)
    if (-not $e.IsSuccess) {
      if ($test) { [Console]::Out.WriteLine('webview-fail ' + $e.InitializationException.Message); $script:quitting = $true; [System.Windows.Forms.Application]::Exit(); return }
      # No WebView2 on this PC: the uploader opens its page in the browser instead.
      Send-Error ('WebView2 could not start: ' + $e.InitializationException.Message)
      Send-Command 'nowebview'
      $script:noWebView = $true
      $form.Hide()
      return
    }
    $c = $s.CoreWebView2
    $c.Settings.AreDevToolsEnabled = $false
    $c.Settings.AreDefaultContextMenusEnabled = $false
    $c.Settings.IsStatusBarEnabled = $false
    $c.Settings.IsZoomControlEnabled = $false
    # Only the uploader's own page stays in the window; links go to the browser.
    $c.add_NewWindowRequested({ param($s2, $e2) $e2.Handled = $true; Open-Browser $e2.Uri })
    $c.add_NavigationStarting({
      param($s2, $e2)
      if (-not $test -and -not (Test-OwnUrl $e2.Uri)) { $e2.Cancel = $true; Open-Browser $e2.Uri }
    })
    if ($test) {
      $c.add_NavigationCompleted({
        param($s2, $e2)
        # The window must really be on screen, not just loaded.
        $shown = [JfNative]::IsWindowVisible($form.Handle)
        [Console]::Out.WriteLine($(if (-not $e2.IsSuccess) { 'webview-fail navigation' } elseif (-not $shown) { 'webview-fail hidden' } else { 'webview-ok' }))
        $script:quitting = $true
        [System.Windows.Forms.Application]::Exit()
      })
    }
  })
  $form.Controls.Add($wv)
  $wv.Source = New-Object System.Uri($url)
  $script:webview = $wv
}

function Show-Window {
  if ($script:noWebView) { Send-Command 'nowebview'; return }
  if (-not $script:webview) {
    New-WebView $(if ($test) { 'about:blank' } else { "$base/?t=$token&app=1" })
  }
  if (-not $form.Visible) { $form.Show() }
  if ($form.WindowState -eq 'Minimized') { $form.WindowState = 'Normal' }
  [void][JfNative]::ShowWindow($form.Handle, 5) # SW_SHOW, in case Windows hid it anyway
  $form.Activate()
  [void][JfNative]::SetForegroundWindow($form.Handle)
}

# The X minimizes: the uploader keeps running (Quit is in the tray menu).
$form.add_FormClosing({
  param($s, $e)
  if (-not $script:quitting -and $e.CloseReason -eq [System.Windows.Forms.CloseReason]::UserClosing) {
    $e.Cancel = $true
    $form.WindowState = 'Minimized'
  }
})

function Stop-Host {
  $script:quitting = $true
  $timer.Stop()
  $tray.Visible = $false
  [System.Windows.Forms.Application]::Exit()
}

$tray.add_MouseClick({ param($s, $e) if ($e.Button -eq [System.Windows.Forms.MouseButtons]::Left) { Show-Window } })
$miOpen.add_Click({ Show-Window })
$miSync.add_Click({ Send-Command 'sync' })
$miPause.add_Click({ Send-Command $(if ($script:paused) { 'resume' } else { 'pause' }) })
$miJourney.add_Click({ Send-Command 'journey' })
$miUpdate.add_Click({ Send-Command 'check-update' })
$miQuit.add_Click({ Send-Command 'quit'; Stop-Host })

# ---- keeping up with the uploader --------------------------------------------

$script:fails = 0
$script:lastDot = ''
$script:lastShow = -1
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 1000
$timer.add_Tick({
  if ($test) { return }
  try {
    $visible = if ($form.Visible -and $form.WindowState -ne 'Minimized') { '1' } else { '0' }
    $st = (Invoke-Uploader 'GET' "/host/state?visible=$visible" $null) | ConvertFrom-Json
    $script:fails = 0
    if ($st.dot -ne $script:lastDot -and $dotColors.ContainsKey([string]$st.dot)) { $tray.Icon = Get-TrayIcon ([string]$st.dot); $script:lastDot = $st.dot }
    $tip = [string]$st.tip
    if ($tip.Length -gt 63) { $tip = $tip.Substring(0, 62) + [char]0x2026 }
    if ($tray.Text -ne $tip) { $tray.Text = $tip }
    $script:paused = [bool]$st.paused
    $miPause.Text = $(if ($script:paused) { 'Resume uploads' } else { 'Pause uploads' })
    if ($script:lastShow -ge 0 -and $st.show -ne $script:lastShow) { Show-Window }
    $script:lastShow = $st.show
    if ($st.quit) { Stop-Host }
  } catch {
    $script:fails++
    if ($script:fails -ge 5) { Stop-Host } # the uploader has stopped
  }
})

$tray.Visible = $true
$timer.Start()
if ($test -or $env:JF_SHOW -eq '1') { Show-Window }
if ($test) {
  $deadline = New-Object System.Windows.Forms.Timer
  $deadline.Interval = 60000
  $deadline.add_Tick({ [Console]::Out.WriteLine('webview-fail timeout'); $script:quitting = $true; [System.Windows.Forms.Application]::Exit() })
  $deadline.Start()
}

$ErrorActionPreference = 'Continue'
$ctx = New-Object System.Windows.Forms.ApplicationContext
[System.Windows.Forms.Application]::Run($ctx)
$tray.Visible = $false
$tray.Dispose()
