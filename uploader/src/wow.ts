// Finding WoW Forever's folder (World of Warcraft\_forever_) and the files
// in it the uploader reads: the three addons' saved files and screenshots.

import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { SAVED_FILES } from "../../website/src/lib/parse/upload";
import type { InputFile } from "../../website/src/lib/parse/upload";
import type { ShotSource } from "./sync";

export const FOREVER = "_forever_";
const IMAGE_RE = /\.(jpe?g|png|tga)$/i;

// The folder holding _forever_: the one Battle.net names, then the usual
// places on every drive.
export function candidateRoots(registry: string[], drives: string[]): string[] {
  const out: string[] = [];
  for (const p of registry) {
    const clean = p.replace(/[\\/]+$/, "");
    // InstallPath is often ...\World of Warcraft\_retail_ (or another flavour).
    out.push(/[\\/]_[a-z]+_$/i.test(clean) ? clean.replace(/[\\/]_[a-z]+_$/i, "") : clean);
  }
  for (const d of drives) {
    for (const dir of ["Program Files (x86)", "Program Files", "", "Games", "Blizzard", "Battle.net", "Program Files (x86)\\Battle.net", "Games\\Blizzard"]) {
      out.push(`${d}:\\${dir ? dir + "\\" : ""}World of Warcraft`);
    }
  }
  return [...new Set(out)];
}

export function existingDrives(): string[] {
  return "CDEFGHIJKLMN".split("").filter((d) => existsSync(`${d}:\\`));
}

// A folder the person chose: _forever_ itself, or the WoW folder above it.
export function foreverIn(dir: string): string | undefined {
  const d = resolve(dir);
  if (/[\\/]_forever_$/i.test(d) && existsSync(d)) return d;
  const inside = join(d, FOREVER);
  return existsSync(inside) ? inside : undefined;
}

export function findForever(roots: string[]): string | undefined {
  for (const r of roots) {
    const f = foreverIn(r);
    if (f) return f;
  }
  return undefined;
}

export interface SavedFile {
  abs: string;
  rel: string; // WTF/Account/<account>/[<realm>/<character>/]SavedVariables/<file>, as the parsers expect
  mtime: number;
  size: number;
}

async function dirs(p: string): Promise<string[]> {
  try {
    return (await readdir(p, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

async function savedIn(forever: string, rel: string[], out: SavedFile[]): Promise<void> {
  for (const name of SAVED_FILES) {
    const abs = join(forever, ...rel, "SavedVariables", name);
    try {
      const s = await stat(abs);
      if (s.isFile()) out.push({ abs, rel: [...rel, "SavedVariables", name].join("/"), mtime: s.mtimeMs, size: s.size });
    } catch {
      // not there
    }
  }
}

// Every account, realm and character folder has a fixed place for these.
export async function listSaved(forever: string): Promise<SavedFile[]> {
  const out: SavedFile[] = [];
  const accounts = join(forever, "WTF", "Account");
  for (const acct of await dirs(accounts)) {
    if (acct === "SavedVariables") continue;
    await savedIn(forever, ["WTF", "Account", acct], out);
    for (const realm of await dirs(join(accounts, acct))) {
      if (realm === "SavedVariables") continue;
      for (const ch of await dirs(join(accounts, acct, realm))) await savedIn(forever, ["WTF", "Account", acct, realm, ch], out);
    }
  }
  return out;
}

// Changes when the game writes any of the files (log out, /reload, quit).
export function signature(files: SavedFile[]): string {
  return files.map((f) => `${f.rel}:${Math.round(f.mtime)}:${f.size}`).sort().join("|");
}

export async function readSaved(files: SavedFile[]): Promise<InputFile[]> {
  return Promise.all(files.map(async (f) => ({ path: f.rel, text: await readFile(f.abs, "utf8") })));
}

export async function listScreenshots(forever: string): Promise<ShotSource[]> {
  const dir = join(forever, "Screenshots");
  let names: string[];
  try {
    names = (await readdir(dir)).filter((n) => IMAGE_RE.test(n));
  } catch {
    return [];
  }
  const out: ShotSource[] = [];
  for (const name of names) {
    const abs = join(dir, name);
    try {
      const s = await stat(abs);
      if (!s.isFile()) continue;
      out.push({ name, size: s.size, mtime: s.mtimeMs, read: async () => new Uint8Array(await readFile(abs)) });
    } catch {
      // gone since the listing
    }
  }
  return out;
}

export function addonDir(forever: string): string {
  return join(forever, "Interface", "AddOns", "JourneyForever");
}
