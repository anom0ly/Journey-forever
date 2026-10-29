import type { Segment } from "./journey";

export interface Points {
  t: number[];
  x: number[];
  y: number[];
}

// A segment's points as three lists (absolute times and world yards).
export function decodeSegment(seg: Segment): Points {
  let t = seg.t, x = seg.x, y = seg.y;
  const ts = [t], xs = [x], ys = [y];
  const d = seg.d;
  let i = 0;
  const n = d.length;
  // Hand-rolled "dt,dx,dy;" reader: paths reach hundreds of thousands of steps.
  while (i < n) {
    const vals = [0, 0, 0];
    for (let f = 0; f < 3; f++) {
      let neg = false;
      if (d.charCodeAt(i) === 45) {
        neg = true;
        i++;
      }
      let v = 0;
      let c = d.charCodeAt(i);
      while (c >= 48 && c <= 57) {
        v = v * 10 + (c - 48);
        c = d.charCodeAt(++i);
      }
      vals[f] = neg ? -v : v;
      i++; // the "," or ";"
    }
    t += vals[0];
    x += vals[1];
    y += vals[2];
    ts.push(t);
    xs.push(x);
    ys.push(y);
  }
  return { t: ts, x: xs, y: ys };
}

export function segmentLength(p: Points): number {
  let total = 0;
  for (let i = 1; i < p.x.length; i++) total += Math.hypot(p.x[i] - p.x[i - 1], p.y[i] - p.y[i - 1]);
  return total;
}

// Yards travelled by mode: w on foot or mounted, t flight path, g ghost.
export function distanceByMode(segments: Segment[], from = -Infinity, to = Infinity): Record<string, number> {
  const out: Record<string, number> = { w: 0, t: 0, g: 0 };
  for (const seg of segments) {
    const p = decodeSegment(seg);
    if (p.t[p.t.length - 1] < from || p.t[0] > to) continue;
    let total = 0;
    for (let i = 1; i < p.x.length; i++) {
      if (p.t[i] < from || p.t[i] > to) continue;
      total += Math.hypot(p.x[i] - p.x[i - 1], p.y[i] - p.y[i - 1]);
    }
    out[seg.m] = (out[seg.m] ?? 0) + total;
  }
  return out;
}

export interface Placed {
  c: number;
  x: number;
  y: number;
}

// Every path point in time order, for finding where the path was at a
// given moment. Built once per journey: decoding is the costly part.
export class PathIndex {
  readonly t: number[] = [];
  readonly x: number[] = [];
  readonly y: number[] = [];
  readonly c: number[] = [];

  constructor(segments: Segment[]) {
    for (const seg of [...segments].sort((a, b) => a.t - b.t)) {
      const p = decodeSegment(seg);
      for (let i = 0; i < p.t.length; i++) {
        this.t.push(p.t[i]);
        this.x.push(p.x[i]);
        this.y.push(p.y[i]);
        this.c.push(seg.c);
      }
    }
  }

  // Index of the last point at or before t, or -1.
  indexAt(t: number): number {
    let lo = 0, hi = this.t.length - 1, at = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.t[mid] <= t) {
        at = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return at;
  }

  // Where the path was at time t: the nearest point in time, within maxGap
  // seconds.
  at(t: number, maxGap = 900): Placed | undefined {
    const i = this.indexAt(t);
    let best = -1;
    let gap = Infinity;
    for (const j of [i, i + 1]) {
      if (j < 0 || j >= this.t.length) continue;
      const g = Math.abs(this.t[j] - t);
      if (g < gap) {
        gap = g;
        best = j;
      }
    }
    if (best < 0 || gap > maxGap) return undefined;
    return { c: this.c[best], x: this.x[best], y: this.y[best] };
  }
}

export const YARDS_PER_KM = 1093.6133;

export function km(yards: number): string {
  const v = yards / YARDS_PER_KM;
  return v >= 100 ? v.toFixed(0) : v.toFixed(1);
}
