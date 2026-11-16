// Played time spent on each level.
//
// The game's own /played, saved at every ding, is the most trustworthy
// clock: when a character is played on two PCs, the PC that didn't ding
// only sees the new level at its next login, so a level's "reached" time
// (and anything counted from it) can be hours late, but /played at the
// ding is the same whichever PC saved it.

import type { JEvent, LevelInfo, Session } from "./journey";

export interface LevelTimeInput {
  levels: LevelInfo[];
  sessions: Session[];
  events?: JEvent[];
  level: number; // the character's current level (not finished)
  start?: number; // when the journey began, for level 1 from sessions
}

// The earliest time each level was reached, from the level-up events and
// the level snapshots.
export function earliestLevelTimes(levels: LevelInfo[], events: JEvent[] = []): Map<number, number> {
  const out = new Map<number, number>();
  for (const e of events) {
    if (e.k === "lvl" && typeof e.level === "number") out.set(e.level, Math.min(e.t, out.get(e.level) ?? Infinity));
  }
  for (const l of levels) if (l.t !== undefined) out.set(l.level, Math.min(l.t, out.get(l.level) ?? Infinity));
  return out;
}

// Seconds of played time on each finished level, in order of trust:
// 1. /played at the next ding minus /played at this one (level 1 starts at 0);
// 2. Journey Tracker's own played time for the level;
// 3. one missing ding bridged: /played two dings on, less the next level's own time;
// 4. played sessions between the earliest times the two levels were reached.
export function levelSeconds(j: LevelTimeInput): Map<number, number> {
  const by = new Map(j.levels.map((l) => [l.level, l]));
  const playedAt = (level: number) => (level === 1 ? 0 : by.get(level)?.played);
  const times = earliestLevelTimes(j.levels, j.events);
  const out = new Map<number, number>();
  for (let level = 1; level < j.level; level++) {
    const a = playedAt(level), b = playedAt(level + 1);
    // A level's played time is at least a second; anything else is a mix-up.
    if (a !== undefined && b !== undefined && b > a) {
      out.set(level, b - a);
      continue;
    }
    const own = by.get(level)?.secondsOnLevel;
    if (own !== undefined && own > 0) {
      out.set(level, own);
      continue;
    }
    const c = playedAt(level + 2), next = by.get(level + 1)?.secondsOnLevel;
    if (a !== undefined && c !== undefined && next !== undefined && level + 1 < j.level && c - a - next > 0) {
      out.set(level, c - a - next);
      continue;
    }
    const from = times.get(level) ?? (level === 1 ? j.start : undefined), to = times.get(level + 1);
    if (from === undefined || to === undefined || !j.sessions.length) continue;
    let total = 0;
    for (const s of j.sessions) total += Math.max(0, Math.min(s.end, to) - Math.max(s.start, from));
    if (total > 0) out.set(level, total);
  }
  return out;
}
