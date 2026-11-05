// Puts the three addons' contributions together into one journey per
// character, and folds a new upload into the journey stored before it.

import {
  JOURNEY_FORMAT,
  type AddonId,
  type Character,
  type CharacterSummary,
  type Death,
  type JEvent,
  type Journey,
  type LevelInfo,
  type Segment,
  type Session,
  type SourceInfo,
  type Stats,
} from "./journey";
import { distanceByMode, PathIndex } from "./path";
import type { Contribution } from "./parse/types";
import { mapToWorld, MAPS } from "./maps";
import { ZONE_NAMES } from "./wow";

const ADDONS: AddonId[] = ["rts", "jt", "jf"];

// Journey Tracker times its deaths by the PC's clock and Road to Sixty by
// the realm's, so the same death can be this far apart.
const DEATH_MATCH_SECONDS = 180;

// How Journey Tracker names a player who killed the character.
const PVP_KILLER = "Player (PvP)";

export function characterKey(c: Partial<Character>): string {
  if (c.guid) return c.guid;
  return `${c.name ?? "Unknown"}-${c.realm ?? "Unknown"}`;
}

function mergeCharacter(parts: Partial<Character>[]): Character {
  const out: Partial<Character> = {};
  for (const p of parts) {
    for (const [k, v] of Object.entries(p) as [keyof Character, unknown][]) {
      if (v === undefined || v === null || v === "") continue;
      if (k === "level") out.level = Math.max(out.level ?? 0, v as number);
      else if (out[k] === undefined) (out as Record<string, unknown>)[k] = v;
    }
  }
  const c: Character = {
    key: "",
    name: out.name ?? "Unknown",
    realm: out.realm ?? "Unknown",
    level: out.level ?? 1,
    ...(out.guid ? { guid: out.guid } : {}),
    ...(out.className ? { className: out.className } : {}),
    ...(out.race ? { race: out.race } : {}),
  };
  c.key = characterKey(c);
  return c;
}

function mergeLevels(lists: (LevelInfo[] | undefined)[]): LevelInfo[] {
  const by = new Map<number, LevelInfo>();
  for (const l of lists) {
    for (const x of l ?? []) {
      const had = by.get(x.level) ?? { level: x.level };
      // The first source to give a field keeps it (Road to Sixty's times are the realm's clock).
      for (const [k, v] of Object.entries(x)) {
        if (v !== undefined && (had as unknown as Record<string, unknown>)[k] === undefined) {
          (had as unknown as Record<string, unknown>)[k] = v;
        }
      }
      by.set(x.level, had);
    }
  }
  return [...by.values()].sort((a, b) => a.level - b.level);
}

// Played time spent on each level, from the sessions, where Journey Tracker
// didn't give it.
function fillLevelTimes(levels: LevelInfo[], sessions: Session[]): void {
  for (let i = 0; i < levels.length; i++) {
    const l = levels[i], next = levels[i + 1];
    if (l.secondsOnLevel !== undefined || l.t === undefined || !next?.t || next.level !== l.level + 1) continue;
    let total = 0;
    for (const s of sessions) total += Math.max(0, Math.min(s.end, next.t) - Math.max(s.start, l.t));
    if (total > 0) l.secondsOnLevel = total;
  }
}

function levelAt(levels: LevelInfo[], t: number): number | undefined {
  let level: number | undefined;
  for (const l of levels) if (l.t !== undefined && l.t <= t) level = l.level;
  return level;
}

// Road to Sixty's deaths have the place; Journey Tracker's have the killer
// and the zone's name. Each Road to Sixty death takes the nearest Journey
// Tracker one; those left over join the timeline on their own.
function mergeDeaths(events: JEvent[], deaths: Death[] | undefined): void {
  const pool = [...(deaths ?? [])];
  for (const e of events) {
    if (e.k !== "die") continue;
    let best = -1;
    let gap = DEATH_MATCH_SECONDS + 1;
    pool.forEach((d, i) => {
      const g = Math.abs(d.t - e.t);
      if (g < gap) {
        gap = g;
        best = i;
      }
    });
    if (best < 0) continue;
    const d = pool.splice(best, 1)[0];
    // Road to Sixty's own killer (from the death recap, 1.18 on) wins; a
    // player's name it never keeps, so Journey Tracker's "Player (PvP)" is
    // only taken as the kind.
    const pvp = d.killer === PVP_KILLER;
    const fill = strip({
      killer: pvp ? undefined : d.killer, killerKind: pvp ? "player" : undefined,
      zone: d.zone, subzone: d.subzone, dungeon: d.dungeon, level: d.level, grouped: d.grouped,
    }) as Record<string, unknown>;
    const killed = e.killerKind !== undefined || e.killer !== undefined;
    for (const [k, v] of Object.entries(fill)) {
      if ((k === "killer" || k === "killerKind") && killed) continue;
      if (k === "killer" || k === "killerKind" || e[k] === undefined) e[k] = v;
    }
  }
  for (const d of pool) {
    const pvp = d.killer === PVP_KILLER;
    events.push(strip({
      t: d.t, k: "die", killer: pvp ? undefined : d.killer, killerKind: pvp ? "player" : undefined, zone: d.zone, subzone: d.subzone, dungeon: d.dungeon, level: d.level, grouped: d.grouped,
      mapID: d.mapID, mapX: d.mapX, mapY: d.mapY,
    }));
  }
}

function strip<T extends object>(o: T): T {
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined) delete o[k];
  return o;
}

// Events with no world position (screenshots, notes, Journey Tracker's
// deaths) are put where their zone map position says, else where the path
// was at that moment, or inside an instance,
// where there is no path, where the last placed event was (Road to Sixty
// gives events inside instances the last outdoor position).
const PLACE_FROM_EVENT_SECONDS = 6 * 3600;

function placeEvents(events: JEvent[], segments: Segment[]): void {
  const index = segments.length ? new PathIndex(segments) : undefined;
  let last: JEvent | undefined;
  for (const e of events) {
    if (e.c !== undefined && !e.approx) {
      last = e;
      continue;
    }
    const onMap = typeof e.mapX === "number" && typeof e.mapY === "number" ? mapToWorld(e.mapID, e.mapX, e.mapY) : undefined;
    if (onMap) {
      Object.assign(e, onMap);
      last = e;
      continue;
    }
    const p = index?.at(e.t) ?? (last && e.t - last.t <= PLACE_FROM_EVENT_SECONDS ? { c: last.c!, x: last.x!, y: last.y! } : undefined);
    if (p) {
      e.c = p.c;
      e.x = p.x;
      e.y = p.y;
      e.approx = true;
    }
  }
}

// One character's journey from the files of one upload.
export function buildJourney(parts: Contribution[], now = Math.floor(Date.now() / 1000)): Journey {
  const by = new Map<AddonId, Contribution>();
  for (const p of parts) by.set(p.source.addon, p);
  const rts = by.get("rts"), jt = by.get("jt"), jf = by.get("jf");
  const character = mergeCharacter([rts?.character ?? {}, jt?.character ?? {}, jf?.character ?? {}]);

  const sources: SourceInfo[] = ADDONS.map((a) => by.get(a)?.source ?? { addon: a, status: "missing" });
  const segments = rts?.segments ?? [];
  const events: JEvent[] = [...(rts?.events ?? []), ...(jf?.events ?? [])];
  mergeDeaths(events, jt?.stats?.deaths);
  events.sort((a, b) => a.t - b.t);
  placeEvents(events, segments);

  const levels = mergeLevels([rts?.levels, jt?.levels]);
  const sessions = rts?.sessions?.length ? rts.sessions : jt?.sessions ?? [];
  fillLevelTimes(levels, sessions);
  for (const e of events) {
    if (e.k === "die" && e.level === undefined) {
      const lv = levelAt(levels, e.t);
      if (lv !== undefined) e.level = lv;
    }
  }

  const zones: Record<string, string> = {};
  for (const [id, name] of Object.entries(ZONE_NAMES)) zones[id] = name;
  for (const m of MAPS) zones[m.id] = m.name;
  Object.assign(zones, jt?.zones, jf?.zones);
  for (const e of events) if (e.k === "in" && typeof e.instanceID === "number" && typeof e.name === "string") zones[`i${e.instanceID}`] = e.name;

  return {
    format: JOURNEY_FORMAT,
    character,
    sources,
    events,
    segments,
    ...(rts?.kills ? { kills: rts.kills } : {}),
    levels,
    sessions,
    stats: jt?.stats ?? {},
    ...(jt?.stats && Object.keys(jt.stats).length ? { pcStats: { [pcKey(jt.stats)]: jt.stats } } : {}),
    zones,
    items: { ...rts?.items, ...jf?.items },
    ...(jf?.utcOffset !== undefined ? { utcOffset: jf.utcOffset } : {}),
    updatedAt: now,
  };
}

function eventKey(e: JEvent): string {
  const extra = e.questID ?? e.level ?? e.mapID ?? e.instanceID ?? (e.item as { id?: number } | undefined)?.id ?? e.name ?? e.text ?? e.kind ?? e.slot ?? "";
  // A skill can rise more than one step in a second (several found at login).
  const rank = e.k === "skill" ? `|${String(e.rank)}` : "";
  return `${e.t}|${e.k}|${String(extra)}${rank}`;
}

// ---------------------------------------------------------------- two PCs
//
// Saved files live on the PC, so a character played on two PCs has two sets,
// each holding only that PC's sessions. Road to Sixty times everything by the
// realm's clock, so its timeline, path and kills from both simply interleave.
// Journey Tracker keeps running totals instead, which can't be told apart by
// time: each PC's totals are kept on their own and added up.

// Which PC a Journey Tracker file came from: the moment it first saw the
// character, which is set once per PC and never changes.
export function pcKey(stats: Stats): string {
  return stats.firstSeen ? String(stats.firstSeen) : "?";
}

// Each PC's Journey Tracker totals in a stored journey (older journeys kept
// only one set, in stats).
function pcStatsOf(j: Journey): Record<string, Stats> {
  if (j.pcStats) return j.pcStats;
  return Object.keys(j.stats).length ? { [pcKey(j.stats)]: j.stats } : {};
}

// How many PCs the journey's Journey Tracker totals came from.
export function pcCount(j: Journey): number {
  return Object.keys(j.pcStats ?? {}).length;
}

function addRecords(list: (Record<string, number> | undefined)[]): Record<string, number> | undefined {
  let out: Record<string, number> | undefined;
  for (const r of list) {
    if (!r) continue;
    out ??= {};
    for (const [k, v] of Object.entries(r)) if (typeof v === "number") out[k] = (out[k] ?? 0) + v;
  }
  return out;
}

function addOpt(list: (number | undefined)[]): number | undefined {
  const n = list.filter((x): x is number => typeof x === "number");
  return n.length ? n.reduce((a, b) => a + b, 0) : undefined;
}

function maxOpt(list: (number | undefined)[]): number | undefined {
  const n = list.filter((x): x is number => typeof x === "number");
  return n.length ? Math.max(...n) : undefined;
}

function unionBy<T>(lists: (T[] | undefined)[], key: (x: T) => string, time: (x: T) => number): T[] | undefined {
  if (!lists.some((l) => l)) return undefined;
  const by = new Map<string, T>();
  for (const l of lists) for (const x of l ?? []) if (!by.has(key(x))) by.set(key(x), x);
  return [...by.values()].sort((a, b) => time(a) - time(b));
}

// Journey Tracker's totals from several PCs as one set. Played time is the
// server's (the same on every PC), so the largest is right; days played can
// fall on both PCs, so the largest is the safe count; the rest add up.
export function combineStats(list: Stats[]): Stats {
  if (list.length <= 1) return list[0] ?? {};
  const top = new Map<string, number>();
  for (const s of list) for (const [name, n] of s.kills?.top ?? []) top.set(name, (top.get(name) ?? 0) + n);
  const professions: NonNullable<Stats["professions"]> = {};
  for (const s of list) {
    for (const [name, p] of Object.entries(s.professions ?? {})) {
      const had = professions[name] ?? {};
      professions[name] = strip({ level: maxOpt([had.level, p.level]), time: addOpt([had.time, p.time]) });
    }
  }
  const where: Record<string, Record<string, number>> = {};
  for (const s of list) for (const [id, squares] of Object.entries(s.where ?? {})) where[id] = addRecords([where[id], squares])!;
  const firstSeen = list.map((s) => s.firstSeen).filter((x): x is number => !!x);
  return strip({
    played: maxOpt(list.map((s) => s.played)),
    time: addRecords(list.map((s) => s.time)),
    xp: addRecords(list.map((s) => s.xp)),
    kills: list.some((s) => s.kills)
      ? strip({
          total: addOpt(list.map((s) => s.kills?.total)),
          byClass: addRecords(list.map((s) => s.kills?.byClass)),
          byType: addRecords(list.map((s) => s.kills?.byType)),
          top: [...top].sort((a, b) => b[1] - a[1]).slice(0, 15),
        })
      : undefined,
    quests: addRecords(list.map((s) => s.quests)),
    money: addRecords(list.map((s) => s.money)),
    loot: list.some((s) => s.loot)
      ? strip({ items: addOpt(list.map((s) => s.loot?.items)), byQuality: addRecords(list.map((s) => s.loot?.byQuality)) })
      : undefined,
    travel: addRecords(list.map((s) => s.travel)),
    falls: addRecords(list.map((s) => s.falls)),
    days: maxOpt(list.map((s) => s.days)),
    hours: addRecords(list.map((s) => s.hours)),
    professions: Object.keys(professions).length ? professions : undefined,
    dungeonsEntered: addRecords(list.map((s) => s.dungeonsEntered)),
    runs: unionBy(list.map((s) => s.runs), (r) => `${r.start}|${r.name}`, (r) => r.start),
    deaths: unionBy(list.map((s) => s.deaths), (d) => `${d.t}|${d.killer ?? ""}`, (d) => d.t),
    where: Object.keys(where).length ? where : undefined,
    firstSeen: firstSeen.length ? Math.min(...firstSeen) : undefined,
  });
}

// Road to Sixty's kill lists ("dt,xp,n;" with dt counted from 0, so the
// times are the realm's clock, and n the mob's place in names, from 1 as Lua
// counts) from two PCs as one list.
export function mergeKills(a: Journey["kills"], b: Journey["kills"]): Journey["kills"] {
  if (!a || !b) return a ?? b;
  const names: string[] = [];
  const nameIndex = new Map<string, number>();
  const kills = new Map<string, { t: number; xp: string; n: number }>();
  for (const list of [a, b]) {
    let t = 0;
    for (const m of list.d.matchAll(/(-?\d+),(\d+),(\d+);/g)) {
      t += Number(m[1]);
      // The same mob can have a different place in each PC's names, so the
      // name itself is matched.
      const name = list.names[Number(m[3]) - 1] ?? `#${m[3]}`;
      const key = `${t}|${m[2]}|${name}`;
      if (kills.has(key)) continue;
      let n = nameIndex.get(name);
      if (n === undefined) {
        names.push(name.startsWith("#") ? "?" : name);
        n = names.length;
        nameIndex.set(name, n);
      }
      kills.set(key, { t, xp: m[2], n });
    }
  }
  let t = 0;
  let d = "";
  for (const k of [...kills.values()].sort((x, y) => x.t - y.t)) {
    d += `${k.t - t},${k.xp},${k.n};`;
    t = k.t;
  }
  return { d, names };
}

// Folds a newly uploaded journey into the stored one. Saved files are
// cumulative, so the new one usually holds everything; the union keeps what
// a wiped or reset file no longer has (the beta's files were deleted once),
// and what was played on another PC.
export function mergeJourneys(old: Journey | undefined, next: Journey): Journey {
  if (!old) return next;
  const events = new Map<string, JEvent>();
  for (const e of old.events) events.set(eventKey(e), e);
  for (const e of next.events) events.set(eventKey(e), e);

  const segs = new Map<string, Segment>();
  for (const s of [...old.segments, ...next.segments]) {
    const k = `${s.t}|${s.c}`;
    const had = segs.get(k);
    if (!had || s.d.length >= had.d.length) segs.set(k, s);
  }

  const sessions = new Map<number, Session>();
  for (const s of [...old.sessions, ...next.sessions]) {
    const had = sessions.get(s.start);
    if (!had || s.end >= had.end) sessions.set(s.start, s);
  }

  const kills = mergeKills(old.kills, next.kills);
  // A new upload from the same PC replaces that PC's totals; another PC's are kept.
  const pcStats = { ...pcStatsOf(old) };
  for (const [pc, st] of Object.entries(pcStatsOf(next))) {
    const had = pcStats[pc];
    // The same PC's file is cumulative, so a smaller one was wiped: keep the larger.
    if (!had || (st.played ?? 0) >= (had.played ?? 0)) pcStats[pc] = st;
  }
  const slots = Object.values(pcStats);
  const stats = slots.length ? combineStats(slots) : (next.stats.played ?? 0) >= (old.stats.played ?? 0) ? next.stats : old.stats;

  const sources = next.sources.map((s) => {
    const before = old.sources.find((o) => o.addon === s.addon);
    if (s.status === "ok" || !before || before.status !== "ok") return s;
    // This upload didn't have it (or couldn't read it); what was stored stays.
    return { ...before, message: s.status === "missing" ? "Not in the latest upload; showing what was uploaded before." : s.message };
  });

  const character = { ...old.character, ...next.character, level: Math.max(old.character.level, next.character.level) };
  return {
    ...next,
    character,
    sources,
    events: [...events.values()].sort((a, b) => a.t - b.t),
    segments: [...segs.values()].sort((a, b) => a.t - b.t),
    ...(kills ? { kills } : {}),
    levels: mergeLevels([next.levels, old.levels]),
    sessions: [...sessions.values()].sort((a, b) => a.start - b.start),
    stats,
    ...(slots.length ? { pcStats } : {}),
    zones: { ...old.zones, ...next.zones },
    items: { ...old.items, ...next.items },
    ...((next.utcOffset ?? old.utcOffset) !== undefined ? { utcOffset: next.utcOffset ?? old.utcOffset } : {}),
  };
}

export function questCount(j: Journey): number {
  const done = j.events.filter((e) => e.k === "qd").length;
  return Math.max(done, j.stats.quests?.completed ?? 0);
}

export function deathCount(j: Journey): number {
  return Math.max(j.events.filter((e) => e.k === "die").length, j.stats.deaths?.length ?? 0);
}

export function lastSeen(j: Journey): number | undefined {
  const times = [j.events.at(-1)?.t, j.segments.at(-1)?.t, j.sessions.at(-1)?.end].filter((x): x is number => !!x);
  return times.length ? Math.max(...times) : undefined;
}

// Forever's realms opened at 2026-11-04 18:00 UTC. A character whose newest
// data is older was played on the beta or stress test, whose realms are gone
// (Road to Sixty 1.19.5 hides them in-game by the same rule).
export const FOREVER_LAUNCH = 1793815200;

export function isPreLaunch(j: Journey): boolean {
  const last = lastSeen(j);
  return last !== undefined && last < FOREVER_LAUNCH;
}

export function firstSeen(j: Journey): number | undefined {
  const times = [j.events[0]?.t, j.segments[0]?.t, j.sessions[0]?.start, j.stats.firstSeen].filter((x): x is number => !!x);
  return times.length ? Math.min(...times) : undefined;
}

export function currentZone(j: Journey): string | undefined {
  for (let i = j.events.length - 1; i >= 0; i--) {
    const e = j.events[i];
    if (e.k === "zone" && typeof e.mapID === "number") return j.zones[e.mapID];
  }
  return undefined;
}

export function summarize(j: Journey): CharacterSummary {
  const dist = distanceByMode(j.segments);
  const c = j.character;
  return strip({
    key: c.key,
    name: c.name,
    realm: c.realm,
    className: c.className,
    race: c.race,
    level: c.level,
    played: j.stats.played ?? sessionsPlayed(j.sessions),
    quests: questCount(j),
    distance: Math.round(dist.w || j.stats.travel?.ground || 0),
    deaths: deathCount(j),
    startedAt: firstSeen(j),
    lastSeenAt: lastSeen(j),
    zone: currentZone(j),
    sources: j.sources,
  });
}

export function sessionsPlayed(sessions: Session[]): number | undefined {
  if (!sessions.length) return undefined;
  return sessions.reduce((n, s) => n + Math.max(0, s.end - s.start), 0);
}

// What an upload adds since the stored journey: shown before saving.
export interface UploadDelta {
  isNew: boolean; // a character the site hasn't seen
  upToDate: boolean;
  fillsGap?: boolean; // sessions from before the last upload, played on another PC
  gapDays?: number[]; // when those sessions were (their starts)
  fromLevel?: number;
  toLevel: number;
  played: number; // seconds in the new sessions
  quests: number;
  distance: number; // yards on foot or mounted
  deaths: number;
}

// The upload's sessions that the stored journey doesn't have: ones that
// don't overlap any stored session (the same session, saved again, overlaps
// itself; a character can't be on two PCs at once).
export function missingSessions(stored: Session[], sessions: Session[]): Session[] {
  return sessions.filter((s) => !stored.some((o) => s.start <= o.end && o.start <= s.end));
}

// Pass the stored journey (`old`) to find sessions from another PC that fall
// before the last upload; without it only what's newer counts.
export function uploadDelta(before: CharacterSummary | undefined, j: Journey, old?: Journey): UploadDelta {
  const since = before?.lastSeenAt ?? -Infinity;
  const last = lastSeen(j);
  const base = {
    isNew: !before,
    fromLevel: before?.level,
    toLevel: j.character.level,
  };
  if (old && before && (last === undefined || last <= since)) {
    const gap = missingSessions(old.sessions, j.sessions).filter((s) => s.end <= since);
    if (gap.length) {
      const inGap = (t: number) => gap.some((s) => t >= s.start && t <= s.end);
      const fresh = j.events.filter((e) => inGap(e.t));
      return {
        ...base,
        upToDate: false,
        fillsGap: true,
        gapDays: gap.map((s) => s.start),
        played: gap.reduce((n, s) => n + Math.max(0, s.end - s.start), 0),
        quests: fresh.filter((e) => e.k === "qd").length,
        distance: Math.round(gap.reduce((n, s) => n + distanceByMode(j.segments, s.start, s.end).w, 0)),
        deaths: fresh.filter((e) => e.k === "die").length,
      };
    }
  }
  const sessions = j.sessions.filter((s) => s.end > since);
  const played = sessions.reduce((n, s) => n + Math.max(0, s.end - Math.max(s.start, since)), 0);
  const fresh = j.events.filter((e) => e.t > since);
  return {
    ...base,
    upToDate: !!before && (last === undefined || last <= since),
    played,
    quests: fresh.filter((e) => e.k === "qd").length,
    distance: Math.round(distanceByMode(j.segments, since).w),
    deaths: fresh.filter((e) => e.k === "die").length,
  };
}
