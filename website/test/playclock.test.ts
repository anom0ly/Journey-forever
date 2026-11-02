import { describe, expect, it } from "vitest";
import type { Journey } from "../src/lib/journey";
import { emptyJourney } from "../src/lib/journey";
import { levelAtPlayed, levelCurve, levelKnownAt, playClock, playedAt, playedAtLevel, realAt } from "../src/lib/playclock";
import { readUpload } from "../src/lib/parse/upload";
import { levelTimes } from "../src/lib/stats";
import { sampleFiles } from "./samples";

const { journeys } = readUpload(sampleFiles(), 1800000000);
const brannoc = journeys.find((j) => j.character.name === "Brannoc")!;
const lyssira = journeys.find((j) => j.character.name === "Lyssira")!;

function made(sessions: [number, number][], levels: { level: number; t: number; played?: number }[] = []): Journey {
  const j = emptyJourney({ key: "k", name: "Test", realm: "R", level: Math.max(1, ...levels.map((l) => l.level)) });
  j.sessions = sessions.map(([start, end]) => ({ start, end }));
  j.levels = levels;
  return j;
}

describe("the played-time clock", () => {
  it("counts only logged-in time", () => {
    const c = playClock(made([[1000, 2000], [5000, 5600]]));
    expect(c.total).toBe(1600);
    expect(playedAt(c, 1500)).toBe(500);
    expect(playedAt(c, 3000)).toBe(1000); // logged out: the clock stands still
    expect(playedAt(c, 5100)).toBe(1100);
  });

  it("goes back from played time to the real moment", () => {
    const c = playClock(made([[1000, 2000], [5000, 5600]]));
    expect(realAt(c, 500)).toBeCloseTo(1500, 3);
    expect(realAt(c, 1100)).toBeCloseTo(5100, 3);
    expect(realAt(c, 0)).toBe(1000);
    expect(realAt(c, 99999)).toBe(5600);
  });

  it("bends to meet /played at each ding", () => {
    // The sessions say 1000s at the ding, the game says 1200s.
    const c = playClock(made([[0, 3000]], [{ level: 2, t: 1000, played: 1200 }]));
    expect(playedAt(c, 1000)).toBe(1200);
    expect(realAt(c, 1200)).toBeCloseTo(1000, 3);
    expect(c.first).toBe(200);
  });

  it("joins overlapping sessions", () => {
    const c = playClock(made([[0, 1000], [500, 1500]]));
    expect(c.total).toBe(1500);
  });

  it("agrees with the sample's /played at its dings", () => {
    const c = playClock(brannoc);
    const times = levelTimes(brannoc);
    for (const l of brannoc.levels) {
      if (l.played === undefined) continue;
      expect(playedAt(c, l.t ?? times.get(l.level)!)).toBeCloseTo(l.played, 0);
    }
  });

  it("runs on the path when there are no sessions", () => {
    const j = { ...lyssira, sessions: [] };
    const c = playClock(j);
    expect(c.total).toBeGreaterThan(0);
  });
});

describe("lining up by level", () => {
  const j = made([[0, 10000]], [
    { level: 2, t: 1000 },
    { level: 3, t: 3000 },
  ]);
  const c = playClock(j);
  const curve = levelCurve(j, c);

  it("places the dings on the played clock", () => {
    expect(curve.level).toEqual([1, 2, 3]);
    expect(curve.played).toEqual([0, 1000, 3000]);
  });

  it("moves through a level by played time", () => {
    expect(levelAtPlayed(curve, 2000)).toBe(2.5);
    expect(playedAtLevel(curve, 2.5)).toBe(2000);
    expect(levelAtPlayed(curve, 9000)).toBe(3); // past the last ding
    expect(levelKnownAt(curve, 2000)).toBe(true);
    expect(levelKnownAt(curve, 9000)).toBe(false);
    expect(playedAtLevel(curve, 3.5)).toBeUndefined();
  });

  it("has every ding for both samples", () => {
    for (const s of [brannoc, lyssira]) {
      const cv = levelCurve(s, playClock(s));
      expect(cv.level.at(-1)).toBe(s.character.level);
      for (let i = 1; i < cv.played.length; i++) expect(cv.played[i]).toBeGreaterThanOrEqual(cv.played[i - 1]);
    }
  });
});
