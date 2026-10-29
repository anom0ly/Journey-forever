// Turns the files of a dropped WTF\Account\<account> folder into one journey
// per character. Only the three addons' saved files are read; everything
// else in the folder is ignored and never leaves the browser.

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
}

export const SAVED_FILES = ["RoadToSixty.lua", "JourneyTracker.lua", "JourneyForever.lua"];

export interface FileNote {
  path: string;
  message: string;
}

export interface UploadResult {
  journeys: Journey[];
  notes: FileNote[]; // files that couldn't be read, and why
}

// Whether a dropped file is one this site reads, by name.
export function isSavedFile(path: string): boolean {
  const name = path.split(/[\\/]/).pop() ?? "";
  return SAVED_FILES.includes(name);
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
  const roster: RosterEntry[] = [];

  for (const file of files) {
    if (!isSavedFile(file.path)) continue;
    const globals = read(file);
    if (typeof globals === "string") {
      notes.push({ path: file.path, message: globals });
      continue;
    }
    const ctx = contextOf(file.path);
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
    // Files of one character share a folder; a loose file goes by what it says.
    const folder = ctx.character ? `${ctx.realm}/${ctx.character}` : characterKey(parts[0].character);
    byFolder.set(folder, [...(byFolder.get(folder) ?? []), ...parts]);
  }

  const journeys: Journey[] = [];
  for (const parts of byFolder.values()) {
    const j = buildJourney(parts, now);
    const r = roster.find((x) => (j.character.guid && x.guid === j.character.guid) || (x.name === j.character.name && x.realm === j.character.realm));
    if (r) {
      // The roster has the realm as the game names it (folder names drop spaces).
      if (r.realm) j.character.realm = r.realm;
      if (r.name) j.character.name = r.name;
      j.character.className ??= r.className;
      j.character.key = characterKey(j.character);
    }
    journeys.push(j);
  }
  journeys.sort((a, b) => b.character.level - a.character.level || a.character.name.localeCompare(b.character.name));
  return { journeys, notes };
}
