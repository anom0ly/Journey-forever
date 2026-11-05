// Starts the window and tray icon (host.ps1) on Windows. The script, the
// WebView2 DLLs (vendor/webview2, from Microsoft's NuGet package) and the
// icon are inside the .exe; they're written out once per version to
// <home>\host\<version>\, which only this Windows user can write.

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { UPLOADER_VERSION } from "../../website/src/lib/uploader";
import coreDll from "../vendor/webview2/Microsoft.Web.WebView2.Core.dll" with { type: "file" };
import formsDll from "../vendor/webview2/Microsoft.Web.WebView2.WinForms.dll" with { type: "file" };
import loaderDll from "../vendor/webview2/WebView2Loader.dll" with { type: "file" };
import icon from "../assets/icon.ico" with { type: "file" };
import script from "./host.ps1" with { type: "file" };
import { POWERSHELL, SYSTEM32 } from "./windows";

const FILES: Record<string, string> = {
  "Microsoft.Web.WebView2.Core.dll": coreDll,
  "Microsoft.Web.WebView2.WinForms.dll": formsDll,
  "WebView2Loader.dll": loaderDll,
  "icon.ico": icon,
  "host.ps1": script,
};

// Writes the files for this version (if missing) and removes older versions'.
export async function prepareHost(home: string): Promise<string> {
  const root = join(home, "host");
  const dir = join(root, UPLOADER_VERSION);
  mkdirSync(dir, { recursive: true });
  for (const [name, src] of Object.entries(FILES)) {
    const target = join(dir, name);
    if (!existsSync(target)) writeFileSync(target, new Uint8Array(await Bun.file(src).arrayBuffer()));
  }
  for (const old of readdirSync(root)) {
    if (old === UPLOADER_VERSION) continue;
    try {
      rmSync(join(root, old), { recursive: true, force: true });
    } catch {
      // still in use: next time
    }
  }
  return dir;
}

export function startHost(dir: string, port: number, token: string, show: boolean): ChildProcess {
  return spawn(POWERSHELL, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-STA", "-WindowStyle", "Hidden", "-File", join(dir, "host.ps1")], {
    cwd: SYSTEM32,
    windowsHide: true,
    stdio: "ignore",
    env: { ...process.env, JF_HOST_DIR: dir, JF_PORT: String(port), JF_TOKEN: token, JF_SHOW: show ? "1" : "0" },
  });
}
