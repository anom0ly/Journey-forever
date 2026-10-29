// Road to Sixty (v1.15, saved layout DATA_VERSION 4): RoadToSixtyCharDB, one
// per character, holds the journey: path segments, an event timeline and a
// snapshot at each level. RoadToSixtyDB, account-wide, holds the roster
// (each character's name, realm and class by GUID).
//
// Each saved event is an array { time, kind, continentID, x, y, ... } with
// the kind's own fields from the sixth entry on; -1, 0, 0 when no position
// was known. Kinds this site doesn't know are skipped (the addon adds kinds
// without bumping its layout version).

import type { Item, JEvent, LevelInfo, RunSummary, Segment, Session } from "../journey";
import { entries, isObj, list, num, str, type LuaValue } from "../lua";
import { parseItem } from "../wow";
import type { Contribution, FileContext } from "./types";

export const RTS_KNOWN_VERSION = 4;

const SOURCE_HOW = new Set(["drop", "quest", "vendor", "trade", "mail", "ah", "craft", "roll", "?"]);

function bool(v: LuaValue | undefined): boolean | undefined {
  return v === true ? true : undefined;
}

function itemsOf(v: LuaValue | undefined, names: Record<string, string>): Item[] {
  const out: Item[] = [];
  for (const link of list(v)) {
    const item = parseItem(link);
    if (!item) continue;
    if (item.id && item.name) names[item.id] = item.name;
    out.push(item);
  }
  return out;
}

function runSummary(v: LuaValue | undefined, names: Record<string, string>): RunSummary | undefined {
  if (!isObj(v)) return undefined;
  return {
    name: str(v.name),
    duration: num(v.duration),
    kills: num(v.kills),
    xp: num(v.xp),
    deaths: num(v.deaths),
    money: num(v.money),
    levels: num(v.levels),
    items: itemsOf(v.items, names),
    // party is a list of the others' GUIDs: only how many is kept.
    groupSize: list(v.party).length ? list(v.party).length + 1 : undefined,
    type: str(v.type),
  };
}

// One saved event as the site's event, or undefined for a kind it skips.
// f is the kind's own fields (the saved array from its sixth entry).
function convert(kind: string, f: LuaValue[], names: Record<string, string>): Record<string, unknown> | undefined {
  switch (kind) {
    case "on":
      return { level: num(f[0]) };
    case "off":
      return {};
    case "lvl":
      return { level: num(f[0]) };
    case "die":
      return {};
    case "qa":
      return { questID: num(f[0]) };
    case "qd":
      return { questID: num(f[0]), xp: num(f[1]), money: num(f[2]), title: str(f[3]) };
    case "zone":
      return { mapID: num(f[0]) };
    case "in":
      return { instanceID: num(f[0]), name: str(f[1]), type: str(f[2]) };
    case "out":
      return { instanceID: num(f[0]), run: runSummary(f[1], names) };
    case "loot": {
      const item = parseItem(f[0], f[1]);
      if (item?.id && item.name) names[item.id] = item.name;
      return { item, instanceID: num(f[2]) };
    }
    case "eq": {
      const itemID = num(f[1]);
      const source = isObj(f[4]) ? f[4] : undefined;
      const how = source && str(source.how);
      return {
        slot: num(f[0]),
        itemID,
        late: bool(f[3]),
        // Where it came from, without who: a trade or mail names the other player.
        how: how && SOURCE_HOW.has(how) ? how : undefined,
      };
    }
    case "prof":
      return { name: str(f[0]), rank: num(f[1]), max: num(f[2]), baseline: bool(f[3]) };
    case "rec":
      return { name: str(f[0]), profession: str(f[2]), trainer: f[3] === "t" || undefined };
    case "gj":
      return { name: str(f[0]), rank: str(f[1]), baseline: bool(f[2]) };
    case "gl":
      return { name: str(f[0]), how: str(f[1]) };
    case "gr":
      return { name: str(f[0]), rank: str(f[1]), up: bool(f[2]) };
    case "rep":
      return { factionID: num(f[0]), standing: num(f[1]), name: str(f[2]), up: bool(f[3]) };
    case "ride":
      return { name: str(f[1]), late: bool(f[2]) };
    case "mount":
      return { name: str(f[1]) };
    case "rare":
      return { name: str(f[0]), classification: str(f[1]), level: num(f[2]) };
    case "grp":
      // members are other players: keep only the group's size.
      return { kind: str(f[0]), size: list(f[1]).length + 1, leader: bool(f[2]) };
    case "grpx": {
      const s = isObj(f[0]) ? f[0] : {};
      return {
        duration: num(s.duration), kills: num(s.kills), xp: num(s.xp), quests: num(s.quests),
        deaths: num(s.deaths), instances: num(s.instances),
        size: Array.isArray(s.met) || isObj(s.met) ? list(s.met).length + 1 : undefined,
      };
    }
    case "ench":
      // by and byGUID name whoever enchanted it: only whether it was the player.
      return { itemID: num(f[0]), enchantID: num(f[1]), slot: num(f[3]), self: f[4] === "self" || undefined, text: str(f[7]) };
    default:
      return undefined;
  }
}

function clean(o: Record<string, unknown>): Record<string, unknown> {
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  return o;
}

function segmentsOf(v: LuaValue | undefined): Segment[] {
  const out: Segment[] = [];
  for (const s of list(v)) {
    if (!isObj(s)) continue;
    const c = num(s.c), t = num(s.t), x = num(s.x), y = num(s.y);
    if (c === undefined || t === undefined || x === undefined || y === undefined) continue;
    const d = str(s.d) ?? "";
    const seg: Segment = { m: str(s.m) ?? "w", c, t, x, y, d: /^[-\d,;]*$/.test(d) ? d : "" };
    const j = str(s.j);
    if (j) seg.j = j;
    out.push(seg);
  }
  return out.sort((a, b) => a.t - b.t);
}

function levelsOf(v: LuaValue | undefined): LevelInfo[] {
  const out: LevelInfo[] = [];
  for (const [k, snap] of entries(v)) {
    const level = Number(k);
    if (!Number.isInteger(level) || !isObj(snap)) continue;
    out.push(clean({ level, t: num(snap.t), money: num(snap.money) }) as unknown as LevelInfo);
  }
  return out.sort((a, b) => a.level - b.level);
}

// Sessions from the "on" and "off" events. A session with no "off" (the game
// crashed) ends at its last event.
function sessionsOf(events: JEvent[]): Session[] {
  const out: Session[] = [];
  let open: Session | undefined;
  let level: number | undefined;
  for (const e of events) {
    if (e.k === "lvl" && typeof e.level === "number") level = e.level;
    if (e.k === "on") {
      if (open) out.push(open);
      level = typeof e.level === "number" ? e.level : level;
      open = { start: e.t, end: e.t, startLevel: level, endLevel: level };
    } else if (open) {
      open.end = e.t;
      open.endLevel = level;
      if (e.k === "off") {
        out.push(open);
        open = undefined;
      }
    }
  }
  if (open) out.push(open);
  return out;
}

export function parseRoadToSixtyChar(db: LuaValue | undefined, ctx: FileContext): Contribution {
  const source = { addon: "rts" as const, status: "ok" as Contribution["source"]["status"] } as Contribution["source"];
  if (!isObj(db)) {
    return { source: { ...source, status: "error", message: "RoadToSixtyCharDB is missing or not a table" }, character: {} };
  }
  source.version = str(db.addon);
  const dataVersion = num(db.version);
  source.dataVersion = dataVersion;
  const guid = str(db.journeyId)?.match(/^([\w-]+):\d+$/)?.[1];
  const character = { guid, name: ctx.character, realm: ctx.realm, className: str(db.class) };
  if (dataVersion !== undefined && dataVersion > RTS_KNOWN_VERSION) {
    source.status = "refused";
    source.message = `Saved by a newer Road to Sixty (layout ${dataVersion}; this site reads up to ${RTS_KNOWN_VERSION}). Its path and timeline are skipped until the site is updated.`;
    return { source, character };
  }

  const items: Record<string, string> = {};
  const events: JEvent[] = [];
  for (const raw of list(db.events)) {
    const e = list(raw);
    const t = num(e[0]), kind = str(e[1]);
    if (t === undefined || !kind) continue;
    const fields = convert(kind, e.slice(5), items);
    if (!fields) continue;
    const ev: JEvent = { t, k: kind, ...clean(fields) };
    const c = num(e[2]), x = num(e[3]), y = num(e[4]);
    if (c !== undefined && c >= 0 && x !== undefined && y !== undefined) {
      ev.c = c;
      ev.x = x;
      ev.y = y;
    }
    events.push(ev);
  }
  events.sort((a, b) => a.t - b.t);

  let level = 0;
  for (const e of events) if ((e.k === "lvl" || e.k === "on") && typeof e.level === "number") level = Math.max(level, e.level);
  const levels = levelsOf(db.levels);
  for (const l of levels) level = Math.max(level, l.level);

  let kills: Contribution["kills"];
  if (isObj(db.kills) && typeof db.kills.d === "string" && /^[-\d,;]*$/.test(db.kills.d)) {
    kills = { d: db.kills.d, names: list(db.kills.names).map((n) => (typeof n === "string" ? n : "?")) };
  }

  const segments = segmentsOf(db.segments);
  const last = Math.max(events.at(-1)?.t ?? 0, segments.at(-1)?.t ?? 0);
  if (last) source.seenAt = last;
  if (dataVersion !== undefined && dataVersion < RTS_KNOWN_VERSION) {
    source.message = `Older layout ${dataVersion}; read as is.`;
  }
  return {
    source,
    character: { ...character, level: level || undefined },
    events,
    segments,
    kills,
    levels,
    sessions: sessionsOf(events),
    items,
  };
}

export interface RosterEntry {
  guid?: string;
  name?: string;
  realm?: string;
  className?: string;
  level?: number;
}

// The account-wide file's roster: what it knows of each character, by GUID
// (or Name-Realm for entries from before GUIDs). Journey copies in it are
// left alone; each character's own file is read instead.
export function parseRoadToSixtyAccount(db: LuaValue | undefined): RosterEntry[] {
  if (!isObj(db) || !isObj(db.roster)) return [];
  const out: RosterEntry[] = [];
  for (const [key, r] of entries(db.roster)) {
    if (!isObj(r)) continue;
    out.push({
      guid: str(r.guid) ?? (key.startsWith("Player-") ? key : undefined),
      name: str(r.name),
      realm: str(r.realm),
      className: str(r.class),
      level: num(r.level),
    });
  }
  return out;
}
