// What the uploader asks of Windows: notifications, opening the browser,
// starting with Windows, a folder picker, and whether WoW is running. All
// through programs every Windows 10 and 11 PC has (PowerShell 5, reg,
// tasklist, rundll32). Elsewhere (tests, a Linux dev box) they log instead.

import { spawn } from "node:child_process";
import { win32 } from "node:path";

export const IS_WINDOWS = process.platform === "win32";
const APP_ID = "JourneyForever.Uploader";
const RUN_KEY = "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const RUN_NAME = "JourneyForeverUploader";

// Windows' own programs, always by full path and run from System32: by bare
// name, Windows would look in the current folder first (Downloads, when the
// uploader was started from there), where a planted powershell.exe would win.
export const SYSTEM32 = win32.join(process.env.SystemRoot || "C:\\Windows", "System32");
export const POWERSHELL = win32.join(SYSTEM32, "WindowsPowerShell", "v1.0", "powershell.exe");
const TASKLIST = win32.join(SYSTEM32, "tasklist.exe");
const RUNDLL32 = win32.join(SYSTEM32, "rundll32.exe");

function run(cmd: string, args: string[], timeoutMs = 60_000, env?: Record<string, string>): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      cwd: IS_WINDOWS ? SYSTEM32 : undefined,
      env: env ? { ...process.env, ...env } : undefined,
    });
    let out = "";
    p.stdout?.on("data", (d) => (out += String(d)));
    const timer = setTimeout(() => p.kill(), timeoutMs);
    p.on("error", () => {
      clearTimeout(timer);
      resolve({ code: -1, out });
    });
    p.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, out });
    });
  });
}

// Runs a PowerShell script (passed encoded). Anything that comes from
// outside (names, messages, paths) goes in `args`, which the script reads as
// $env:JF_ARG0, $env:JF_ARG1…, never pasted into the script's text.
export async function powershell(script: string, opts: { sta?: boolean; timeoutMs?: number; args?: string[] } = {}): Promise<string> {
  if (!IS_WINDOWS) return "";
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const args = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", ...(opts.sta ? ["-STA"] : []), "-EncodedCommand", encoded];
  const env: Record<string, string> = {};
  (opts.args ?? []).forEach((a, i) => (env[`JF_ARG${i}`] = a));
  return (await run(POWERSHELL, args, opts.timeoutMs, env)).out.trim();
}

// A PowerShell single-quoted string, for fixed text only. PowerShell also
// ends a string at curly single quotes, so every kind is doubled.
export function psQuote(s: string): string {
  return `'${s.replace(/['\u2018\u2019\u201a\u201b]/g, (q) => q + q)}'`;
}

function xml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// The toast's XML: title, text, and (when url is set) a click that opens it.
export function toastXml(title: string, body: string, url?: string): string {
  const launch = url ? ` activationType="protocol" launch="${xml(url)}"` : "";
  const actions = url ? `<actions><action content="Open journey" activationType="protocol" arguments="${xml(url)}"/></actions>` : "";
  return `<toast${launch}><visual><binding template="ToastGeneric"><text>${xml(title)}</text><text>${xml(body)}</text></binding></visual>${actions}</toast>`;
}

// So notifications say "Journey Forever" rather than "Windows PowerShell".
async function registerAppId(): Promise<void> {
  await powershell(`$k = 'HKCU:\\Software\\Classes\\AppUserModelId\\${APP_ID}'
New-Item -Path $k -Force | Out-Null
Set-ItemProperty -Path $k -Name DisplayName -Value 'Journey Forever'`);
}

let registered = false;
export async function notify(title: string, body: string, url?: string): Promise<void> {
  if (!IS_WINDOWS) {
    console.log(`[notification] ${title}: ${body}${url ? ` (${url})` : ""}`);
    return;
  }
  if (!registered) {
    await registerAppId();
    registered = true;
  }
  await powershell(`[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
$x = New-Object Windows.Data.Xml.Dom.XmlDocument
$x.LoadXml($env:JF_ARG0)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('${APP_ID}').Show([Windows.UI.Notifications.ToastNotification]::new($x))`, { args: [toastXml(title, body, url)] });
}

export async function openUrl(url: string): Promise<void> {
  if (!IS_WINDOWS) {
    console.log(`[open] ${url}`);
    return;
  }
  if (!/^https?:\/\//i.test(url)) return; // only web pages, never a file or another program
  await run(RUNDLL32, ["url.dll,FileProtocolHandler", url]);
}

// Start with Windows (or not, with exe undefined).
export async function setStartup(exe: string | undefined): Promise<void> {
  if (exe) {
    await powershell(`Set-ItemProperty -Path ${psQuote(RUN_KEY)} -Name ${psQuote(RUN_NAME)} -Value $env:JF_ARG0`, { args: [`"${exe}" --background`] });
  } else {
    await powershell(`Remove-ItemProperty -Path ${psQuote(RUN_KEY)} -Name ${psQuote(RUN_NAME)} -ErrorAction SilentlyContinue`);
  }
}

// "Journey Forever Uploader" in the Start menu (or not, with exe undefined).
export async function setStartMenu(exe: string | undefined): Promise<void> {
  const script = exe
    ? `$p = Join-Path ([Environment]::GetFolderPath('Programs')) 'Journey Forever Uploader.lnk'
$s = (New-Object -ComObject WScript.Shell).CreateShortcut($p)
$s.TargetPath = $env:JF_ARG0
$s.WorkingDirectory = Split-Path $env:JF_ARG0
$s.IconLocation = "$($env:JF_ARG0),0"
$s.Description = 'Uploads your WoW Forever journey and screenshots to Journey Forever'
$s.Save()`
    : `Remove-Item -LiteralPath (Join-Path ([Environment]::GetFolderPath('Programs')) 'Journey Forever Uploader.lnk') -ErrorAction SilentlyContinue`;
  await powershell(script, { args: exe ? [exe] : [] });
}

// Windows' own folder picker; undefined when closed without choosing.
export async function pickFolder(start?: string): Promise<string | undefined> {
  const out = await powershell(
    `Add-Type -AssemblyName System.Windows.Forms
$d = New-Object System.Windows.Forms.FolderBrowserDialog
$d.Description = 'Choose your World of Warcraft folder (the one with _forever_ in it)'
if ($env:JF_ARG0) { $d.SelectedPath = $env:JF_ARG0 }
$f = New-Object System.Windows.Forms.Form
$f.TopMost = $true
if ($d.ShowDialog($f) -eq 'OK') { $d.SelectedPath }`,
    { sta: true, timeoutMs: 600_000, args: [start ?? ""] },
  );
  return out || undefined;
}

// Any WoW game running (Wow.exe, WowClassic.exe and the like).
export async function wowRunning(): Promise<boolean> {
  if (!IS_WINDOWS) return false;
  const { out } = await run(TASKLIST, ["/FO", "CSV", "/NH"]);
  return /"wow[\w-]*\.exe"/i.test(out);
}

// Where Battle.net says WoW is installed (often ...\World of Warcraft\_retail_\).
export async function registryWowPaths(): Promise<string[]> {
  const out = await powershell(`foreach ($k in 'HKLM:\\SOFTWARE\\WOW6432Node\\Blizzard Entertainment\\World of Warcraft', 'HKLM:\\SOFTWARE\\Blizzard Entertainment\\World of Warcraft') {
  try { (Get-ItemProperty -Path $k -ErrorAction Stop).InstallPath } catch {}
}`);
  return out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

export function computerName(): string {
  return process.env.COMPUTERNAME || process.env.HOSTNAME || "This PC";
}

// The upload key, encrypted with Windows DPAPI for this Windows user: the
// saved file is useless to another user or on another PC. Off Windows
// (tests, development) it's kept as it is, marked "plain:".
export async function protect(secret: string): Promise<string> {
  if (!IS_WINDOWS) return `plain:${secret}`;
  const out = await powershell(
    `Add-Type -AssemblyName System.Security
$b = [Text.Encoding]::UTF8.GetBytes($env:JF_ARG0)
[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($b, $null, 'CurrentUser'))`,
    { args: [secret] },
  );
  if (!out) throw new Error("Couldn't protect the key");
  return `dpapi:${out}`;
}

export async function unprotect(stored: string | undefined): Promise<string | undefined> {
  if (!stored) return undefined;
  if (stored.startsWith("plain:")) return IS_WINDOWS ? undefined : stored.slice(6);
  if (!stored.startsWith("dpapi:") || !IS_WINDOWS) return undefined;
  const out = await powershell(
    `Add-Type -AssemblyName System.Security
try { [Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($env:JF_ARG0), $null, 'CurrentUser')) } catch {}`,
    { args: [stored.slice(6)] },
  );
  return out || undefined;
}

// Deletes the uploader's folder a few seconds after it has quit (a running
// .exe can't delete itself).
export function deleteAfterExit(dir: string): void {
  if (!IS_WINDOWS) return;
  const cmd = win32.join(SYSTEM32, "cmd.exe"), ping = win32.join(SYSTEM32, "PING.EXE");
  spawn(cmd, ["/d", "/c", `"${ping}" -n 8 127.0.0.1 >nul & rmdir /s /q "${dir}"`], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    windowsVerbatimArguments: true,
    cwd: SYSTEM32,
  }).unref();
}
