// What a pick on the Upload page held when nothing in it could be read, and
// what to tell the player: most often the wrong folder. Only folder and file
// names are looked at, never a file's contents.

import { SAVED_FILES } from "./parse/upload";

export interface PickShape {
  addonFolder: boolean; // Interface\AddOns (the addons themselves)
  addonCode: boolean; // one of our addons' own .lua files in there
  savedVariables: boolean; // a SavedVariables folder
  wtf: boolean; // a WTF folder
  backups: number; // .lua.bak copies of our files
  images: number;
  others: number;
}

export function emptyShape(): PickShape {
  return { addonFolder: false, addonCode: false, savedVariables: false, wtf: false, backups: 0, images: 0, others: 0 };
}

export function addToShape(shape: PickShape, path: string, image: boolean): void {
  const parts = path.split(/[\\/]/).filter(Boolean).map((p) => p.toLowerCase());
  const name = parts.at(-1) ?? "";
  const i = parts.indexOf("interface");
  if (i >= 0 && parts[i + 1] === "addons") shape.addonFolder = true;
  if (parts.includes("addons") && SAVED_FILES.some((f) => f.toLowerCase() === name)) shape.addonCode = true;
  if (parts.includes("savedvariables")) shape.savedVariables = true;
  if (parts.includes("wtf")) shape.wtf = true;
  if (SAVED_FILES.some((f) => `${f.toLowerCase()}.bak` === name)) shape.backups++;
  if (image) shape.images++;
  else shape.others++;
}

export function mergeShapes(a: PickShape, b: PickShape): PickShape {
  return {
    addonFolder: a.addonFolder || b.addonFolder,
    addonCode: a.addonCode || b.addonCode,
    savedVariables: a.savedVariables || b.savedVariables,
    wtf: a.wtf || b.wtf,
    backups: a.backups + b.backups,
    images: a.images + b.images,
    others: a.others + b.others,
  };
}

export type PickProblem = "images-only" | "addons-folder" | "backups" | "no-addon-files" | "wtf-root" | "nothing";

export function pickProblem(s: PickShape): PickProblem {
  if (s.addonFolder && !s.savedVariables) return "addons-folder";
  if (s.backups > 0 && !s.savedVariables) return "backups";
  if (s.savedVariables) return "no-addon-files";
  if (s.wtf) return "wtf-root";
  if (s.images > 0 && s.others === 0) return "images-only";
  return "nothing";
}

// What the player is told.
export const PICK_ADVICE: Record<PickProblem, string> = {
  "images-only": "Got the screenshots. Now add your saved files too, so we know which character and moment each one belongs to.",
  "addons-folder":
    "That's the addons folder (Interface\\AddOns), which holds the addons themselves, not your saved journey. Pick World of Warcraft\\_forever_\\WTF\\Account\\<your account> instead.",
  backups:
    "Those are the .lua.bak backup copies. Pick the files without .bak: RoadToSixty.lua, JourneyTracker.lua and JourneyForever.lua.",
  "no-addon-files":
    "That SavedVariables folder has no Road to Sixty or Journey Forever files yet. Check both addons are installed and turned on, play, then log out of WoW (it writes the files when you log out) and try again.",
  "wtf-root":
    "Nearly there: that's the WTF folder. Open Account inside it and pick your account's folder (WTF\\Account\\<your account>).",
  nothing:
    "No Road to Sixty, Journey Tracker or Journey Forever files in what you added. Choose RoadToSixty.lua, JourneyTracker.lua and JourneyForever.lua from a character's SavedVariables folder, or the whole WTF\\Account\\<account> folder.",
};

// The report's message: the problem and the counts, no names.
export function pickSummary(s: PickShape): string {
  return `Nothing to read (${pickProblem(s)}): ${s.images} images, ${s.others} other files${s.backups ? `, ${s.backups} backups` : ""}`;
}
