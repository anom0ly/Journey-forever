import { describe, expect, it } from "vitest";
import fixture from "./fixtures-two-pc-levels.json";
import type { JEvent, Journey, LevelInfo } from "../src/lib/journey";
import { cutAtLevel, levelingTime } from "../src/lib/compare";
import { levelStats } from "../src/lib/stats";

const levels = fixture.levels as LevelInfo[];
const events = fixture.events as JEvent[];

function journey(lv: LevelInfo[], level: number, played?: number): Journey {
  return {
    format: 1,
    character: { key: "Player-1-ABC", guid: "Player-1-ABC", name: "Two", realm: "5", level },
    sources: [],
    events: events.filter((e) => e.k !== "lvl" || Number(e.level ?? 0) <= level),
    segments: [],
    levels: lv.filter((l) => l.level <= level),
    sessions: [],
    stats: { played },
    zones: {},
    items: {},
    updatedAt: 0,
  };
}

describe("time spent leveling on the compare page", () => {
  it("adds up every finished level, matching /played at 60", () => {
    const t = levelingTime(journey(levels, 60));
    expect(t.seconds).toBe(480750);
    expect(t.missing).toBe(0);
    expect(t.level).toBe(60);
  });

  it("matches the Levels table rows", () => {
    const j = journey(levels, 60);
    const sum = levelStats(j).rows.filter((r) => r.level < 40).reduce((n, r) => n + (r.played ?? 0), 0);
    expect(levelingTime(j, 40).seconds).toBe(sum);
    expect(levelingTime(j, 40).into).toBeUndefined();
  });

  it("gives the time into the unfinished level from /played", () => {
    const at47 = levels.find((l) => l.level === 47)!.played!;
    const t = levelingTime(journey(levels, 47, at47 + 3900));
    expect(t.into).toBe(3900);
    expect(t.seconds).toBe(levelingTime(journey(levels, 60), 47).seconds);
  });

  it("agrees with the cut journey of Up to level N", () => {
    const j = journey(levels, 60);
    expect(levelingTime(cutAtLevel(j, 37)).seconds).toBe(levelingTime(j, 37).seconds);
  });
});
