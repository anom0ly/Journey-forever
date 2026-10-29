// Collects what was dropped or picked: the three addons' saved files (read as
// text) and screenshots. Every other file in the folder is skipped unread.

import { isSavedFile } from "../lib/parse/upload";

export const IMAGE_RE = /\.(jpe?g|png|tga)$/i;

export interface Picked {
  saved: { path: string; file: File }[];
  images: File[];
  skipped: number;
}

function sort(files: { path: string; file: File }[], out: Picked): void {
  for (const { path, file } of files) {
    if (isSavedFile(path)) out.saved.push({ path, file });
    else if (IMAGE_RE.test(file.name)) out.images.push(file);
    else out.skipped++;
  }
}

export function fromInput(list: FileList | null): Picked {
  const out: Picked = { saved: [], images: [], skipped: 0 };
  if (!list) return out;
  sort([...list].map((file) => ({ path: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name, file })), out);
  return out;
}

function readEntries(dir: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  const reader = dir.createReader();
  const all: FileSystemEntry[] = [];
  return new Promise((resolve, reject) => {
    const next = () =>
      reader.readEntries((batch) => {
        if (!batch.length) resolve(all);
        else {
          all.push(...batch);
          next();
        }
      }, reject);
    next();
  });
}

async function walk(entry: FileSystemEntry, files: { path: string; file: File }[]): Promise<void> {
  if (entry.isFile) {
    const name = entry.name;
    // Only open files we might use.
    if (!isSavedFile(name) && !IMAGE_RE.test(name)) {
      files.push({ path: entry.fullPath, file: new File([], name) });
      return;
    }
    const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
    files.push({ path: entry.fullPath.replace(/^\//, ""), file });
  } else if (entry.isDirectory) {
    for (const child of await readEntries(entry as FileSystemDirectoryEntry)) await walk(child, files);
  }
}

export async function fromDrop(dt: DataTransfer): Promise<Picked> {
  const out: Picked = { saved: [], images: [], skipped: 0 };
  const entries = [...dt.items].map((i) => i.webkitGetAsEntry?.()).filter((e): e is FileSystemEntry => !!e);
  const files: { path: string; file: File }[] = [];
  if (entries.length) for (const e of entries) await walk(e, files);
  else for (const f of dt.files) files.push({ path: f.name, file: f });
  sort(files, out);
  return out;
}

export function merge(a: Picked, b: Picked): Picked {
  return { saved: [...a.saved, ...b.saved], images: [...a.images, ...b.images], skipped: a.skipped + b.skipped };
}
