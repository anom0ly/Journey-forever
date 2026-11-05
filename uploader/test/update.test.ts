import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UPLOADER_VERSION } from "../../website/src/lib/uploader";
import { RELEASE_BOT, sha256Hex } from "../src/addon";
import { prepareHost } from "../src/host";
import { downloadUploader, pickUploaderRelease, removeOldExe, swapExe } from "../src/update";

const bot = { login: RELEASE_BOT };
const url = (v: string) => `https://github.com/anom0ly/Journey-forever/releases/download/uploader-v${v}/JourneyForeverUploader.exe`;
const HASH = "a".repeat(64);
const rel = (v: string, asset = {}, more = {}) => ({
  tag_name: `uploader-v${v}`, draft: false, prerelease: false, author: bot,
  assets: [{ name: "JourneyForeverUploader.exe", browser_download_url: url(v), size: 1000, digest: `sha256:${HASH}`, uploader: bot, ...asset }],
  ...more,
});

describe("updating the uploader", () => {
  it("picks the newest release our workflow published, newer than this one", () => {
    expect(pickUploaderRelease([rel("1.0.0"), rel("1.2.0"), rel("1.1.0")], "1.1.0")).toEqual({ version: "1.2.0", url: url("1.2.0"), sha256: HASH, size: 1000 });
    expect(pickUploaderRelease([rel("1.0.0"), rel("1.1.0")], "1.1.0")).toBeUndefined();
    expect(pickUploaderRelease([rel("1.3.0", {}, { prerelease: true })], "1.1.0")).toBeUndefined();
    expect(pickUploaderRelease([{ ...rel("1.2.0"), tag_name: "addon-v1.2.0" }], "1.1.0")).toBeUndefined();
  });

  it("refuses anything else", () => {
    const none = (asset = {}, more = {}) => expect(pickUploaderRelease([rel("9.0.0", asset, more)], "1.1.0")).toBeUndefined();
    none({}, { author: { login: "someone" } });
    none({ uploader: { login: "someone" } });
    none({ browser_download_url: "https://evil.example/JourneyForeverUploader.exe" });
    none({ digest: null });
    none({ digest: "md5:abc" });
    none({ size: 400e6 });
    none({ name: "Other.exe" });
  });

  it("only accepts the exact file GitHub recorded", async () => {
    const body = new TextEncoder().encode("new uploader");
    const r = { version: "1.2.0", url: url("1.2.0"), sha256: await sha256Hex(body), size: body.length };
    const get = async () => new Response(body);
    expect(await downloadUploader(r, get)).toEqual(body);
    await expect(downloadUploader({ ...r, sha256: HASH }, get)).rejects.toThrow(/checksum/);
    await expect(downloadUploader({ ...r, size: 5 }, get)).rejects.toThrow(/size/);
    await expect(downloadUploader({ ...r, url: "https://evil.example/x.exe" }, get)).rejects.toThrow(/address/);
  });

  it("swaps the new .exe in and keeps the old one aside until the next start", () => {
    const dir = mkdtempSync(join(tmpdir(), "jfu-"));
    const exe = join(dir, "JourneyForeverUploader.exe");
    writeFileSync(exe, "old");
    swapExe(exe, new TextEncoder().encode("new"));
    expect(readFileSync(exe, "utf8")).toBe("new");
    expect(readFileSync(`${exe}.old`, "utf8")).toBe("old");
    expect(existsSync(`${exe}.new`)).toBe(false);
    removeOldExe(exe);
    expect(existsSync(`${exe}.old`)).toBe(false);
  });

  it("writes out the window's files for this version and drops older ones", async () => {
    const home = mkdtempSync(join(tmpdir(), "jfu-"));
    const stale = join(home, "host", "0.9.0");
    await prepareHost(home);
    writeFileSync(join(home, "host", "x"), "");
    expect(readdirSync(join(home, "host", UPLOADER_VERSION)).sort()).toEqual(
      ["Microsoft.Web.WebView2.Core.dll", "Microsoft.Web.WebView2.WinForms.dll", "WebView2Loader.dll", "host.ps1", "icon.ico"].sort(),
    );
    expect(readFileSync(join(home, "host", UPLOADER_VERSION, "host.ps1"), "utf8")).toContain("SetCurrentProcessExplicitAppUserModelID");
    await prepareHost(home);
    expect(existsSync(stale)).toBe(false);
  });
});
