// The uploader updating itself. The site names the build to install (an
// admin approved it on the Uploaders page, GET /api/uploader/latest); that
// uploader-v<version> release must come from our own release workflow, and
// its file must have the SHA-256 both GitHub and the site recorded. So a
// release that reached GitHub any other way is never installed. The new
// .exe is swapped in next to the running one (Windows lets a running
// program be renamed, not overwritten), then started.

import { renameSync, rmSync, writeFileSync } from "node:fs";
import { UPLOADER_EXE, type ApprovedUploader } from "../../website/src/lib/uploader";
import { DOWNLOAD_PREFIX, githubReleases, isNewer, RELEASE_BOT, sha256Hex, type GhRelease } from "./addon";

export const MAX_EXE_BYTES = 300e6;

export interface UploaderRelease {
  version: string;
  url: string;
  sha256: string;
  size: number;
}

// The approved build, when it's newer than `current` and GitHub has exactly
// that file from our workflow; otherwise undefined.
export function pickUploaderRelease(list: GhRelease[], current: string, approved: ApprovedUploader): UploaderRelease | undefined {
  if (!approved.version || !approved.sha256 || !/^[0-9a-f]{64}$/.test(approved.sha256) || !isNewer(approved.version, current)) return undefined;
  let best: UploaderRelease | undefined;
  for (const r of list) {
    if (r.tag_name !== `uploader-v${approved.version}`) continue;
    if (r.draft || r.prerelease || !r.tag_name.startsWith("uploader-v") || r.author?.login !== RELEASE_BOT) continue;
    const version = r.tag_name.slice("uploader-v".length);
    const a = r.assets.find((x) => x.name === UPLOADER_EXE);
    const sha256 = /^sha256:([0-9a-f]{64})$/.exec(a?.digest ?? "")?.[1];
    if (!a || !sha256 || a.uploader?.login !== RELEASE_BOT || !a.browser_download_url.startsWith(DOWNLOAD_PREFIX)) continue;
    if (!a.size || a.size > MAX_EXE_BYTES) continue;
    if (sha256 !== approved.sha256 || (approved.size && a.size !== approved.size)) continue;
    if (!isNewer(version, current) || (best && !isNewer(version, best.version))) continue;
    best = { version, url: a.browser_download_url, sha256, size: a.size };
  }
  return best;
}

export async function latestUploader(current: string, approved: ApprovedUploader): Promise<UploaderRelease | undefined> {
  if (!approved.version || !isNewer(approved.version, current)) return undefined;
  const rel = pickUploaderRelease(await githubReleases(), current, approved);
  // Approved on the site but GitHub's file doesn't match: refuse, and say so.
  if (!rel) throw new Error(`Version ${approved.version} on GitHub doesn't match the approved checksum`);
  return rel;
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
