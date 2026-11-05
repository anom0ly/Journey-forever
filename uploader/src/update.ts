// The uploader updating itself: the newest uploader-v<version> release that
// our own release workflow published, checked against the SHA-256 GitHub
// records for the file, swapped in next to the running .exe (Windows lets a
// running program be renamed, not overwritten), then started.

import { renameSync, rmSync, writeFileSync } from "node:fs";
import { UPLOADER_EXE } from "../../website/src/lib/uploader";
import { DOWNLOAD_PREFIX, githubReleases, isNewer, RELEASE_BOT, sha256Hex, type GhRelease } from "./addon";

export const MAX_EXE_BYTES = 300e6;

export interface UploaderRelease {
  version: string;
  url: string;
  sha256: string;
  size: number;
}

// The newest release newer than `current`, or undefined.
export function pickUploaderRelease(list: GhRelease[], current: string): UploaderRelease | undefined {
  let best: UploaderRelease | undefined;
  for (const r of list) {
    if (r.draft || r.prerelease || !r.tag_name.startsWith("uploader-v") || r.author?.login !== RELEASE_BOT) continue;
    const version = r.tag_name.slice("uploader-v".length);
    const a = r.assets.find((x) => x.name === UPLOADER_EXE);
    const sha256 = /^sha256:([0-9a-f]{64})$/.exec(a?.digest ?? "")?.[1];
    if (!a || !sha256 || a.uploader?.login !== RELEASE_BOT || !a.browser_download_url.startsWith(DOWNLOAD_PREFIX)) continue;
    if (!a.size || a.size > MAX_EXE_BYTES) continue;
    if (!isNewer(version, current) || (best && !isNewer(version, best.version))) continue;
    best = { version, url: a.browser_download_url, sha256, size: a.size };
  }
  return best;
}

export async function latestUploader(current: string): Promise<UploaderRelease | undefined> {
  return pickUploaderRelease(await githubReleases(), current);
}

// The new .exe, refused unless it's exactly the file GitHub recorded.
export async function downloadUploader(rel: UploaderRelease, get: (url: string) => Promise<Response> = (u) => fetch(u, { headers: { "user-agent": "JourneyForeverUploader" } })): Promise<Uint8Array> {
  if (!rel.url.startsWith(DOWNLOAD_PREFIX)) throw new Error("Unexpected download address");
  const res = await get(rel.url);
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  if (Number(res.headers.get("content-length") ?? 0) > MAX_EXE_BYTES) throw new Error("The download is too big");
  const body = new Uint8Array(await res.arrayBuffer());
  if (body.length > MAX_EXE_BYTES || body.length !== rel.size) throw new Error("The download is the wrong size");
  if ((await sha256Hex(body)) !== rel.sha256) throw new Error("The download didn't match GitHub's checksum");
  return body;
}

// Puts the new .exe in place of `exe`; the running one becomes <exe>.old,
// deleted by the next start. A failure puts the old one back.
export function swapExe(exe: string, bytes: Uint8Array): void {
  const next = `${exe}.new`, old = `${exe}.old`;
  rmSync(next, { force: true });
  writeFileSync(next, bytes);
  try {
    rmSync(old, { force: true });
  } catch {
    // an older .old still running somehow: renaming over it fails below
  }
  renameSync(exe, old);
  try {
    renameSync(next, exe);
  } catch (e) {
    renameSync(old, exe);
    throw e;
  }
}

export function removeOldExe(exe: string): void {
  try {
    rmSync(`${exe}.old`, { force: true });
  } catch {
    // still running for a moment: next start
  }
}
