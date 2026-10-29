// The replay's clock. Journeys span weeks of real time with most of it
// offline, so replay time only runs while the path was being recorded:
// gaps (logged out, inside a dungeon, loading screens) shrink to a moment.

import type { Journey, Segment } from "./journey";
import { decodeSegment } from "./path";

export const GAP_SECONDS = 2; // replay time a gap between recorded stretches takes
const JOIN_SECONDS = 120; // stretches closer than this run on without a gap

export interface Track {
  m: string;
  c: number;
  j?: string;
  t: number[];
  x: number[];
  y: number[];
}

export interface Clock {
  start: number[]; // real start time of each stretch
  end: number[];
  at: number[]; // replay time each stretch starts at
  total: number;
}

export function tracksOf(segments: Segment[]): Track[] {
  return [...segments].sort((a, b) => a.t - b.t).map((s) => ({ m: s.m, c: s.c, j: s.j, ...decodeSegment(s) }));
}

export function buildClock(tracks: Track[]): Clock {
  const spans: [number, number][] = [];
  for (const tr of tracks) {
    const a = tr.t[0], b = tr.t[tr.t.length - 1];
    const last = spans.at(-1);
    if (last && a - last[1] <= JOIN_SECONDS) last[1] = Math.max(last[1], b);
    else spans.push([a, b]);
  }
  const clock: Clock = { start: [], end: [], at: [], total: 0 };
  let r = 0;
  for (const [a, b] of spans) {
    clock.start.push(a);
    clock.end.push(b);
    clock.at.push(r);
    r += b - a + GAP_SECONDS;
  }
  clock.total = Math.max(0, r - GAP_SECONDS);
  return clock;
}

// Replay seconds for a real time; times in a gap go to the gap's start.
export function toReplay(clock: Clock, t: number): number {
  const n = clock.start.length;
  if (!n) return 0;
  if (t <= clock.start[0]) return 0;
  let lo = 0, hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (clock.start[mid] <= t) lo = mid;
    else hi = mid - 1;
  }
  return clock.at[lo] + Math.min(t, clock.end[lo]) - clock.start[lo];
}

// Real time for replay seconds.
export function toReal(clock: Clock, r: number): number {
  const n = clock.start.length;
  if (!n) return 0;
  let lo = 0, hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (clock.at[mid] <= r) lo = mid;
    else hi = mid - 1;
  }
  return Math.min(clock.end[lo], clock.start[lo] + (r - clock.at[lo]));
}

export interface Here {
  c: number;
  x: number;
  y: number;
  m: string;
}

// Where the character was at real time t: on the track that covers it,
// between its two nearest points; else at the end of the last track before.
export function whereAt(tracks: Track[], t: number): Here | undefined {
  let best: Here | undefined;
  for (const tr of tracks) {
    if (tr.t[0] > t) break;
    const n = tr.t.length;
    if (tr.t[n - 1] <= t) {
      best = { c: tr.c, x: tr.x[n - 1], y: tr.y[n - 1], m: tr.m };
      continue;
    }
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (tr.t[mid] <= t) lo = mid;
      else hi = mid;
    }
    const span = tr.t[hi] - tr.t[lo] || 1;
    const f = (t - tr.t[lo]) / span;
    return { c: tr.c, x: tr.x[lo] + (tr.x[hi] - tr.x[lo]) * f, y: tr.y[lo] + (tr.y[hi] - tr.y[lo]) * f, m: tr.m };
  }
  return best;
}

export function continentsOf(j: Journey): number[] {
  const size = new Map<number, number>();
  for (const s of j.segments) size.set(s.c, (size.get(s.c) ?? 0) + s.d.length + 1);
  return [...size.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
}
