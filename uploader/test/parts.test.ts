import { describe, expect, it } from "bun:test";
import { zipSync } from "fflate";
import { mkdtempSync, readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import jpeg from "jpeg-js";
import { addonFiles, installAddon, isNewer, keepAddonCurrent, MAX_ZIP_BYTES, pickRelease, RELEASE_BOT, tocVersion } from "../src/addon";
import { asciiJson } from "../src/client";
import { decodeTga, MAX_TGA_SIDE, prepareImage, shrink } from "../src/images";
import { esc, scriptJson, statusPage } from "../src/page";
import { handler, hostOk } from "../src/server";
import { psQuote, toastXml } from "../src/windows";
import { candidateRoots, foreverIn } from "../src/wow";
import { trayState, WindowControl } from "../src/window";
import type { Status, Uploader } from "../src/app";

const enc = (s: string) => new TextEncoder().encode(s);

describe("screenshots", () => {
  it("makes a thumbnail of a JPEG and keeps the original", async () => {
    const data = new Uint8Array(1920 * 1080 * 4).fill(200);
    const bytes = new Uint8Array(jpeg.encode({ width: 1920, height: 1080, data }, 90).data);
    const img = await prepareImage("WoWScrnShot_110426_183015.jpg", bytes);
    expect(img.id).toMatch(/^[0-9a-f]{32}$/);
    expect(img.image).toBe(bytes);
    expect([img.width, img.height]).toEqual([1920, 1080]);
    const thumb = jpeg.decode(img.thumb!);
    expect([thumb.width, thumb.height]).toEqual([480, 270]);
  });

  it("turns an RLE TGA into JPEG", async () => {
    // 2x2, bottom-up, RLE: one packet of 4 blue-green-red pixels.
    const head = new Uint8Array(18);
    head[2] = 10; head[12] = 2; head[14] = 2; head[16] = 24;
    const tga = new Uint8Array([...head, 0x83, 10, 20, 30]);
    const px = decodeTga(tga);
    const huge = tga.slice();
    huge[12] = 0xff;
    huge[13] = 0xff; // 65535 wide
    expect(() => decodeTga(huge)).toThrow(/too big/);
    expect(MAX_TGA_SIDE).toBeGreaterThanOrEqual(7680);
    expect([px.width, px.height]).toEqual([2, 2]);
    expect([...px.data.slice(0, 4)]).toEqual([30, 20, 10, 255]);
    const img = await prepareImage("WoWScrnShot_110426_183015.tga", tga);
    expect(img.type).toBe("image/jpeg");
    expect(jpeg.decode(img.image).width).toBe(2);
  });

  it("shrinks by averaging", () => {
    const p = shrink({ width: 4, height: 2, data: new Uint8Array([0, 0, 0, 255, 100, 100, 100, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 100, 100, 100, 255, 0, 0, 0, 255, 0, 0, 0, 255]) }, 2);
    expect([p.width, p.height]).toEqual([2, 1]);
    expect(p.data[0]).toBe(50);
  });

  it("sends labels with accents safely in a header", () => {
    expect(asciiJson({ label: "Zul'Farrak – Gahz'rilla" })).toBe('{"label":"Zul\'Farrak \\u2013 Gahz\'rilla"}');
    expect(JSON.parse(asciiJson({ label: "Été" })).label).toBe("Été");
  });
});

describe("the addon", () => {
  const zip = (files: Record<string, string>) => zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, enc(v)])));

  it("reads versions and picks the newest addon release", () => {
    expect(tocVersion("## Interface: 16001\r\n## Version: 1.1.0\r\n")).toBe("1.1.0");
    expect(isNewer("1.10.0", "1.9.2")).toBe(true);
    expect(isNewer("1.1.0", "1.1.0")).toBe(false);
    expect(isNewer("1.0.0", undefined)).toBe(true);
    const bot = { login: RELEASE_BOT };
    const url = (v: string) => `https://github.com/anom0ly/Journey-forever/releases/download/addon-v${v}/JourneyForever-${v}.zip`;
    const asset = (v: string) => [{ name: `JourneyForever-${v}.zip`, browser_download_url: url(v), size: 40_000, uploader: bot }];
    const rel = (tag: string, assets = asset(tag.slice(tag.indexOf("-v") + 2)), more = {}) => ({ tag_name: tag, draft: false, prerelease: false, author: bot, assets, ...more });
    expect(
      pickRelease([
        rel("uploader-v2.0.0", []),
        rel("addon-v1.2.0", undefined, { prerelease: true }),
        rel("addon-v1.1.0"),
        rel("addon-v1.0.0"),
      ]),
    ).toEqual({ version: "1.1.0", url: url("1.1.0") });
  });

  it("only takes a zip our own release workflow published", () => {
    const bot = { login: RELEASE_BOT };
    const good = "https://github.com/anom0ly/Journey-forever/releases/download/addon-v9.0.0/JourneyForever-9.0.0.zip";
    const asset = (o = {}) => ({ name: "JourneyForever-9.0.0.zip", browser_download_url: good, size: 40_000, uploader: bot, ...o });
    const rel = (o = {}, a = {}) => [{ tag_name: "addon-v9.0.0", draft: false, prerelease: false, author: bot, assets: [asset(a)], ...o }];
    expect(pickRelease(rel())?.version).toBe("9.0.0");
    expect(pickRelease(rel({ author: { login: "someone" } }))).toBeUndefined();
    expect(pickRelease(rel({}, { uploader: { login: "someone" } }))).toBeUndefined();
    expect(pickRelease(rel({}, { browser_download_url: "https://evil.example/JourneyForever-9.0.0.zip" }))).toBeUndefined();
    expect(pickRelease(rel({}, { size: MAX_ZIP_BYTES + 1 }))).toBeUndefined();
  });

  it("refuses a zip with files outside the addon folder", () => {
    expect(() => addonFiles(zip({ "JourneyForever/JourneyForever.toc": "x", "JourneyForever/../../evil.lua": "x" }))).toThrow();
    expect(() => addonFiles(zip({ "Other/Other.toc": "x" }))).toThrow();
    expect(() => addonFiles(zip({ "JourneyForever/Core.lua": "x" }))).toThrow(/toc/);
    // A small zip with huge contents.
    expect(() => addonFiles(zipSync({ "JourneyForever/JourneyForever.toc": enc("x"), "JourneyForever/big.lua": new Uint8Array(25e6) }))).toThrow(/too big/);
  });

  it("installs, updates in place, and waits while WoW is running", async () => {
    const root = mkdtempSync(join(tmpdir(), "jfu-"));
    const dir = join(root, "Interface", "AddOns", "JourneyForever");
    const release = (v: string) => ({ version: v, url: `https://x/${v}.zip` });
    const download = async (url: string) => zip({ "JourneyForever/JourneyForever.toc": `## Version: ${url.match(/[\d.]+(?=\.zip)/)![0]}\n`, "JourneyForever/Core.lua": url });
    let open = false;
    const wowRunning = async () => open;

    expect(await keepAddonCurrent(dir, { wowRunning, latest: async () => release("1.0.0"), download })).toMatchObject({ status: "installed", version: "1.0.0", sha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
    writeFileSync(join(dir, "Stale.lua"), "old");
    expect(await keepAddonCurrent(dir, { wowRunning, latest: async () => release("1.0.0"), download })).toEqual({ status: "current", version: "1.0.0" });

    open = true;
    expect((await keepAddonCurrent(dir, { wowRunning, latest: async () => release("1.1.0"), download })).status).toBe("waiting");
    open = false;
    expect(await keepAddonCurrent(dir, { wowRunning, latest: async () => release("1.1.0"), download })).toMatchObject({ status: "updated", version: "1.1.0", from: "1.0.0" });
    expect(readFileSync(join(dir, "JourneyForever.toc"), "utf8")).toContain("1.1.0");
    expect(existsSync(join(dir, "Stale.lua"))).toBe(false);
    expect(existsSync(`${dir}.old`) || existsSync(`${dir}.new`)).toBe(false);
  });

  it("keeps the old addon if the new one can't be written", async () => {
    const root = mkdtempSync(join(tmpdir(), "jfu-"));
    const dir = join(root, "JourneyForever");
    mkdirSync(dir);
    writeFileSync(join(dir, "JourneyForever.toc"), "## Version: 1.0.0\n");
    await expect(installAddon(dir, new Map([["\0bad", enc("x")]]))).rejects.toThrow();
    expect(readFileSync(join(dir, "JourneyForever.toc"), "utf8")).toContain("1.0.0");
  });
});

describe("finding WoW", () => {
  it("looks where Battle.net says, then the usual folders", () => {
    const roots = candidateRoots(["C:\\Program Files (x86)\\World of Warcraft\\_retail_\\"], ["C", "D"]);
    expect(roots[0]).toBe("C:\\Program Files (x86)\\World of Warcraft");
    expect(roots).toContain("D:\\World of Warcraft");
    expect(new Set(roots).size).toBe(roots.length);
  });

  it("accepts the WoW folder or _forever_ itself", () => {
    const root = mkdtempSync(join(tmpdir(), "jfu-"));
    mkdirSync(join(root, "_forever_"));
    expect(foreverIn(root)).toBe(join(root, "_forever_"));
    expect(foreverIn(join(root, "_forever_"))).toBe(join(root, "_forever_"));
    expect(foreverIn(tmpdir())).toBeUndefined();
  });
});

describe("the status page and notifications", () => {
  const status: Status = {
    version: "1.0.0", site: "https://site", connected: true, account: "Justin#1234", forever: "C:\\WoW\\_forever_", paused: false,
    characters: ["Adom"], log: [{ t: 1793900000, text: "<b>Adom</b> uploaded", ok: true }], startup: true, reports: true,
    update: { note: "Up to date", auto: true, canCheck: true },
  };
  const calls: string[] = [];
  const fake = {
    status: () => status,
    connected: async () => ({ ok: true, message: "ok" }),
    uploadNow: () => calls.push("sync"),
    setPaused: (p: boolean) => calls.push(p ? "pause" : "resume"),
    checkForUpdates: () => calls.push("check-update"),
  } as unknown as Uploader;
  const win = new WindowControl();
  const hooks = {
    uploader: fake, token: "page", instanceToken: "inst", window: win,
    pickFolder: async () => {}, remove: async () => {}, quit() {},
    openJourney: async () => void calls.push("journey"),
    openInBrowser: async () => void calls.push("browser"),
    setStartup: async (on: boolean) => void calls.push(on ? "startup-on" : "startup-off"),
  };
  const serve = handler(hooks, () => 47213);
  const req = (path: string, init: RequestInit & { host?: string } = {}) =>
    serve(new Request(`http://127.0.0.1:47213${path}`, { ...init, headers: { host: init.host ?? "127.0.0.1:47213", ...(init.headers as Record<string, string>) } }));

  it("escapes what it shows", () => {
    expect(esc(`<a href="x">'`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;");
    expect(statusPage(status, "page")).toContain("&lt;b&gt;Adom&lt;/b&gt; uploaded");
    expect(toastXml("A & B", "<x>", "https://s/c?a=1&b=2")).toContain('launch="https://s/c?a=1&amp;b=2"');
    // A name can't end the page's script.
    const page = statusPage({ ...status, account: "</script><script>alert(1)</script>" }, "page");
    expect(page.match(/<\/script>/g)).toHaveLength(1);
    expect(JSON.parse(scriptJson("</script>\u2028"))).toBe("</script>\u2028");
    // PowerShell ends a string at curly quotes too.
    expect(psQuote("a\u2019b")).toBe("'a\u2019\u2019b'");
    expect(psQuote("a'b")).toBe(`'a''b'`);
  });

  it("answers only this PC's addresses, and buttons need the page's token", async () => {
    expect(hostOk("127.0.0.1:47213", 47213)).toBe(true);
    expect(hostOk("evil.example:47213", 47213)).toBe(false);
    expect((await req("/?t=inst", { host: "evil.example:47213" })).status).toBe(404);
    // Only with the token from this Windows user's own folder.
    expect((await req("/")).status).toBe(403);
    expect((await req("/?t=page")).status).toBe(403);
    expect((await req("/?t=inst")).status).toBe(200);
    expect(await (await req("/ping")).json()).toEqual({ app: "journey-forever-uploader", version: "1.0.0" });
    expect((await req("/action", { method: "POST", body: JSON.stringify({ action: "sync" }) })).status).toBe(403);
    expect((await req("/action", { method: "POST", headers: { "x-token": "page" }, body: JSON.stringify({ action: "sync" }) })).status).toBe(200);
    expect((await req("/quit", { method: "POST", headers: { "x-token": "page" } })).ok).toBe(false);
    expect((await req("/state")).status).toBe(403);
  });

  it("shows Start with Windows and the update line, escaped", () => {
    const page = statusPage({ ...status, update: { note: "Couldn't update: <x>", auto: false, canCheck: true } }, "page");
    expect(page).toContain('id="startup" checked');
    expect(page).toContain("Couldn&#39;t update: &lt;x&gt; (automatic updates are off)");
    expect(page).toContain('data-action="check-update"');
  });

  it("lets the window and tray (with the instance token) read state and send commands", async () => {
    const h = (path: string, init: RequestInit = {}) => req(path, { ...init, headers: { "x-token": "inst", ...(init.headers as Record<string, string>) } });
    expect((await req("/host/state", { headers: { "x-token": "page" } })).ok).toBe(false);
    expect(await (await h("/host/state?visible=1")).json()).toMatchObject({ dot: "live", paused: false, show: 0, quit: false });
    expect(win.visible).toBe(true);
    calls.length = 0;
    for (const cmd of ["sync", "pause", "journey", "check-update"]) expect((await h("/host/cmd", { method: "POST", body: JSON.stringify({ cmd }) })).status).toBe(200);
    expect((await h("/host/cmd", { method: "POST", body: JSON.stringify({ cmd: "rm -rf" }) })).status).toBe(400);
    expect(calls).toEqual(["sync", "pause", "journey", "check-update"]);
    // Double-click while running: the window opens (the next poll sees show go up).
    await h("/show", { method: "POST" });
    expect(((await (await h("/host/state")).json()) as { show: number }).show).toBe(1);
    // No WebView2 on this PC: the page opens in the browser instead.
    calls.length = 0;
    await h("/host/cmd", { method: "POST", body: JSON.stringify({ cmd: "nowebview" }) });
    await h("/show", { method: "POST" });
    expect(calls).toEqual(["browser", "browser"]);
    // Page buttons for the new switches.
    calls.length = 0;
    for (const action of ["startup-off", "check-update"]) await req("/action", { method: "POST", headers: { "x-token": "page" }, body: JSON.stringify({ action }) });
    expect(calls).toEqual(["startup-off", "check-update"]);
  });

  it("picks the tray dot and hover text", () => {
    expect(trayState(status).dot).toBe("live");
    expect(trayState({ ...status, busy: "Uploading" })).toEqual({ dot: "busy", tip: "Journey Forever: Uploading…" });
    expect(trayState({ ...status, paused: true }).dot).toBe("off");
    expect(trayState({ ...status, connected: false }).dot).toBe("warn");
    expect(trayState({ ...status, error: "x" }).dot).toBe("warn");
    for (const s of [status, { ...status, connected: false }, { ...status, forever: undefined }]) expect(trayState(s).tip.length).toBeLessThanOrEqual(63);
  });
});

describe("uploading while WoW is open", () => {
  it("waits 10 minutes between uploads while playing, and not once the game closes", async () => {
    const { holdWhilePlaying, PLAYING_GAP_MS } = await import("../src/app");
    const t = 1_000_000_000;
    expect(holdWhilePlaying(t, t - 60_000, true)).toBe(true);
    expect(holdWhilePlaying(t, t - PLAYING_GAP_MS, true)).toBe(false);
    expect(holdWhilePlaying(t, t - 60_000, false)).toBe(false);
    expect(holdWhilePlaying(t, 0, true)).toBe(false); // first upload after starting
  });
});
