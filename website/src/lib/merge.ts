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
} from "./journey";
import { distanceByMode, PathIndex } from "./path";
import type { Contribution } from "./parse/types";
import { ZONE_NAMES } from "./wow";

const ADDONS: AddonId[] = ["rts", "jt", "jf"];

// Journey Tracker times its deaths by the PC's clock and Road to Sixty by
// the realm's, so the same death can be this far apart.
const DEATH_MATCH_SECONDS = 180;

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
    Object.assign(e, strip({ killer: d.killer, zone: d.zone, subzone: d.subzone, dungeon: d.dungeon, level: d.level, grouped: d.grouped }));
  }
  for (const d of pool) {
    events.push(strip({ t: d.t, k: "die", killer: d.killer, zone: d.zone, subzone: d.subzone, dungeon: d.dungeon, level: d.level, grouped: d.grouped }));
  }
}

function strip<T extends object>(o: T): T {
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined) delete o[k];
  return o;
}

// Events with no world position (screenshots, notes, Journey Tracker's
// deaths) are put where the path was at that moment, or inside an instance,
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
    zones,
    items: { ...rts?.items, ...jf?.items },
    updatedAt: now,
  };
}

function eventKey(e: JEvent): string {
  const extra = e.questID ?? e.level ?? e.mapID ?? e.instanceID ?? (e.item as { id?: number } | undefined)?.id ?? e.name ?? e.text ?? e.kind ?? e.slot ?? "";
  return `${e.t}|${e.k}|${String(extra)}`;
}

// Folds a newly uploaded journey into the stored one. Saved files are
// cumulative, so the new one usually holds everything; the union keeps what
// a wiped or reset file no longer has (the beta's files were deleted once).
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

  const kills = !old.kills || (next.kills && next.kills.d.length >= old.kills.d.length) ? next.kills : old.kills;
  const stats = (next.stats.played ?? 0) >= (old.stats.played ?? 0) ? next.stats : old.stats;

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
    zones: { ...old.zones, ...next.zones },
    items: { ...old.items, ...next.items },
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
  fromLevel?: number;
  toLevel: number;
  played: number; // seconds in the new sessions
  quests: number;
  distance: number; // yards on foot or mounted
  deaths: number;
}

export function uploadDelta(before: CharacterSummary | undefined, j: Journey): UploadDelta {
  const since = before?.lastSeenAt ?? -Infinity;
  const sessions = j.sessions.filter((s) => s.end > since);
  const played = sessions.reduce((n, s) => n + Math.max(0, s.end - Math.max(s.start, since)), 0);
  const fresh = j.events.filter((e) => e.t > since);
  const last = lastSeen(j);
  return {
    isNew: !before,
    upToDate: !!before && (last === undefined || last <= since),
    fromLevel: before?.level,
    toLevel: j.character.level,
    played,
    quests: fresh.filter((e) => e.k === "qd").length,
    distance: Math.round(distanceByMode(j.segments, since).w),
    deaths: fresh.filter((e) => e.k === "die").length,
  };
}
