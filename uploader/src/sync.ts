// One upload: the same steps as the site's Upload page (website/src/app/
// pages/Upload.tsx), without the page. The saved files are read here, on
// the PC; only the finished journeys, screenshots and hashed friends lists
// are sent.

import type { StoredCharacter } from "../../website/src/app/api";
import { BOARDS_VERSION, type BoardEntry } from "../../website/src/lib/boardDefs";
import { boardEntries, integrityChecks } from "../../website/src/lib/boards";
import { friendHashes } from "../../website/src/lib/friends";
import type { CharacterSummary, Journey } from "../../website/src/lib/journey";
import { isPreLaunch, mergeJourneys, summarize, uploadDelta, type UploadDelta } from "../../website/src/lib/merge";
import { readUpload, type FileNote, type InputFile } from "../../website/src/lib/parse/upload";
import { matchShots, shotTime, type Matched } from "../../website/src/lib/shots";
import type { PreparedImage } from "./images";

export interface Client {
  characters(): Promise<StoredCharacter[]>;
  journey(key: string): Promise<Journey | undefined>;
  screenshotIds(key: string): Promise<string[]>;
  saveJourney(journey: Journey, summary: CharacterSummary): Promise<void>;
  saveBoards(key: string, entries: BoardEntry[], checks: string[], version: number): Promise<void>;
  saveScreenshot(key: string, image: PreparedImage, meta: ShotMeta): Promise<void>;
  saveFriends(lists: Partial<Record<"jf" | "rts", string[]>>): Promise<void>;
}

export interface ShotMeta {
  t: number;
  kind: string;
  label: string;
  file: string;
  width?: number;
  height?: number;
}

// A screenshot file on disk; read only when it's going to be uploaded.
export interface ShotSource {
  name: string;
  size: number;
  mtime: number;
  read(): Promise<Uint8Array>;
}

export interface SyncOptions {
  shots: boolean; // upload the addon's screenshots
  manualShots?: boolean; // and Print Screen shots from a session (off unless switched on)
  known: Set<string>; // screenshot ids this PC uploaded before
  idOf(file: ShotSource): Promise<string>; // the id the site gives it (a hash of its bytes)
  prepare(file: ShotSource): Promise<PreparedImage>;
  friendsHash?: string; // the friends lists sent last time, so an unchanged one isn't sent again
  progress?(text: string): void;
}

export interface CharacterResult {
  key: string;
  name: string;
  fromLevel?: number;
  toLevel: number;
  played: number;
  isNew: boolean;
  fillsGap: boolean;
}

export interface SyncResult {
  characters: CharacterResult[];
  shots: number;
  shotIds: string[]; // uploaded now or found on the site already: for options.known next time
  notes: FileNote[]; // files that couldn't be read
  skippedPreLaunch: number;
  friendsHash?: string;
}

interface Found {
  file: ShotSource;
  name: string;
  time: number;
  id?: string;
}

async function hashText(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sync(client: Client, saved: InputFile[], shots: ShotSource[], o: SyncOptions): Promise<SyncResult> {
  const say = o.progress ?? (() => undefined);
  const { journeys, notes, friends } = readUpload(saved);
  const stored = new Map((await client.characters()).map((c) => [c.key, c]));

  // Characters from the beta or stress test are left out unless the site
  // already has them, as on the Upload page.
  const active = journeys.filter((j) => !(isPreLaunch(j) && !stored.has(j.character.key)));
  const deltas = new Map<string, UploadDelta>(active.map((j) => [j.character.key, uploadDelta(stored.get(j.character.key)?.summary, j)]));
  const olds = new Map<string, Journey>();
  for (const j of active) {
    const key = j.character.key;
    if (!deltas.get(key)?.upToDate || !stored.get(key)?.hasJourney) continue;
    // Nothing newer than the last upload: it may still hold sessions from
    // another PC, which only the stored journey can tell.
    const old = await client.journey(key).catch(() => undefined);
    if (!old) continue;
    olds.set(key, old);
    deltas.set(key, uploadDelta(stored.get(key)?.summary, j, old));
  }

  const toSave = active.filter((j) => !deltas.get(j.character.key)?.upToDate || !stored.has(j.character.key));
  const characters: CharacterResult[] = [];
  for (const j of toSave) {
    const key = j.character.key;
    say(`Saving ${j.character.name}`);
    const before = stored.get(key);
    const old = olds.get(key) ?? (before?.hasJourney ? await client.journey(key).catch(() => undefined) : undefined);
    const merged = mergeJourneys(old, j);
    await client.saveJourney(merged, summarize(merged));
    await client.saveBoards(key, boardEntries(merged), integrityChecks(merged, old), BOARDS_VERSION);
    const d = deltas.get(key)!;
    characters.push({ key, name: j.character.name, fromLevel: d.fromLevel, toLevel: d.toLevel, played: d.played, isNew: d.isNew, fillsGap: !!d.fillsGap });
  }

  // Screenshots: the ones logged by our addon (and, when switched on, the
  // ones taken by hand during a session) that weren't uploaded before.
  const shotIds: string[] = [];
  let uploaded = 0;
  if (o.shots && shots.length) {
    const files: Found[] = [];
    for (const file of shots) {
      const time = shotTime(file.name);
      if (time !== undefined) files.push({ file, name: file.name, time });
    }
    const m = matchShots(files, active);
    const saveable = new Set([...stored.keys(), ...toSave.map((j) => j.character.key)]);
    // Print Screen shots only when switched on: unlike the Upload page, there's no preview to check them first.
    const candidates = [...m.matched, ...(o.manualShots ? m.manual : [])].filter((s) => saveable.has(s.charKey));
    const fresh: Matched<Found>[] = [];
    for (const s of candidates) {
      s.file.id = await o.idOf(s.file.file);
      if (!o.known.has(s.file.id)) fresh.push(s);
    }
    // What the site already has (uploaded from the Upload page or another PC).
    const onSite = new Set<string>();
    for (const key of new Set(fresh.map((s) => s.charKey))) {
      if (!stored.has(key)) continue;
      for (const id of await client.screenshotIds(key)) onSite.add(id);
    }
    const seen = new Set<string>();
    const todo = fresh.filter((s) => {
      const id = s.file.id!;
      if (onSite.has(id)) shotIds.push(id);
      if (onSite.has(id) || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    let n = 0;
    for (const s of todo) {
      say(`Uploading screenshot ${++n} of ${todo.length}`);
      const img = await o.prepare(s.file.file);
      await client.saveScreenshot(s.charKey, img, { t: s.t, kind: s.kind, label: s.label, file: s.file.name, width: img.width, height: img.height });
      shotIds.push(img.id);
      uploaded++;
    }
  }

  let friendsHash = o.friendsHash;
  if (friends.jf || friends.rts) {
    const lists = await friendHashes(friends);
    const h = await hashText(JSON.stringify(lists));
    if (h !== o.friendsHash) {
      say("Saving your friends list");
      await client.saveFriends(lists);
      friendsHash = h;
    }
  }

  return {
    characters,
    shots: uploaded,
    shotIds,
    notes,
    skippedPreLaunch: journeys.length - active.length,
    friendsHash,
  };
}
