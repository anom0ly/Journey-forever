// Journey Tracker (v0.6, schemaVersion 1): JourneyTrackerDB, one per
// character, holds running counters rather than a timeline: gold earned and
// spent by category, time by state, XP by source, kills and loot by kind,
// plus lists of deaths, dungeon runs, sessions and a snapshot at each level.
// Times are the PC's clock (time()), positions zone map percentages.
//
// Group members are stored there only as hashes and PvP killers as
// "Player (PvP)", so nothing in it names another player.

import type { Death, DungeonRun, LevelInfo, Session, Stats } from "../journey";
import { entries, isObj, list, num, str, type LuaObject, type LuaValue } from "../lua";
import type { Contribution, FileContext } from "./types";

export const JT_KNOWN_VERSION = 1;

function numbers(v: LuaValue | undefined): Record<string, number> | undefined {
  if (!isObj(v) && !Array.isArray(v)) return undefined;
  const out: Record<string, number> = {};
  for (const [k, x] of entries(v)) if (typeof x === "number" && Number.isFinite(x)) out[k] = x;
  return out;
}

function deathsOf(v: LuaValue | undefined): Death[] {
  const out: Death[] = [];
  for (const d of list(v)) {
    if (!isObj(d)) continue;
    const t = num(d.t);
    if (t === undefined) continue;
    const killer = str(d.killer);
    out.push(strip({
      t,
      level: num(d.level),
      killer,
      zone: str(d.zone),
      subzone: str(d.subzone),
      dungeon: str(d.dungeon),
      grouped: d.grouped === true || undefined,
    }));
  }
  return out.sort((a, b) => a.t - b.t);
}

function runsOf(v: LuaValue | undefined): DungeonRun[] {
  const out: DungeonRun[] = [];
  for (const r of list(v)) {
    if (!isObj(r)) continue;
    const name = str(r.name), start = num(r.start);
    if (!name || start === undefined) continue;
    out.push(strip({ name, start, level: num(r.level), duration: num(r.duration), bosses: num(r.bosses), deaths: num(r.deaths) }));
  }
  return out.sort((a, b) => a.start - b.start);
}

function sessionsOf(v: LuaValue | undefined): Session[] {
  const S = isObj(v) ? v : {};
  const out: Session[] = [];
  const all = [...list(S.list)];
  if (isObj(S.current)) all.push(S.current);
  for (const s of all) {
    if (!isObj(s)) continue;
    const start = num(s.start), end = num(s.last);
    if (start === undefined || end === undefined) continue;
    const startLevel = num(s.startLevel);
    out.push(strip({ start, end, startLevel, endLevel: startLevel !== undefined ? startLevel + (num(s.levels) ?? 0) : undefined }));
  }
  return out.sort((a, b) => a.start - b.start);
}

function strip<T extends object>(o: T): T {
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined) delete o[k];
  return o;
}

export function parseJourneyTracker(db: LuaValue | undefined, ctx: FileContext): Contribution {
  if (!isObj(db)) {
    return { source: { addon: "jt", status: "error", message: "JourneyTrackerDB is missing or not a table" }, character: {} };
  }
  const char = isObj(db.char) ? db.char : {};
  const dataVersion = num(db.schemaVersion);
  const source: Contribution["source"] = { addon: "jt", status: "ok", dataVersion };
  const character = {
    guid: str(char.guid),
    name: str(char.name) ?? ctx.character,
    realm: str(char.realm) ?? ctx.realm,
    className: str(char.class),
    race: str(char.race),
  };
  if (dataVersion !== undefined && dataVersion > JT_KNOWN_VERSION) {
    source.status = "refused";
    source.message = `Saved by a newer Journey Tracker (schema ${dataVersion}; this site reads up to ${JT_KNOWN_VERSION}). Its stats are skipped until the site is updated.`;
    return { source, character };
  }

  const zones: Record<string, string> = {};
  const levels: LevelInfo[] = [];
  const perLevel = new Map<number, LuaObject>();
  for (const [k, v] of entries(db.levels)) if (isObj(v)) perLevel.set(Number(k), v);
  let level = 0;
  for (const [k, ding] of entries(db.dings)) {
    const lv = Number(k);
    if (!Number.isInteger(lv) || !isObj(ding)) continue;
    level = Math.max(level, lv);
    const mapID = num(ding.mapID), zone = str(ding.zone);
    if (mapID !== undefined && zone) zones[mapID] = zone;
    levels.push(strip({ level: lv, t: num(ding.t), played: num(ding.played), money: num(ding.gold), zone }));
  }
  for (const [lv, s] of perLevel) {
    level = Math.max(level, lv);
    const played = num(s.played);
    if (played === undefined) continue;
    const l = levels.find((x) => x.level === lv);
    if (l) l.secondsOnLevel = played;
    else levels.push({ level: lv, secondsOnLevel: played });
  }
  levels.sort((a, b) => a.level - b.level);

  const deaths = deathsOf(db.deaths);
  for (const d of list(db.deaths)) {
    if (isObj(d) && typeof d.mapID === "number" && typeof d.zone === "string") zones[d.mapID] = d.zone;
  }

  const kills = isObj(db.kills) ? db.kills : {};
  const byName = numbers(kills.byName) ?? {};
  const top = Object.entries(byName).sort((a, b) => b[1] - a[1]).slice(0, 15);
  const quests = isObj(db.quests) ? db.quests : {};
  const loot = isObj(db.loot) ? db.loot : {};
  const D = isObj(db.dungeons) ? db.dungeons : {};
  const runs = runsOf(D.runs);
  if (isObj(D.current)) runs.push(...runsOf([D.current]));

  const professions: Stats["professions"] = {};
  for (const [name, p] of entries(db.professions)) {
    if (isObj(p)) professions[name] = strip({ level: num(p.level), time: num(p.time) });
  }
  const where: Record<string, Record<string, number>> = {};
  for (const [mapID, squares] of entries(db.where)) {
    const n = numbers(squares);
    if (n && Object.keys(n).length) where[mapID] = n;
  }

  const stats: Stats = strip({
    played: num(isObj(db.played) ? db.played.total : undefined),
    time: numbers(db.time),
    xp: numbers(db.xp),
    kills: { total: num(kills.total), byClass: numbers(kills.byClass), byType: numbers(kills.byType), top },
    quests: strip({
      completed: num(quests.completed), accepted: num(quests.accepted), abandoned: num(quests.abandoned),
      xp: num(quests.xp), money: num(quests.money),
    }) as Record<string, number>,
    money: numbers(db.money),
    loot: { items: num(loot.items), byQuality: numbers(loot.byQuality) },
    travel: numbers(db.travel),
    falls: numbers(db.falls),
    days: entries(db.days).length || undefined,
    hours: numbers(db.hours),
    professions,
    dungeonsEntered: numbers(D.entered),
    runs,
    deaths,
    where,
    firstSeen: num(db.firstSeen) || undefined,
  });

  const sessions = sessionsOf(db.sessions);
  const seen = Math.max(sessions.at(-1)?.end ?? 0, deaths.at(-1)?.t ?? 0, levels.at(-1)?.t ?? 0);
  if (seen) source.seenAt = seen;
  return {
    source,
    character: { ...character, level: level || undefined },
    levels,
    sessions,
    stats,
    zones,
  };
}
