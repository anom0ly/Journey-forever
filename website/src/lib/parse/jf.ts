// Journey Forever, our own addon (schemaVersion 1): JourneyForeverDB, one
// per character, holds a log of screenshots the addon took (dungeon cleared,
// epic loot, level up and the optional triggers) and the player's /jf notes,
// each with its time and place.
//
// Entries are keyed tables; addon/FORMAT.md has every field. Each has a
// place: t (the PC's clock, time()), mapID, x and y (0-1 on that map) and,
// outdoors, wx, wy and continent: world yards as Road to Sixty saves them.
// A screenshot also has kind, detail, shot (the file name the game gives
// the picture, WoWScrnShot_MMDDYY_HHMMSS without extension) and ok (false
// when the game said it failed). utcOffset, at the top, is how far the PC's
// clock is ahead of UTC, for reading those file names.
//
// Positional entries ({ t, kind, mapID, x, y, detail }) are read too, and
// unknown kinds and fields are kept, so the addon can grow without the site
// breaking.

import type { JEvent } from "../journey";
import { isObj, list, num, str, type LuaValue } from "../lua";
import { parseItem } from "../wow";
import type { Contribution, FileContext } from "./types";

export const JF_KNOWN_VERSION = 1;

const SHOT_FIELDS = ["t", "kind", "mapID", "x", "y", "detail"];
const NOTE_FIELDS = ["t", "text", "mapID", "x", "y", "zone"];

// An entry as a keyed object, whether it was saved as an array or keyed.
function keyed(v: LuaValue, names: string[]): Record<string, LuaValue> | undefined {
  if (isObj(v)) return v;
  if (!Array.isArray(v)) return undefined;
  const out: Record<string, LuaValue> = {};
  names.forEach((n, i) => (out[n] = v[i] ?? null));
  return out;
}

// 0-1 map coordinates; also accepts 0-100 in case the addon saves percentages.
function coord(v: LuaValue | undefined): number | undefined {
  const n = num(v);
  if (n === undefined || n < 0) return undefined;
  return n > 1 ? n / 100 : n;
}

// The entry's world position, when it was outdoors.
function place(ev: JEvent, v: Record<string, LuaValue>): void {
  const c = num(v.continent), x = num(v.wx), y = num(v.wy);
  if (c !== undefined && c >= 0 && x !== undefined && y !== undefined) {
    ev.c = c;
    ev.x = Math.round(x);
    ev.y = Math.round(y);
  }
  const level = num(v.level);
  if (level !== undefined) ev.level = level;
  const zone = str(v.zone);
  if (zone) ev.zone = zone;
}

function detailOf(v: LuaValue | undefined): Record<string, unknown> | undefined {
  if (!isObj(v)) return typeof v === "string" ? { text: v } : undefined;
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) {
    if (typeof x === "string" || typeof x === "number" || typeof x === "boolean") out[k] = x;
  }
  const item = parseItem(v.item ?? v.link, v.quality);
  if (item) {
    if (!item.name && typeof v.name === "string") item.name = v.name;
    out.item = item;
    delete out.link;
  }
  return out;
}

export function parseJourneyForever(db: LuaValue | undefined, ctx: FileContext): Contribution {
  if (!isObj(db)) {
    return { source: { addon: "jf", status: "error", message: "JourneyForeverDB is missing or not a table" }, character: {} };
  }
  const dataVersion = num(db.schemaVersion);
  const char = isObj(db.char) ? db.char : {};
  const source: Contribution["source"] = { addon: "jf", status: "ok", dataVersion, version: str(db.addon) ?? str(db.version) };
  const character = {
    guid: str(char.guid),
    name: str(char.name) ?? ctx.character,
    realm: str(char.realm) ?? ctx.realm,
    className: str(char.class),
    race: str(char.race),
  };
  if (dataVersion !== undefined && dataVersion > JF_KNOWN_VERSION) {
    source.status = "refused";
    source.message = `Saved by a newer Journey Forever addon (schema ${dataVersion}; this site reads up to ${JF_KNOWN_VERSION}). Screenshots and notes are skipped until the site is updated.`;
    return { source, character };
  }
  const events: JEvent[] = [];
  const items: Record<string, string> = {};
  for (const raw of list(db.screenshots)) {
    const s = keyed(raw, SHOT_FIELDS);
    const t = s && num(s.t);
    if (!s || t === undefined) continue;
    const ev: JEvent = { t, k: "shot", kind: str(s.kind) ?? "manual" };
    const mapID = num(s.mapID);
    if (mapID !== undefined) ev.mapID = mapID;
    const x = coord(s.x), y = coord(s.y);
    if (x !== undefined && y !== undefined) {
      ev.mapX = x;
      ev.mapY = y;
    }
    const detail = detailOf(s.detail);
    if (detail) {
      ev.detail = detail;
      const item = detail.item as { id?: number; name?: string } | undefined;
      if (item?.id && item.name) items[item.id] = item.name;
    }
    place(ev, s);
    const shot = str(s.shot) ?? str(s.file);
    if (shot) ev.shot = shot.replace(/\.(jpe?g|png|tga)$/i, "");
    if (s.ok === false) ev.failed = true;
    if (s.hiddenUI === true) ev.hiddenUI = true;
    events.push(ev);
  }
  for (const raw of list(db.notes)) {
    const n = keyed(raw, NOTE_FIELDS);
    const t = n && num(n.t);
    const text = n && str(n.text);
    if (!n || t === undefined || !text) continue;
    const ev: JEvent = { t, k: "note", text: text.slice(0, 2000) };
    const mapID = num(n.mapID);
    if (mapID !== undefined) ev.mapID = mapID;
    const x = coord(n.x), y = coord(n.y);
    if (x !== undefined && y !== undefined) {
      ev.mapX = x;
      ev.mapY = y;
    }
    place(ev, n);
    const subzone = str(n.subzone);
    if (subzone) ev.subzone = subzone;
    events.push(ev);
  }
  events.sort((a, b) => a.t - b.t);
  const zones: Record<string, string> = {};
  for (const e of events) if (typeof e.mapID === "number" && typeof e.zone === "string") zones[e.mapID] = e.zone;
  if (events.length) source.seenAt = events.at(-1)!.t;
  const utcOffset = num(db.utcOffset);
  return { source, character: { ...character, level: num(char.level) }, events, zones, items, ...(utcOffset !== undefined ? { utcOffset } : {}) };
}
