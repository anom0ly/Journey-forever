// The numbers behind the compare page: two journeys side by side. By default
// both are cut off where each reached the lower character's level, so a
// level 11 isn't measured against a level 8 on raw totals. Like stats.ts,
// no browser calls, so it is tested offline.

import type { Journey, LevelInfo, Segment } from "./journey";
import { dungeonRuns, killCount, played } from "./insights";
import { deathCount, questCount } from "./merge";
import type { KillStats } from "./kills";
import { distanceByMode } from "./path";
import { deathStats, goldStats, journeyStart, levelStats, levelTimes, playedBetween } from "./stats";

// ---------------------------------------------------------------- cutting

// The packed "dt,..;" steps up to and including time `at`: steps are deltas,
// so this is a prefix of the string. `t` is the time before the first step.
// The last step may have no ";" after it.
function cutSteps(d: string, t: number, at: number): string {
  const steps = d.split(";");
  let keep = 0;
  for (const step of steps) {
    if (!step) break;
    t += parseInt(step, 10);
    if (t > at) break;
    keep++;
  }
  return keep ? steps.slice(0, keep).join(";") + ";" : "";
}

function cutSegment(seg: Segment, at: number): Segment | undefined {
  if (seg.t > at) return undefined;
  return { ...seg, d: cutSteps(seg.d, seg.t, at) };
}

// The journey as it stood the moment the character reached `level`. Journey
// Tracker's running totals (gold by category, loot counts and the like) can't
// be cut by time, so they are left out; the level snapshot's own totals stand
// in where the compare page needs them.
export function cutAtLevel(j: Journey, level: number): Journey {
  if (level >= j.character.level) return j;
  const at = levelTimes(j).get(level);
  if (at === undefined) return j;
  const snap = j.levels.find((l) => l.level === level);
  const start = journeyStart(j) ?? at;
  const sessions = j.sessions
    .filter((s) => s.start <= at)
    .map((s) => (s.end > at ? { ...s, end: at, endLevel: level } : s));
  return {
    ...j,
    character: { ...j.character, level },
    events: j.events.filter((e) => e.t <= at),
    segments: j.segments.map((s) => cutSegment(s, at)).filter((s): s is Segment => !!s),
    kills: j.kills ? { ...j.kills, d: cutSteps(j.kills.d, 0, at) } : undefined,
    levels: j.levels.filter((l) => l.level <= level),
    sessions,
    stats: {
      played: snap?.played ?? playedBetween(sessions, start, at),
      deaths: j.stats.deaths?.filter((d) => d.t <= at),
      runs: j.stats.runs?.filter((r) => r.start <= at),
      firstSeen: j.stats.firstSeen,
    },
  };
}

// The level both are compared up to: the lower of the two, when they differ
// and the lower one has gone past level 1.
export function sharedLevel(a: Journey, b: Journey): number | undefined {
  const low = Math.min(a.character.level, b.character.level);
  if (a.character.level === b.character.level || low < 2) return undefined;
  return low;
}

// ---------------------------------------------------------------- head to head

export interface H2HRow {
  label: string;
  sub?: string;
  a?: number;
  b?: number;
  better: "low" | "high" | "none"; // which way wins
  kind: "time" | "count" | "gold" | "km" | "pct" | "level";
}

const snapAt = (j: Journey, level: number): LevelInfo | undefined => j.levels.find((l) => l.level === level);

// The rows of the Overview, from journeys already cut (or not) by the caller.
// `level` is the shared level when cut.
export function headToHead(a: Journey, b: Journey, level?: number): H2HRow[] {
  const side = (j: Journey) => {
    const snap = level ? snapAt(j, level) : undefined;
    const g = goldStats(j);
    return {
      level: j.character.level,
      played: played(j),
      deaths: deathCount(j),
      // The timeline's counts come first: a level snapshot's totals count only
      // what the PC that saved it saw, which is short when two PCs were used.
      quests: questCount(j) || snap?.quests,
      questShare: levelStats(j).questShare,
      kills: killCount(j) ?? snap?.kills,
      money: level ? snap?.money ?? g.now?.money : g.now?.money,
      distance: distanceByMode(j.segments).w || snap?.distance || j.stats.travel?.ground || undefined,
      dungeons: dungeonRuns(j).filter((r) => r.cleared).length,
    };
  };
  const x = side(a), y = side(b);
  const rows: H2HRow[] = [];
  if (!level) rows.push({ label: "Level", a: x.level, b: y.level, better: "high", kind: "level" });
  rows.push(
    level
      ? { label: `Time to level ${level}`, sub: "played", a: x.played, b: y.played, better: "low", kind: "time" }
      : { label: "Played", a: x.played, b: y.played, better: "none", kind: "time" },
    { label: "Deaths", sub: level ? `before level ${level}` : undefined, a: x.deaths, b: y.deaths, better: "low", kind: "count" },
    { label: "Quests done", a: x.quests, b: y.quests, better: "high", kind: "count" },
    { label: "XP from quests", a: x.questShare, b: y.questShare, better: "none", kind: "pct" },
    { label: "Mobs killed", a: x.kills, b: y.kills, better: "none", kind: "count" },
    { label: level ? `Gold at level ${level}` : "Gold now", a: x.money, b: y.money, better: "high", kind: "gold" },
    { label: "Distance", sub: "on foot and mounted", a: x.distance, b: y.distance, better: "none", kind: "km" },
    { label: "Dungeons cleared", a: x.dungeons, b: y.dungeons, better: "none", kind: "count" },
  );
  return rows;
}

// Which side a row favours: "a", "b", or undefined for a tie, a missing
// value, or a row where more isn't better or worse.
export function winner(r: H2HRow): "a" | "b" | undefined {
  if (r.better === "none" || r.a === undefined || r.b === undefined || r.a === r.b) return undefined;
  return (r.better === "low" ? r.a < r.b : r.a > r.b) ? "a" : "b";
}

// ---------------------------------------------------------------- the race

// Played hours (x) against level (y): one point at each ding, then where the
// character is now.
export function levelRace(j: Journey): [number, number][] {
  const start = journeyStart(j);
  const times = levelTimes(j);
  const pts: [number, number][] = [[0, 1]];
  for (const [level, t] of [...times.entries()].sort((p, q) => p[0] - q[0])) {
    if (level < 2) continue;
    const secs = j.levels.find((l) => l.level === level)?.played ?? (start !== undefined ? playedBetween(j.sessions, start, t) : undefined);
    if (secs !== undefined) pts.push([secs / 3600, level]);
  }
  const total = played(j);
  const last = pts.at(-1)!;
  if (total !== undefined && total / 3600 > last[0] && last[1] === j.character.level) pts.push([total / 3600, j.character.level]);
  return pts;
}

// ---------------------------------------------------------------- route

export interface RouteSpan {
  zone?: string; // undefined when not known
  from: number; // first level
  to: number; // last level, inclusive
}

// Where each level was mostly played, with neighbouring levels in the same
// zone run together.
export function routeByLevel(j: Journey): RouteSpan[] {
  const out: RouteSpan[] = [];
  for (const r of levelStats(j).rows) {
    const last = out.at(-1);
    if (last && last.zone === r.zone) last.to = r.level;
    else out.push({ zone: r.zone, from: r.level, to: r.level });
  }
  return out;
}

export function routeFacts(j: Journey) {
  const zones = new Set(levelStats(j).rows.map((r) => r.zone).filter(Boolean));
  for (const e of j.events) if (e.k === "zone" && typeof e.mapID === "number" && j.zones[e.mapID]) zones.add(j.zones[e.mapID]);
  const runs = dungeonRuns(j);
  const first = runs[0];
  const levels = levelTimes(j);
  let firstLevel: number | undefined;
  if (first) for (const [l, t] of levels) if (t <= first.t && (!firstLevel || l > firstLevel)) firstLevel = l;
  return {
    zones: zones.size,
    firstDungeon: first ? { name: first.name, level: firstLevel ?? 1 } : undefined,
    flights: j.segments.filter((s) => s.m === "t").length,
  };
}

// ---------------------------------------------------------------- deaths

export function deathsByLevel(j: Journey, max: number): number[] {
  const out = new Array<number>(max).fill(0);
  for (const r of deathStats(j).byLevel) if (r.level >= 1 && r.level <= max) out[r.level - 1] += r.world + r.instance;
  return out;
}

// ---------------------------------------------------------------- kills

// The Kills tab's head-to-head rows. Rows neither character has are left out.
export function killsHeadToHead(a: KillStats, b: KillStats, level?: number): H2HRow[] {
  const rows: H2HRow[] = [
    { label: "Kills", sub: level ? `up to level ${level}` : undefined, a: a.total, b: b.total, better: "high", kind: "count" },
    { label: "Kills per hour", sub: "played", a: a.perHour, b: b.perHour, better: "high", kind: "count" },
    { label: "Different creatures", a: a.different, b: b.different, better: "high", kind: "count" },
    { label: "Busiest hour", sub: "kills", a: a.busiest?.count, b: b.busiest?.count, better: "high", kind: "count" },
    { label: "Elites killed", a: a.elites, b: b.elites, better: "high", kind: "count" },
    { label: "Rares killed", a: a.rares, b: b.rares, better: "high", kind: "count" },
  ];
  return rows.filter((r) => r.a !== undefined || r.b !== undefined);
}

export function killsByLevel(k: KillStats, max: number): number[] {
  return Array.from({ length: max }, (_, i) => k.byLevel[i] ?? 0);
}
