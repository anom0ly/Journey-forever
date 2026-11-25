import { levelAt, zoneAt } from "./insights";
import type { Journey } from "./journey";

// The slides of a screenshot slideshow: every screenshot and /jf note in the
// order they happened, with a chapter card each time the zone changes.

export interface ShotLike {
  id: string;
  t: number;
  kind: string;
  label: string | null;
  url: string;
}

export type Slide =
  | { k: "shot"; t: number; shot: ShotLike; zone?: string; level: number }
  | { k: "note"; t: number; text: string; zone?: string; level: number }
  | { k: "chapter"; zone: string; from: number; to: number; shots: number }
  | { k: "end"; shots: number; notes: number; from: number; to: number };

export interface SlideOptions {
  notes?: boolean;
  chapters?: boolean;
  since?: number; // only things at or after this time (Life at 60)
}

export function buildSlides(j: Journey, shots: ShotLike[], opts: SlideOptions = {}): Slide[] {
  const since = opts.since ?? -Infinity;
  const body: Exclude<Slide, { k: "chapter" | "end" }>[] = [
    ...shots.filter((s) => s.t >= since).map((s) => ({ k: "shot" as const, t: s.t, shot: s, zone: zoneAt(j, s.t), level: levelAt(j, s.t) })),
    ...(opts.notes === false
      ? []
      : j.events
          .filter((e) => e.k === "note" && e.t >= since && typeof e.text === "string" && e.text.trim())
          .map((e) => ({ k: "note" as const, t: e.t, text: String(e.text), zone: typeof e.zone === "string" ? e.zone : zoneAt(j, e.t), level: levelAt(j, e.t) }))),
  ].sort((a, b) => a.t - b.t);

  const out: Slide[] = [];
  let zone: string | undefined;
  for (let i = 0; i < body.length; i++) {
    const s = body[i];
    if (opts.chapters !== false && s.zone && s.zone !== zone) {
      let end = i;
      while (end + 1 < body.length && body[end + 1].zone === s.zone) end++;
      const run = body.slice(i, end + 1);
      // A chapter needs at least one screenshot in it; a lone note doesn't earn a card.
      const n = run.filter((x) => x.k === "shot").length;
      if (n) out.push({ k: "chapter", zone: s.zone, from: run[0].level, to: run[run.length - 1].level, shots: n });
    }
    if (s.zone) zone = s.zone;
    out.push(s);
  }
  if (body.length) {
    out.push({
      k: "end",
      shots: body.filter((x) => x.k === "shot").length,
      notes: body.filter((x) => x.k === "note").length,
      from: body[0].level,
      to: body[body.length - 1].level,
    });
  }
  return out;
}

// Where to start when playing "from here": the slide for that screenshot, or the
// chapter card just before it when there is one.
export function startIndex(slides: Slide[], shotId?: string | null): number {
  if (!shotId) return 0;
  const i = slides.findIndex((s) => s.k === "shot" && s.shot.id === shotId);
  if (i < 0) return 0;
  return i > 0 && slides[i - 1].k === "chapter" ? i - 1 : i;
}
