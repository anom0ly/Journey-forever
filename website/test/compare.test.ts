import { describe, expect, it } from "vitest";
import { cutAtLevel, deathsByLevel, headToHead, levelRace, routeByLevel, sharedLevel, winner } from "../src/lib/compare";
import { searchPattern, slugFromLink } from "../src/lib/search";
import { readUpload } from "../src/lib/parse/upload";
import { distanceByMode } from "../src/lib/path";
import { deathStats, levelStats, levelTimes } from "../src/lib/stats";
import { sampleFiles } from "./samples";

const { journeys } = readUpload(sampleFiles(), 1800000000);
const brannoc = journeys.find((j) => j.character.name === "Brannoc")!;
const lyssira = journeys.find((j) => j.character.name === "Lyssira")!;

describe("cutting a journey at a level", () => {
  const level = 5;
  const at = levelTimes(brannoc).get(level)!;
  const cut = cutAtLevel(brannoc, level);

  it("keeps only what happened up to the ding", () => {
    expect(brannoc.character.level).toBeGreaterThan(level);
    expect(cut.character.level).toBe(level);
    expect(cut.events.every((e) => e.t <= at)).toBe(true);
    expect(cut.events.length).toBeLessThan(brannoc.events.length);
    expect(cut.levels.every((l) => l.level <= level)).toBe(true);
    expect(cut.sessions.every((s) => s.end <= at)).toBe(true);
  });

  it("cuts the packed path and kills at the same moment", () => {
    const walked = distanceByMode(cut.segments).w;
    expect(walked).toBeGreaterThan(0);
    expect(walked).toBeCloseTo(distanceByMode(brannoc.segments, -Infinity, at).w, 0);
    if (brannoc.kills?.d) {
      let t = 0;
      for (const m of cut.kills!.d.matchAll(/(-?\d+),(\d+),(\d+);/g)) t += Number(m[1]);
      expect(t).toBeLessThanOrEqual(at);
      expect(cut.kills!.d.length).toBeLessThan(brannoc.kills.d.length);
    }
  });

  it("uses the played time at the ding", () => {
    const snap = brannoc.levels.find((l) => l.level === level);
    if (snap?.played !== undefined) expect(cut.stats.played).toBe(snap.played);
    expect(cut.stats.played).toBeGreaterThan(0);
  });

  it("leaves the journey alone at or above its level", () => {
    expect(cutAtLevel(brannoc, brannoc.character.level)).toBe(brannoc);
    expect(cutAtLevel(brannoc, 99)).toBe(brannoc);
  });

  it("the stats tabs still work on a cut journey", () => {
    expect(levelStats(cut).rows).toHaveLength(level);
    expect(deathStats(cut).rows.every((d) => d.t <= at)).toBe(true);
  });
});

describe("head to head", () => {
  it("compares up to the lower level, and not at all when even", () => {
    const low = Math.min(brannoc.character.level, lyssira.character.level);
    if (brannoc.character.level !== lyssira.character.level && low >= 2) expect(sharedLevel(brannoc, lyssira)).toBe(low);
    expect(sharedLevel(brannoc, brannoc)).toBeUndefined();
  });

  it("names the time to the shared level, and picks winners the right way round", () => {
    const rows = headToHead(cutAtLevel(brannoc, 4), cutAtLevel(lyssira, 4), 4);
    expect(rows[0].label).toBe("Time to level 4");
    expect(rows.some((r) => r.label === "Level")).toBe(false);
    expect(winner({ label: "Deaths", a: 1, b: 3, better: "low", kind: "count" })).toBe("a");
    expect(winner({ label: "Gold", a: 1, b: 3, better: "high", kind: "gold" })).toBe("b");
    expect(winner({ label: "Gold", a: 3, b: 3, better: "high", kind: "gold" })).toBeUndefined();
    expect(winner({ label: "Km", a: 1, b: 3, better: "none", kind: "km" })).toBeUndefined();
    expect(headToHead(brannoc, lyssira)[0].label).toBe("Level");
  });

  it("draws the race from level 1 at no time played", () => {
    const race = levelRace(brannoc);
    expect(race[0]).toEqual([0, 1]);
    for (let i = 1; i < race.length; i++) expect(race[i][0]).toBeGreaterThanOrEqual(race[i - 1][0]);
    expect(race.at(-1)![1]).toBe(brannoc.character.level);
  });

  it("covers every level in the route and the deaths", () => {
    const spans = routeByLevel(brannoc);
    expect(spans[0].from).toBe(1);
    expect(spans.at(-1)!.to).toBe(brannoc.character.level);
    const byLevel = deathsByLevel(brannoc, 20);
    expect(byLevel).toHaveLength(20);
    expect(byLevel.reduce((a, b) => a + b, 0)).toBe(deathStats(brannoc).count);
  });
});

describe("finding the second character", () => {
  it("searches names from the start, with LIKE wildcards escaped", () => {
    expect(searchPattern("b")).toBeUndefined();
    expect(searchPattern("  bran ")).toBe("bran%");
    expect(searchPattern("a_b%")).toBe("a\\_b\\%%");
  });

  it("reads a pasted journey link", () => {
    expect(slugFromLink("https://journey-forever.example.dev/j/brannoc-sample-realm")).toBe("brannoc-sample-realm");
    expect(slugFromLink("/j/thalya/deaths")).toBe("thalya");
    expect(slugFromLink("thalya")).toBe("thalya");
    expect(slugFromLink("not a link at all")).toBeUndefined();
  });
});
