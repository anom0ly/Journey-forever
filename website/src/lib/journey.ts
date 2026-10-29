// The journey the site stores and shows for one character: what the three
// addons' saved files say, merged into one timeline. Built in the browser
// from the uploaded files (see parse/), stored as JSON, read by every page.
//
// Times are Unix seconds. Positions are world yards on a continent (x runs
// north, y runs west, as the game's world positions do); events without a
// known position leave c, x and y out.
//
// Other players are never stored: no names, GUIDs or chat. Group events keep
// only counts.

export const JOURNEY_FORMAT = 1;

export type AddonId = "rts" | "jt" | "jf";

export interface SourceInfo {
  addon: AddonId;
  // "ok": read; "refused": a layout version this site doesn't know yet;
  // "error": the file couldn't be read; "missing": not in the upload.
  status: "ok" | "refused" | "error" | "missing";
  version?: string; // the addon's own version, when the file says
  dataVersion?: number; // the saved layout's version
  message?: string;
  seenAt?: number; // when this source last had data (newest time in it)
}

export interface Character {
  key: string; // the character's GUID, or "Name-Realm" when no file has it
  guid?: string;
  name: string;
  realm: string;
  className?: string; // the client's file name, e.g. "PALADIN"
  race?: string; // e.g. "Dwarf"
  level: number;
}

// One step of the timeline. k is the kind (Road to Sixty's names where it
// has one); the rest depends on it, see the EventFields map.
export interface JEvent {
  t: number;
  k: string;
  c?: number;
  x?: number;
  y?: number;
  [field: string]: unknown;
}

export interface Item {
  id?: number;
  name?: string;
  quality?: number; // 0 poor .. 5 legendary
}

export interface RunSummary {
  name?: string;
  duration?: number;
  kills?: number;
  xp?: number;
  deaths?: number;
  money?: number;
  levels?: number;
  items?: Item[];
  groupSize?: number;
  type?: string;
}

// A path segment, in Road to Sixty's packed form: the start point, then
// "dt,dx,dy;" steps. m: w on foot or mounted, t flight path, g ghost.
// j: why the path jumped here (h hearth, p teleport, d died, di died in an
// instance, i left an instance, it sent out of one, b boat, l logged in).
export interface Segment {
  m: string;
  c: number;
  t: number;
  x: number;
  y: number;
  d: string;
  j?: string;
}

export interface LevelInfo {
  level: number;
  t?: number; // when it was reached
  played?: number; // /played seconds at the ding
  secondsOnLevel?: number; // played time spent on this level before the next ding
  money?: number; // copper on hand at the ding
  zone?: string;
}

export interface Session {
  start: number;
  end: number;
  startLevel?: number;
  endLevel?: number;
}

export interface Death {
  t: number;
  level?: number;
  killer?: string;
  zone?: string;
  subzone?: string;
  dungeon?: string;
  grouped?: boolean;
}

export interface DungeonRun {
  name: string;
  start: number;
  level?: number;
  duration?: number;
  bosses?: number;
  deaths?: number;
}

// Journey Tracker's aggregate counters, passed through with their own names.
export interface Stats {
  played?: number;
  time?: Record<string, number>;
  xp?: Record<string, number>;
  kills?: { total?: number; byClass?: Record<string, number>; byType?: Record<string, number>; top?: [string, number][] };
  quests?: Record<string, number>;
  money?: Record<string, number>;
  loot?: { items?: number; byQuality?: Record<string, number> };
  travel?: Record<string, number>;
  falls?: Record<string, number>;
  days?: number;
  hours?: Record<string, number>;
  professions?: Record<string, { level?: number; time?: number }>;
  dungeonsEntered?: Record<string, number>;
  runs?: DungeonRun[];
  deaths?: Death[];
  // [uiMapID] = { [square 1-625 of a 25x25 grid] = seconds }
  where?: Record<string, Record<string, number>>;
  firstSeen?: number;
}

export interface Journey {
  format: number;
  character: Character;
  sources: SourceInfo[];
  events: JEvent[];
  segments: Segment[];
  kills?: { d: string; names: string[] }; // packed "dt,xp,n;" as Road to Sixty saves it
  levels: LevelInfo[];
  sessions: Session[];
  stats: Stats;
  zones: Record<string, string>; // uiMapID -> name, learned from the files
  items: Record<string, string>; // item ID -> name, from item links seen
  utcOffset?: number; // seconds the player's PC clock is ahead of UTC, from our addon
  updatedAt: number;
}

export function emptyJourney(character: Character): Journey {
  return {
    format: JOURNEY_FORMAT,
    character,
    sources: [],
    events: [],
    segments: [],
    levels: [],
    sessions: [],
    stats: {},
    zones: {},
    items: {},
    updatedAt: 0,
  };
}

// What the character list shows; kept small, stored next to the journey.
export interface CharacterSummary {
  key: string;
  name: string;
  realm: string;
  className?: string;
  race?: string;
  level: number;
  played?: number;
  quests: number;
  distance: number; // yards on foot or mounted
  deaths: number;
  startedAt?: number;
  lastSeenAt?: number;
  zone?: string;
  sources: SourceInfo[];
}
