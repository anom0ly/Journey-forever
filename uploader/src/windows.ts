// What the uploader asks of Windows: notifications, opening the browser,
// starting with Windows, a folder picker, and whether WoW is running. All
// through programs every Windows 10 and 11 PC has (PowerShell 5, reg,
// tasklist, rundll32). Elsewhere (tests, a Linux dev box) they log instead.

import { spawn } from "node:child_process";

export const IS_WINDOWS = process.platform === "win32";
const APP_ID = "JourneyForever.Uploader";
const RUN_KEY = "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const RUN_NAME = "JourneyForeverUploader";

function run(cmd: string, args: string[], timeoutMs = 60_000): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
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

// Runs a PowerShell script (passed encoded, so no quoting trouble).
export async function powershell(script: string, opts: { sta?: boolean; timeoutMs?: number } = {}): Promise<string> {
  if (!IS_WINDOWS) return "";
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const args = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", ...(opts.sta ? ["-STA"] : []), "-EncodedCommand", encoded];
  return (await run("powershell.exe", args, opts.timeoutMs)).out.trim();
}

// A PowerShell single-quoted string.
export function psQuote(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
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
$x.LoadXml(${psQuote(toastXml(title, body, url))})
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('${APP_ID}').Show([Windows.UI.Notifications.ToastNotification]::new($x))`);
}

export async function openUrl(url: string): Promise<void> {
  if (!IS_WINDOWS) {
    console.log(`[open] ${url}`);
    return;
  }
  await run("rundll32.exe", ["url.dll,FileProtocolHandler", url]);
}

// Start with Windows (or not, with exe undefined).
export async function setStartup(exe: string | undefined): Promise<void> {
  if (exe) {
    await powershell(`Set-ItemProperty -Path ${psQuote(RUN_KEY)} -Name ${psQuote(RUN_NAME)} -Value ${psQuote(`"${exe}" --background`)}`);
  } else {
    await powershell(`Remove-ItemProperty -Path ${psQuote(RUN_KEY)} -Name ${psQuote(RUN_NAME)} -ErrorAction SilentlyContinue`);
  }
}

// Windows' own folder picker; undefined when closed without choosing.
export async function pickFolder(start?: string): Promise<string | undefined> {
  const out = await powershell(
    `Add-Type -AssemblyName System.Windows.Forms
$d = New-Object System.Windows.Forms.FolderBrowserDialog
$d.Description = 'Choose your World of Warcraft folder (the one with _forever_ in it)'
${start ? `$d.SelectedPath = ${psQuote(start)}` : ""}
$f = New-Object System.Windows.Forms.Form
$f.TopMost = $true
if ($d.ShowDialog($f) -eq 'OK') { $d.SelectedPath }`,
    { sta: true, timeoutMs: 600_000 },
  );
  return out || undefined;
}

// Any WoW game running (Wow.exe, WowClassic.exe and the like).
export async function wowRunning(): Promise<boolean> {
  if (!IS_WINDOWS) return false;
  const { out } = await run("tasklist.exe", ["/FO", "CSV", "/NH"]);
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
