// The purple diamonds on the replay maps: each screenshot or /jf note the
// addon logged with a position, paired with its uploaded image when there is
// one. An uploaded screenshot keeps the time of the logged shot it matched,
// so the two pair by time.

import type { JEvent, Journey } from "./journey";
import { levelAt, shotLabel, zoneAt } from "./insights";

export interface PinImage {
  t: number;
  kind: string;
  url: string;
  thumb: string;
}

export interface Pin<S extends PinImage = PinImage> {
  t: number;
  k: "shot" | "note";
  c: number; // continent
  x: number; // world position
  y: number;
  title: string;
  text?: string; // a note's words
  level: number;
  zone?: string;
  image?: S;
  failed?: boolean; // the game couldn't take it
}

export function pinsOf<S extends PinImage>(j: Journey, images: S[]): Pin<S>[] {
  const byT = new Map<number, S[]>();
  for (const s of images) byT.set(s.t, [...(byT.get(s.t) ?? []), s]);
  const used = new Set<S>();
  const out: Pin<S>[] = [];
  for (const e of j.events) {
    if ((e.k !== "shot" && e.k !== "note") || typeof e.c !== "number" || typeof e.x !== "number" || typeof e.y !== "number") continue;
    const pin: Pin<S> = { t: e.t, k: e.k, c: e.c, x: e.x, y: e.y, title: title(j, e), level: levelAt(j, e.t), zone: (e.zone as string | undefined) ?? zoneAt(j, e.t) };
    if (e.k === "note") pin.text = String(e.text ?? "");
    else if (e.failed) pin.failed = true;
    else {
      // Same time: the one of the same kind first.
      const same = (byT.get(e.t) ?? []).filter((s) => !used.has(s));
      const image = same.find((s) => s.kind === String(e.kind ?? "manual")) ?? same[0];
      if (image) {
        used.add(image);
        pin.image = image;
      }
    }
    out.push(pin);
  }
  return out;
}

function title(j: Journey, e: JEvent): string {
  return e.k === "note" ? "Note" : shotLabel(j, e);
}

// The pins drawn so far on continent c, under a point on screen, nearest
// first and then in time order: diamonds on top of each other page together.
export function pinsAt<S extends PinImage>(
  pins: Pin<S>[],
  c: number,
  upTo: number,
  px: number,
  py: number,
  sx: (y: number) => number,
  sy: (x: number) => number,
  radius = 11,
): Pin<S>[] {
  const hits: { p: Pin<S>; d: number }[] = [];
  for (const p of pins) {
    if (p.c !== c || p.t > upTo) continue;
    const d = Math.hypot(sx(p.y) - px, sy(p.x) - py);
    if (d <= radius) hits.push({ p, d });
  }
  if (!hits.length) return [];
  // Everything stacked on the nearest one.
  const near = hits.reduce((a, b) => (b.d < a.d ? b : a)).p;
  return pins
    .filter((p) => p.c === c && p.t <= upTo && Math.hypot(sx(p.y) - sx(near.y), sy(p.x) - sy(near.x)) <= 6)
    .sort((a, b) => a.t - b.t);
}
