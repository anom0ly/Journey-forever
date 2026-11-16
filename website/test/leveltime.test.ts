import { describe, expect, it } from "vitest";
import fixture from "./fixtures-two-pc-levels.json";
import type { JEvent, Journey, LevelInfo } from "../src/lib/journey";
import { levelSeconds } from "../src/lib/levelTime";
import { mergeJourneys } from "../src/lib/merge";
import { levelStats } from "../src/lib/stats";
import { boardEntries, integrityChecks } from "../src/lib/boards";

// A real level 60 played on two PCs (Nov 2026). Its stored level times came
// from logins on the PC that didn't ding: level 47 showed 7 minutes.
const levels = fixture.levels as LevelInfo[];
const events = fixture.events as JEvent[];

function journey(lv: LevelInfo[], ev: JEvent[] = events, level = 60): Journey {
  return {
    format: 1,
    character: { key: "Player-1-ABC", guid: "Player-1-ABC", name: "Two", realm: "5", level },
    sources: [],
    events: ev,
    segments: [],
    levels: lv,
    sessions: [],
    stats: {},
    zones: {},
    items: {},
    updatedAt: 0,
  };
}

describe("level times from /played", () => {
  const seconds = levelSeconds({ levels, sessions: [], events, level: 60 });

  it("takes each level from /played at the dings", () => {
    expect(seconds.get(47)).toBe(318845 - 300950);
    expect(seconds.get(55)).toBe(18466);
    expect(seconds.get(13)).toBe(3681);
    expect(seconds.get(20)).toBe(7128);
    expect(seconds.get(1)).toBe(273);
  });

  it("bridges one ding without /played", () => {
    // Level 35's ding has no /played: 36 minus 34, less 35's own time.
    expect(seconds.get(34)).toBe(174036 - 152315 - 11455);
    expect(seconds.get(35)).toBe(11455);
  });

  it("adds up to /played at level 60", () => {
    expect([...seconds.values()].reduce((a, b) => a + b, 0)).toBe(480750);
    expect(seconds.size).toBe(59);
  });

  it("falls back to sessions from the earliest ding", () => {
    const lv: LevelInfo[] = [{ level: 5, t: 1000 }, { level: 6, t: 9000 }];
    const ev: JEvent[] = [{ t: 2000, k: "lvl", level: 6 }];
    const s = levelSeconds({ levels: lv, sessions: [{ start: 0, end: 10000 }], events: ev, level: 7 });
    expect(s.get(5)).toBe(1000);
  });

  it("is what the Levels tab, boards and checks use", () => {
    const j = journey(levels);
    const st = levelStats(j);
    expect(st.rows[46].played).toBe(seconds.get(47));
    expect(st.fastest?.level).toBe(11);
    expect(st.slowest?.level).toBe(51);
    const to60 = boardEntries(j).find((e) => e.b === "to60");
    expect(to60?.v).toBe(480750);
    expect(integrityChecks(j).filter((c) => c.startsWith("Level "))).toEqual([]);
  });
});

describe("merging uploads from two PCs", () => {
  it("keeps the earliest ding and the smallest /played", () => {
    // The PC that didn't ding saw level 47 at a login a day later.
    const late = levels.map((l) => (l.level === 47 ? { ...l, t: (l.t ?? 0) + 86400, played: (l.played ?? 0) + 600, secondsOnLevel: 466 } : l));
    const ding = levels.map((l) => (l.level === 47 ? { ...l, t: 1794447214, secondsOnLevel: undefined } : l));
    const merged = mergeJourneys(journey(ding), journey(late));
    const l47 = merged.levels.find((l) => l.level === 47)!;
    expect(l47.t).toBe(1794447214);
    expect(l47.played).toBe(300950);
    expect(l47.secondsOnLevel).toBe(seconds47());
  });

  it("replaces a stored time counted from a late login", () => {
    const merged = mergeJourneys(journey(levels), journey(levels));
    expect(merged.levels.find((l) => l.level === 55)?.secondsOnLevel).toBe(18466);
    expect(merged.levels.find((l) => l.level === 46)?.secondsOnLevel).toBe(300950 - 288383);
  });
});

function seconds47(): number {
  return levelSeconds({ levels, sessions: [], events, level: 60 }).get(47)!;
}
