import { describe, expect, it } from "bun:test";
import { zipSync } from "fflate";
import { mkdtempSync, readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import jpeg from "jpeg-js";
import { addonFiles, installAddon, isNewer, keepAddonCurrent, pickRelease, tocVersion } from "../src/addon";
import { asciiJson } from "../src/client";
import { decodeTga, prepareImage, shrink } from "../src/images";
import { esc, statusPage } from "../src/page";
import { handler, hostOk } from "../src/server";
import { toastXml } from "../src/windows";
import { candidateRoots, foreverIn } from "../src/wow";
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
    const asset = (v: string) => [{ name: `JourneyForever-${v}.zip`, browser_download_url: `https://x/${v}.zip` }];
    expect(
      pickRelease([
        { tag_name: "uploader-v2.0.0", draft: false, prerelease: false, assets: [] },
        { tag_name: "addon-v1.2.0", draft: false, prerelease: true, assets: asset("1.2.0") },
        { tag_name: "addon-v1.1.0", draft: false, prerelease: false, assets: asset("1.1.0") },
        { tag_name: "addon-v1.0.0", draft: false, prerelease: false, assets: asset("1.0.0") },
      ]),
    ).toEqual({ version: "1.1.0", url: "https://x/1.1.0.zip" });
  });

  it("refuses a zip with files outside the addon folder", () => {
    expect(() => addonFiles(zip({ "JourneyForever/JourneyForever.toc": "x", "JourneyForever/../../evil.lua": "x" }))).toThrow();
    expect(() => addonFiles(zip({ "Other/Other.toc": "x" }))).toThrow();
    expect(() => addonFiles(zip({ "JourneyForever/Core.lua": "x" }))).toThrow(/toc/);
  });

  it("installs, updates in place, and waits while WoW is running", async () => {
    const root = mkdtempSync(join(tmpdir(), "jfu-"));
    const dir = join(root, "Interface", "AddOns", "JourneyForever");
    const release = (v: string) => ({ version: v, url: `https://x/${v}.zip` });
    const download = async (url: string) => zip({ "JourneyForever/JourneyForever.toc": `## Version: ${url.match(/[\d.]+(?=\.zip)/)![0]}\n`, "JourneyForever/Core.lua": url });
    let open = false;
    const wowRunning = async () => open;

    expect(await keepAddonCurrent(dir, { wowRunning, latest: async () => release("1.0.0"), download })).toEqual({ status: "installed", version: "1.0.0", from: undefined });
    writeFileSync(join(dir, "Stale.lua"), "old");
    expect(await keepAddonCurrent(dir, { wowRunning, latest: async () => release("1.0.0"), download })).toEqual({ status: "current", version: "1.0.0" });

    open = true;
    expect((await keepAddonCurrent(dir, { wowRunning, latest: async () => release("1.1.0"), download })).status).toBe("waiting");
    open = false;
    expect(await keepAddonCurrent(dir, { wowRunning, latest: async () => release("1.1.0"), download })).toEqual({ status: "updated", version: "1.1.0", from: "1.0.0" });
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
    characters: ["Adom"], log: [{ t: 1793900000, text: "<b>Adom</b> uploaded", ok: true }],
  };
  const fake = { status: () => status, connected: async () => ({ ok: true, message: "ok" }), uploadNow() {} } as unknown as Uploader;
  const hooks = { uploader: fake, token: "page", instanceToken: "inst", pickFolder: async () => {}, remove: async () => {}, quit() {} };
  const serve = handler(hooks, () => 47213);
  const req = (path: string, init: RequestInit & { host?: string } = {}) =>
    serve(new Request(`http://127.0.0.1:47213${path}`, { ...init, headers: { host: init.host ?? "127.0.0.1:47213", ...(init.headers as Record<string, string>) } }));

  it("escapes what it shows", () => {
    expect(esc(`<a href="x">'`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;");
    expect(statusPage(status, "page")).toContain("&lt;b&gt;Adom&lt;/b&gt; uploaded");
    expect(toastXml("A & B", "<x>", "https://s/c?a=1&b=2")).toContain('launch="https://s/c?a=1&amp;b=2"');
  });

  it("answers only this PC's addresses, and buttons need the page's token", async () => {
    expect(hostOk("127.0.0.1:47213", 47213)).toBe(true);
    expect(hostOk("evil.example:47213", 47213)).toBe(false);
    expect((await req("/", { host: "evil.example:47213" })).status).toBe(404);
    expect((await req("/")).status).toBe(200);
    expect(await (await req("/ping")).json()).toEqual({ app: "journey-forever-uploader", version: "1.0.0" });
    expect((await req("/action", { method: "POST", body: JSON.stringify({ action: "sync" }) })).status).toBe(403);
    expect((await req("/action", { method: "POST", headers: { "x-token": "page" }, body: JSON.stringify({ action: "sync" }) })).status).toBe(200);
    expect((await req("/quit", { method: "POST", headers: { "x-token": "page" } })).ok).toBe(false);
    expect((await req("/state")).status).toBe(403);
  });
});
