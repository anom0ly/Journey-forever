import { describe, expect, it } from "vitest";
import { readUpload } from "../src/lib/parse/upload";
import { pinsAt, pinsOf } from "../src/lib/pins";
import { buildClock, replayAtOrAfter, toReal, tracksOf } from "../src/lib/replay";
import { sampleFiles } from "./samples";

describe("screenshot pins", () => {
  const { journeys } = readUpload(sampleFiles());
  const brannoc = journeys.find((j) => j.character.name === "Brannoc")!;
  const placed = brannoc.events.filter((e) => (e.k === "shot" || e.k === "note") && typeof e.x === "number");

  it("makes a pin for every placed screenshot and note, with its image when uploaded", () => {
    const shot = placed.find((e) => e.k === "shot" && !e.failed)!;
    const image = { t: shot.t, kind: String(shot.kind), url: "/full", thumb: "/thumb" };
    const other = { t: shot.t + 999999, kind: "manual", url: "/x", thumb: "/x" };
    const pins = pinsOf(brannoc, [image, other]);
    expect(pins).toHaveLength(placed.length);
    const p = pins.find((p) => p.t === shot.t && p.k === "shot")!;
    expect(p.image).toBe(image);
    expect(p.title).not.toBe("");
    expect(p.level).toBeGreaterThanOrEqual(1);
    expect(pins.filter((p) => p.image)).toHaveLength(1);
    const note = pins.find((p) => p.k === "note");
    if (note) expect(note.text).toBeTruthy();
  });

  it("finds the diamonds under a point, stacked ones together, and only those drawn so far", () => {
    const pins = pinsOf(brannoc, []);
    const p = pins[0];
    const id = (v: number) => v;
    expect(pinsAt(pins, p.c, Infinity, p.y, p.x, id, id).map((q) => q.t)).toContain(p.t);
    expect(pinsAt(pins, p.c, p.t - 1, p.y, p.x, id, id).map((q) => q.t)).not.toContain(p.t);
    expect(pinsAt(pins, p.c + 1, Infinity, p.y, p.x, id, id)).toHaveLength(0);
    expect(pinsAt(pins, p.c, Infinity, p.y + 40, p.x + 40, id, id).map((q) => q.t)).not.toContain(p.t);
    const twin = { ...p, t: p.t + 5 };
    expect(pinsAt([p, twin], p.c, Infinity, p.y + 2, p.x, id, id)).toHaveLength(2);
  });

  it("jumps to the first replay moment at or after a time, past gaps", () => {
    const clock = buildClock(tracksOf(brannoc.segments));
    for (const t of [clock.start[0] + 10, clock.end[0] + 5]) {
      const r = replayAtOrAfter(clock, t);
      if (r < clock.total) expect(toReal(clock, r)).toBeGreaterThanOrEqual(t);
    }
  });
});
