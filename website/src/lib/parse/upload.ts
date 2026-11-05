// Turns the files of a dropped WTF\Account\<account> folder into one journey
// per character. Only the three addons' saved files are read; everything
// else in the folder is ignored and never leaves the browser.

import { addFriends, type FriendLists } from "../friends";
import type { Journey } from "../journey";
import { LuaParseError, parseSavedVariables, type LuaValue } from "../lua";
import { buildJourney, characterKey } from "../merge";
import { parseJourneyForever } from "./jf";
import { parseJourneyTracker } from "./jt";
import { parseRoadToSixtyAccount, parseRoadToSixtyChar, type RosterEntry } from "./rts";
import type { Contribution, FileContext } from "./types";

export interface InputFile {
  path: string; // as the browser gives it (webkitRelativePath), or just the name
  text: string;
  // Files picked or dropped together without their folders (a file picker
  // hides the path) share a group: one pick is one character's folder.
  group?: string;
}

export const SAVED_FILES = ["RoadToSixty.lua", "JourneyTracker.lua", "JourneyForever.lua"];

export interface FileNote {
  path: string;
  message: string;
}

export interface Unnamed {
  files: string[]; // file names picked together
  sources: Journey["sources"];
}

export interface UploadResult {
  journeys: Journey[];
  notes: FileNote[]; // files that couldn't be read, and why
  unnamed: Unnamed[]; // loose files that don't say whose they are
  friends: FriendLists; // Battle.net friends' BattleTags; never sent as they are (lib/friends.ts)
}

// Whether a dropped file is one this site reads: one of the three names,
// either picked on its own or inside a SavedVariables folder. The addons'
// own code has the same names (Interface/AddOns/JourneyTracker/
// JourneyTracker.lua), so a dropped game folder must not match those.
export function isSavedFile(path: string): boolean {
  const parts = path.split(/[\\/]/).filter(Boolean);
  const name = parts.pop() ?? "";
  if (!SAVED_FILES.includes(name)) return false;
  return parts.length === 0 || parts[parts.length - 1].toLowerCase() === "savedvariables";
}

// <realm>/<character>/SavedVariables/<file>, or SavedVariables/<file> for
// the account-wide ones.
export function contextOf(path: string): FileContext & { accountWide: boolean } {
  const parts = path.split(/[\\/]/).filter(Boolean);
  const sv = parts.lastIndexOf("SavedVariables");
  if (sv >= 2 && parts.length === sv + 2) {
    const realm = parts[sv - 2], character = parts[sv - 1];
    // The account-wide folder sits right under the account: Account/<acct>/SavedVariables.
    if (parts[sv - 2] === "Account") return { accountWide: true };
    return { realm, character, accountWide: false };
  }
  return { accountWide: sv === parts.length - 2 && sv >= 0 };
}

function read(file: InputFile): Record<string, LuaValue> | string {
  try {
    return parseSavedVariables(file.text);
  } catch (err) {
    return err instanceof LuaParseError ? `Couldn't read it: ${err.message}` : `Couldn't read it: ${String(err)}`;
  }
}

export function readUpload(files: InputFile[], now?: number): UploadResult {
  const notes: FileNote[] = [];
  const byFolder = new Map<string, Contribution[]>();
  const filesOf = new Map<string, string[]>();
  const roster: RosterEntry[] = [];
  const friends: FriendLists = {};

  for (const file of files) {
    if (!isSavedFile(file.path)) continue;
    const globals = read(file);
    if (typeof globals === "string") {
      notes.push({ path: file.path, message: globals });
      continue;
    }
    const ctx = contextOf(file.path);
    addFriends(friends, globals);
    if ("RoadToSixtyDB" in globals) roster.push(...parseRoadToSixtyAccount(globals.RoadToSixtyDB));
    const parts: Contribution[] = [];
    if ("RoadToSixtyCharDB" in globals) parts.push(parseRoadToSixtyChar(globals.RoadToSixtyCharDB, ctx));
    if ("JourneyTrackerDB" in globals) parts.push(parseJourneyTracker(globals.JourneyTrackerDB, ctx));
    if ("JourneyForeverDB" in globals) parts.push(parseJourneyForever(globals.JourneyForeverDB, ctx));
    if (!parts.length) {
      if (!("RoadToSixtyDB" in globals)) notes.push({ path: file.path, message: "No journey data in this file." });
      continue;
    }
    for (const p of parts) {
      if (p.source.status === "error") notes.push({ path: file.path, message: p.source.message ?? "Couldn't read it." });
    }
    // Files of one character share a folder; loose files picked together are
    // one character (Road to Sixty's file doesn't name its character); any
    // other loose file goes by what it says.
    let folder = ctx.character ? `${ctx.realm}/${ctx.character}` : file.group ? `pick:${file.group}` : characterKey(parts[0].character);
    const have = byFolder.get(folder) ?? [];
    // Two files of the same addon can't be one character's: keep them apart.
    if (!ctx.character && file.group && parts.some((p) => have.some((h) => h.source.addon === p.source.addon))) {
      folder = `${folder}:${characterKey(parts[0].character)}`;
    }
    byFolder.set(folder, [...(byFolder.get(folder) ?? []), ...parts]);
    filesOf.set(folder, [...(filesOf.get(folder) ?? []), file.path.split(/[\\/]/).pop() ?? file.path]);
  }

  const journeys: Journey[] = [];
  const unnamed: Unnamed[] = [];
  for (const [folder, parts] of byFolder) {
    const j = buildJourney(parts, now);
    const r = roster.find((x) => (j.character.guid && x.guid === j.character.guid) || (x.name === j.character.name && x.realm === j.character.realm));
    if (r) {
      // The roster has the realm as the game names it (folder names drop spaces).
      if (r.realm) j.character.realm = r.realm;
      if (r.name) j.character.name = r.name;
      j.character.className ??= r.className;
      j.character.key = characterKey(j.character);
    }
    if (!j.character.name || j.character.name === "Unknown") {
      unnamed.push({ files: filesOf.get(folder) ?? [], sources: j.sources });
      continue;
    }
    journeys.push(j);
  }
  journeys.sort((a, b) => b.character.level - a.character.level || a.character.name.localeCompare(b.character.name));
  return { journeys, notes, unnamed, friends };
}
