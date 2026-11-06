// CI check on a Windows runner: writes out the window's files, starts the
// host hidden the way the uploader does (windowsHide), opens the window on
// about:blank with JF_HOST_TEST=1, and expects "webview-ok": loaded, and
// actually visible on screen.
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareHost } from "../src/host";
import { POWERSHELL } from "../src/windows";

const dir = await prepareHost(mkdtempSync(join(tmpdir(), "jfu-")));
const r = spawnSync(POWERSHELL, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-STA", "-File", join(dir, "host.ps1")], {
  env: { ...process.env, JF_HOST_DIR: dir, JF_PORT: "1", JF_TOKEN: "test", JF_HOST_TEST: "1" },
  encoding: "utf8",
  windowsHide: true,
  timeout: 120_000,
});
console.log(r.stdout);
console.error(r.stderr);
if (!/webview-ok/.test(r.stdout ?? "")) {
  console.error(`Window check failed (exit ${r.status})`);
  process.exit(1);
}
console.log("Window and tray started, WebView2 loaded a page.");
