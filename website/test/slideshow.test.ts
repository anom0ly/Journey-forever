import { describe, expect, it } from "vitest";
import type { Journey } from "../src/lib/journey";
import { buildSlides, startIndex } from "../src/lib/slideshow";

function journey(): Journey {
  return {
    zones: { 1: "Dun Morogh", 2: "Loch Modan" },
    levels: [],
    events: [
      { t: 100, k: "zone", mapID: 1 },
      { t: 110, k: "lvl", level: 6 },
      { t: 150, k: "note", text: "First note" },
      { t: 200, k: "zone", mapID: 2 },
      { t: 210, k: "lvl", level: 13 },
      { t: 260, k: "note", text: "  " },
    ],
  } as unknown as Journey;
}
const shot = (id: string, t: number) => ({ id, t, kind: "level", label: id, url: `/media/${id}` });

describe("slideshow", () => {
  it("orders shots and notes by time with chapter cards on zone changes", () => {
    const s = buildSlides(journey(), [shot("b", 220), shot("a", 120)]);
    expect(s.map((x) => x.k)).toEqual(["chapter", "shot", "note", "chapter", "shot", "end"]);
    expect(s[0]).toMatchObject({ zone: "Dun Morogh", from: 6, to: 6, shots: 1 });
    expect(s[3]).toMatchObject({ zone: "Loch Modan", from: 13, shots: 1 });
    expect(s[5]).toMatchObject({ shots: 2, notes: 1, from: 6, to: 13 });
  });

  it("skips chapters for a zone with only notes, and can leave notes out", () => {
    expect(buildSlides(journey(), [shot("b", 220)]).map((x) => x.k)).toEqual(["note", "chapter", "shot", "end"]);
    expect(buildSlides(journey(), [shot("b", 220)], { notes: false }).map((x) => x.k)).toEqual(["chapter", "shot", "end"]);
  });

  it("keeps only things after a time for Life at 60", () => {
    expect(buildSlides(journey(), [shot("a", 120), shot("b", 220)], { since: 200 }).filter((x) => x.k === "shot")).toHaveLength(1);
  });

  it("is empty with nothing to show", () => {
    expect(buildSlides(journey(), [], { notes: false })).toEqual([]);
  });

  it("starts from a picture, on its chapter card when it opens one", () => {
    const s = buildSlides(journey(), [shot("a", 120), shot("b", 220)]);
    expect(startIndex(s, "b")).toBe(3);
    expect(startIndex(s, "a")).toBe(0);
    expect(startIndex(s, "missing")).toBe(0);
    expect(startIndex(s, null)).toBe(0);
  });
});
