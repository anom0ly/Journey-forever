// What the Worker (worker/api.ts, worker/boards.ts) accepts from an upload. Journeys are built in the
// owner's browser, so anything that's shown to other people (on the
// leaderboards and in search) is checked here: names look like names,
// numbers are in range, and leaderboard zones, dungeons and professions
// are either known or used by several accounts before anyone sees them.

import mapData from "./map-data.json";
import type { Fmt, ParamKind } from "./boardDefs";
import type { CharacterSummary } from "./journey";
import { CLASS_COLORS, ZONE_NAMES } from "./wow";

export const DUNGEONS = [
  "Ragefire Chasm", "Wailing Caverns", "The Deadmines", "Deadmines", "Shadowfang Keep", "Blackfathom Deeps",
  "The Stockade", "Stormwind Stockade", "Gnomeregan", "Razorfen Kraul", "Scarlet Monastery", "Razorfen Downs",
  "Uldaman", "Zul'Farrak", "Maraudon", "The Temple of Atal'Hakkar", "Temple of Atal'Hakkar", "Sunken Temple",
  "Blackrock Depths", "Blackrock Spire", "Lower Blackrock Spire", "Upper Blackrock Spire", "Dire Maul",
  "Stratholme", "Scholomance", "Molten Core", "Onyxia's Lair", "Blackwing Lair", "Zul'Gurub",
  "Ruins of Ahn'Qiraj", "Ahn'Qiraj Temple", "Temple of Ahn'Qiraj", "Naxxramas",
];
export const PROFESSIONS = [
  "Alchemy", "Blacksmithing", "Enchanting", "Engineering", "Herbalism", "Leatherworking", "Mining", "Skinning",
  "Tailoring", "Cooking", "First Aid", "Fishing", "Lockpicking", "Riding",
];

const KNOWN: Record<"zone" | "dungeon" | "profession", Set<string>> = {
  zone: new Set([...mapData.zones.map((z) => z.name), ...Object.values(ZONE_NAMES), ...DUNGEONS]),
  dungeon: new Set(DUNGEONS),
  profession: new Set(PROFESSIONS),
};

// A zone, dungeon or profession nobody listed here knows yet (Forever's new
// ones, or another language's names) shows on the boards once this many
// accounts have it, so one account can't put its own words in front of everyone.
export const NEW_PARAM_ACCOUNTS = 3;

// How many different zones, dungeons or professions one character can send.
const PARAMS_PER_CHARACTER: Record<"zone" | "dungeon" | "profession", number> = { zone: 120, dungeon: 60, profession: 20 };

const PARAM_TEXT = /^[\p{L}\p{M}\p{N} '’:,.()-]{2,48}$/u;

export function isFreeParam(kind: ParamKind | undefined): kind is "zone" | "dungeon" | "profession" {
  return kind === "zone" || kind === "dungeon" || kind === "profession";
}

export function knownParam(kind: "zone" | "dungeon" | "profession", p: string): boolean {
  return KNOWN[kind].has(p);
}

// Whether a free-text param can be stored at all.
export function paramLooksRight(p: string): boolean {
  return PARAM_TEXT.test(p) && !/https?:|www\.|\.(com|net|org|gg|io)\b/i.test(p);
}

export function paramsPerCharacter(kind: "zone" | "dungeon" | "profession"): number {
  return PARAMS_PER_CHARACTER[kind];
}

// The range each kind of board number can be in.
const YEAR = 365 * 86400;
const RANGES: Record<Fmt, [number, number]> = {
  duration: [0, 5 * YEAR],
  date: [1_600_000_000, 4_000_000_000],
  gold: [0, 1e10], // copper: a million gold
  goldHour: [0, 1e10],
  count: [0, 1e8],
  xp: [0, 1e9],
  distance: [0, 1e10],
  percent: [0, 100],
  level: [1, 100],
  deaths: [0, 1e6],
};

export function valueInRange(fmt: Fmt, v: number): boolean {
  const [lo, hi] = RANGES[fmt];
  return Number.isFinite(v) && v >= lo && v <= hi;
}

const NAME = /^[\p{L}\p{M}]{2,24}$/u;
const REALM = /^[\p{L}\p{M}\p{N} '’-]{1,48}$/u;
const RACE = /^[A-Za-z]{2,32}$/;
const ZONE = /^[\p{L}\p{M}\p{N} '’:,.()-]{1,64}$/u;
const CLASSES = new Set(Object.keys(CLASS_COLORS));

function count(v: unknown, max = 1e10): boolean {
  return v === undefined || (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max);
}

// A character summary as the upload page sends it (lib/merge.ts summarize):
// what's wrong with it, or undefined. Race and current zone are only shown,
// so odd ones are dropped rather than refusing the upload.
export function summaryProblem(s: CharacterSummary): string | undefined {
  const bad = (what: string) => `The summary's ${what} doesn't look right`;
  if (!NAME.test(s.name)) return bad("character name");
  if (!REALM.test(s.realm)) return bad("realm");
  if (!Number.isInteger(s.level) || s.level < 1 || s.level > 100) return bad("level");
  if (s.className !== undefined && !CLASSES.has(s.className)) return bad("class");
  if (s.race !== undefined && (typeof s.race !== "string" || !RACE.test(s.race))) delete s.race;
  if (s.zone !== undefined && (typeof s.zone !== "string" || !ZONE.test(s.zone))) delete s.zone;
  if (!count(s.played) || !count(s.quests) || !count(s.distance) || !count(s.deaths)) return bad("numbers");
  if (!count(s.startedAt, 4e9) || !count(s.lastSeenAt, 4e9)) return bad("dates");
  return undefined;
}
