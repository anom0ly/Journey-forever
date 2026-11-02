// Played time for the compare replay: two characters lined up on one clock,
// either by time played or by level. Like compare.ts, no browser calls, so
// it is tested offline.
//
// Played time runs only while logged in, from the sessions. Road to Sixty's
// /played at each ding is the game's own count, so where the two disagree
// the clock bends to meet /played at every ding.

import type { Journey, Session } from "./journey";
import { buildClock, tracksOf } from "./replay";
import { levelTimes } from "./stats";

export interface PlayClock {
  start: number[]; // logged-in stretches, real times, in order, not overlapping
  end: number[];
  cum: number[]; // session seconds before each stretch
  base: number[]; // anchors: session seconds at a ding ...
  off: number[]; // ... and how far /played was ahead of the sessions there
  total: number; // played seconds at the end of the record
  first: number; // played seconds when the record starts (0 unless /played says otherwise)
}

function stretches(j: Journey): [number, number][] {
  let src: [number, number][] = j.sessions.map((s: Session) => [s.start, s.end]);
  if (!src.length) {
    // No sessions: the recorded path's own stretches stand in.
    const c = buildClock(tracksOf(j.segments));
    src = c.start.map((s, i) => [s, c.end[i]]);
  }
  src = src.filter(([a, b]) => b > a).sort((p, q) => p[0] - q[0]);
  const out: [number, number][] = [];
  for (const [a, b] of src) {
    const last = out.at(-1);
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

function sessionSecs(c: Pick<PlayClock, "start" | "end" | "cum">, t: number): number {
  const n = c.start.length;
  if (!n || t <= c.start[0]) return 0;
  let lo = 0, hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (c.start[mid] <= t) lo = mid;
    else hi = mid - 1;
  }
  return c.cum[lo] + Math.min(t, c.end[lo]) - c.start[lo];
}

// How far /played is ahead of the sessions at `b` session seconds.
function offsetAt(c: Pick<PlayClock, "base" | "off">, b: number): number {
  const n = c.base.length;
  if (!n) return 0;
  if (b <= c.base[0]) return c.off[0];
  if (b >= c.base[n - 1]) return c.off[n - 1];
  let i = 1;
  while (c.base[i] < b) i++;
  const f = (b - c.base[i - 1]) / (c.base[i] - c.base[i - 1]);
  return c.off[i - 1] + (c.off[i] - c.off[i - 1]) * f;
}

export function playClock(j: Journey): PlayClock {
  const spans = stretches(j);
  const c: PlayClock = { start: [], end: [], cum: [], base: [], off: [], total: 0, first: 0 };
  let sum = 0;
  for (const [a, b] of spans) {
    c.start.push(a);
    c.end.push(b);
    c.cum.push(sum);
    sum += b - a;
  }
  const times = levelTimes(j);
  let lastPlayed = -Infinity, lastBase = -Infinity;
  for (const l of [...j.levels].sort((p, q) => p.level - q.level)) {
    const t = l.t ?? times.get(l.level);
    if (l.played === undefined || t === undefined) continue;
    const b = sessionSecs(c, t);
    // Keep the clock running forwards: skip anchors that would turn it back.
    if (b <= lastBase || l.played < lastPlayed) continue;
    c.base.push(b);
    c.off.push(l.played - b);
    lastBase = b;
    lastPlayed = l.played;
  }
  c.first = Math.max(0, offsetAt(c, 0));
  c.total = sum + offsetAt(c, sum);
  return c;
}

// Played seconds at real time t.
export function playedAt(c: PlayClock, t: number): number {
  const b = sessionSecs(c, t);
  return b + offsetAt(c, b);
}

// The real time the character reached `p` played seconds: the moment it
// passed it, so a time between sessions goes to the end of the earlier one.
export function realAt(c: PlayClock, p: number): number {
  const n = c.start.length;
  if (!n) return 0;
  // Session seconds for p: played rises with them, so halve the range.
  let lo = 0, hi = c.cum[n - 1] + c.end[n - 1] - c.start[n - 1];
  if (p <= lo + offsetAt(c, lo)) return c.start[0];
  if (p >= hi + offsetAt(c, hi)) return c.end[n - 1];
  for (let k = 0; k < 48; k++) {
    const mid = (lo + hi) / 2;
    if (mid + offsetAt(c, mid) < p) lo = mid;
    else hi = mid;
  }
  // Session seconds back to real time.
  let i = n - 1;
  while (i > 0 && c.cum[i] > hi) i--;
  return c.start[i] + (hi - c.cum[i]);
}

// ---------------------------------------------------------------- levels

// Played seconds at each ding, from level 1 at the start of the record.
export interface LevelCurve {
  played: number[]; // played seconds ...
  level: number[]; // ... at which this level was reached
  top: number; // the level the character is on now
}

export function levelCurve(j: Journey, c: PlayClock): LevelCurve {
  const times = levelTimes(j);
  const out: LevelCurve = { played: [c.first], level: [1], top: Math.max(1, j.character.level) };
  for (const [level, t] of [...times.entries()].sort((p, q) => p[0] - q[0])) {
    if (level < 2) continue;
    const snap = j.levels.find((l) => l.level === level)?.played;
    const p = snap ?? playedAt(c, t);
    if (p < out.played.at(-1)!) continue;
    out.played.push(p);
    out.level.push(level);
  }
  out.top = Math.max(out.top, out.level.at(-1)!);
  return out;
}

// Level at `p` played seconds, as a fraction (5.5: halfway through level 5
// by played time). Past the last ding it stays on that level: how far
// through it the character is isn't known.
export function levelAtPlayed(curve: LevelCurve, p: number): number {
  const { played, level } = curve;
  if (p <= played[0]) return level[0];
  for (let i = 1; i < played.length; i++) {
    if (p < played[i]) {
      const span = played[i] - played[i - 1];
      const f = span > 0 ? (p - played[i - 1]) / span : 0;
      // Dings more than one level apart (a gap in the record): step through evenly.
      return level[i - 1] + (level[i] - level[i - 1]) * f;
    }
  }
  return level.at(-1)!;
}

// Whether the level at `p` played seconds is between two known dings, so a
// fraction through it means something.
export function levelKnownAt(curve: LevelCurve, p: number): boolean {
  return p < curve.played.at(-1)!;
}

// Played seconds when the character was `l` of the way through the levels
// (5.5: halfway through level 5). Undefined past the last ding.
export function playedAtLevel(curve: LevelCurve, l: number): number | undefined {
  const { played, level } = curve;
  if (l <= level[0]) return played[0];
  for (let i = 1; i < level.length; i++) {
    if (l <= level[i]) {
      const f = (l - level[i - 1]) / (level[i] - level[i - 1]);
      return played[i - 1] + (played[i] - played[i - 1]) * f;
    }
  }
  return undefined;
}
