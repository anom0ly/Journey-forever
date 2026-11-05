// Keeping the Journey Forever addon installed and up to date: compare the
// installed .toc version with the newest addon release on GitHub (tag
// addon-v<version>, asset JourneyForever-<version>.zip) and, while WoW is
// closed, put the new one in Interface\AddOns\JourneyForever. Only our own
// addon; Road to Sixty and Journey Tracker come from CurseForge.

import { unzipSync } from "fflate";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { UPLOADER_REPO } from "../../website/src/lib/uploader";

const FOLDER = "JourneyForever";

export interface Release {
  version: string;
  url: string; // the zip
}

export function tocVersion(toc: string): string | undefined {
  return /^##\s*Version:\s*([^\r\n]+)/m.exec(toc)?.[1].trim();
}

export async function installedVersion(dir: string): Promise<string | undefined> {
  try {
    return tocVersion(await readFile(join(dir, `${FOLDER}.toc`), "utf8"));
  } catch {
    return undefined;
  }
}

// 1.10.0 is newer than 1.9.2.
export function isNewer(a: string, b: string | undefined): boolean {
  if (!b) return true;
  const pa = a.split(/[.-]/).map((x) => parseInt(x, 10) || 0), pb = b.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  }
  return false;
}

interface GhRelease {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  assets: { name: string; browser_download_url: string }[];
}

export function pickRelease(list: GhRelease[]): Release | undefined {
  let best: Release | undefined;
  for (const r of list) {
    if (r.draft || r.prerelease || !r.tag_name.startsWith("addon-v")) continue;
    const asset = r.assets.find((a) => /^JourneyForever-[\w.-]+\.zip$/.test(a.name));
    const version = r.tag_name.slice("addon-v".length);
    if (asset && (!best || isNewer(version, best.version))) best = { version, url: asset.browser_download_url };
  }
  return best;
}

export async function latestRelease(): Promise<Release | undefined> {
  const res = await fetch(`https://api.github.com/repos/${UPLOADER_REPO}/releases?per_page=30`, {
    headers: { accept: "application/vnd.github+json", "user-agent": "JourneyForeverUploader" },
  });
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  return pickRelease((await res.json()) as GhRelease[]);
}

// The zip's files, checked: everything inside JourneyForever/, nothing that
// climbs out of it, and the .toc present.
export function addonFiles(zip: Uint8Array): Map<string, Uint8Array> {
  const all = unzipSync(zip);
  const out = new Map<string, Uint8Array>();
  for (const [name, data] of Object.entries(all)) {
    if (name.endsWith("/")) continue;
    const parts = name.split(/[\\/]/);
    if (parts[0] !== FOLDER || parts.some((p) => p === ".." || p === "") || /^[a-z]:/i.test(name)) {
      throw new Error(`Unexpected file in the addon zip: ${name}`);
    }
    out.set(parts.slice(1).join("/"), data);
  }
  if (!out.has(`${FOLDER}.toc`)) throw new Error("The addon zip has no JourneyForever.toc");
  return out;
}

// Writes the new folder next to the old one, then swaps them, so a failure
// halfway leaves the old addon in place.
export async function installAddon(dir: string, files: Map<string, Uint8Array>): Promise<void> {
  const next = `${dir}.new`, old = `${dir}.old`;
  await rm(next, { recursive: true, force: true });
  await rm(old, { recursive: true, force: true });
  for (const [rel, data] of files) {
    const target = join(next, ...rel.split("/"));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, data);
  }
  await mkdir(dirname(dir), { recursive: true });
  if (existsSync(dir)) await rename(dir, old);
  await rename(next, dir);
  await rm(old, { recursive: true, force: true });
}

export type AddonOutcome =
  | { status: "current"; version: string }
  | { status: "installed" | "updated"; version: string; from?: string }
  | { status: "waiting"; version: string; installed?: string } // WoW is running
  | { status: "unknown"; installed?: string }; // no release found

export async function keepAddonCurrent(
  dir: string,
  o: { wowRunning: () => Promise<boolean>; latest?: () => Promise<Release | undefined>; download?: (url: string) => Promise<Uint8Array> },
): Promise<AddonOutcome> {
  const installed = await installedVersion(dir);
  const latest = await (o.latest ?? latestRelease)();
  if (!latest) return { status: "unknown", installed };
  if (!isNewer(latest.version, installed)) return { status: "current", version: installed ?? latest.version };
  if (await o.wowRunning()) return { status: "waiting", version: latest.version, installed };
  const download =
    o.download ??
    (async (url: string) => {
      const res = await fetch(url, { headers: { "user-agent": "JourneyForeverUploader" } });
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      return new Uint8Array(await res.arrayBuffer());
    });
  await installAddon(dir, addonFiles(await download(latest.url)));
  return { status: installed ? "updated" : "installed", version: latest.version, from: installed };
}
