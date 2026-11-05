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
// Only what our own release workflow (.github/workflows/addon.yml) published:
// it runs as github-actions[bot]. A zip anyone else attached is ignored.
export const RELEASE_BOT = "github-actions[bot]";
export const DOWNLOAD_PREFIX = `https://github.com/${UPLOADER_REPO}/releases/download/`;
export const MAX_ZIP_BYTES = 5e6;
const MAX_UNPACKED_BYTES = 20e6;
const MAX_FILES = 200;

export interface Release {
  version: string;
  url: string; // the zip
}

export async function sha256Hex(b: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", b as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
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

export interface GhRelease {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  author?: { login?: string } | null;
  assets: { name: string; browser_download_url: string; size?: number; digest?: string | null; uploader?: { login?: string } | null }[];
}

export async function githubReleases(): Promise<GhRelease[]> {
  const res = await fetch(`https://api.github.com/repos/${UPLOADER_REPO}/releases?per_page=30`, {
    headers: { accept: "application/vnd.github+json", "user-agent": "JourneyForeverUploader" },
  });
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  return (await res.json()) as GhRelease[];
}

export function pickRelease(list: GhRelease[]): Release | undefined {
  let best: Release | undefined;
  for (const r of list) {
    if (r.draft || r.prerelease || !r.tag_name.startsWith("addon-v") || r.author?.login !== RELEASE_BOT) continue;
    const asset = r.assets.find(
      (a) =>
        /^JourneyForever-[\w.-]+\.zip$/.test(a.name) &&
        a.uploader?.login === RELEASE_BOT &&
        a.browser_download_url.startsWith(DOWNLOAD_PREFIX) &&
        (a.size ?? 0) <= MAX_ZIP_BYTES,
    );
    const version = r.tag_name.slice("addon-v".length);
    if (asset && (!best || isNewer(version, best.version))) best = { version, url: asset.browser_download_url };
  }
  return best;
}

export async function latestRelease(): Promise<Release | undefined> {
  return pickRelease(await githubReleases());
}

// The zip's files, checked: everything inside JourneyForever/, nothing that
// climbs out of it, and the .toc present.
export function addonFiles(zip: Uint8Array): Map<string, Uint8Array> {
  if (zip.length > MAX_ZIP_BYTES) throw new Error("The addon zip is too big");
  // Sizes are checked from the zip's directory before anything is unpacked.
  let files = 0, bytes = 0;
  const all = unzipSync(zip, {
    filter: (f) => {
      files++;
      bytes += f.originalSize;
      if (files > MAX_FILES || bytes > MAX_UNPACKED_BYTES) throw new Error("The addon zip unpacks too big");
      return true;
    },
  });
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
  | { status: "installed" | "updated"; version: string; from?: string; sha256: string }
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
      if (!url.startsWith(DOWNLOAD_PREFIX)) throw new Error("Unexpected download address");
      const res = await fetch(url, { headers: { "user-agent": "JourneyForeverUploader" } });
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      if (Number(res.headers.get("content-length") ?? 0) > MAX_ZIP_BYTES) throw new Error("The addon zip is too big");
      const body = new Uint8Array(await res.arrayBuffer());
      if (body.length > MAX_ZIP_BYTES) throw new Error("The addon zip is too big");
      return body;
    });
  const zip = await download(latest.url);
  await installAddon(dir, addonFiles(zip));
  return { status: installed ? "updated" : "installed", version: latest.version, from: installed, sha256: await sha256Hex(zip) };
}
