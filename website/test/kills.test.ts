import { describe, expect, it } from "vitest";
import { boardEntries } from "../src/lib/boards";
import { cutAtLevel, killsByLevel, killsHeadToHead } from "../src/lib/compare";
import { emptyJourney, type Journey } from "../src/lib/journey";
import { killLog, killStats, sharedPrey, typeShares } from "../src/lib/kills";
import { readUpload } from "../src/lib/parse/upload";
import { sampleFiles } from "./samples";

const { journeys } = readUpload(sampleFiles(), 1800000000);
const brannoc = journeys.find((j) => j.character.name === "Brannoc")!;
const lyssira = journeys.find((j) => j.character.name === "Lyssira")!;

// A journey with a hand-made kill log: names 1 Wolf, 2 Boar, 3 Kobold.
function made(): Journey {
  const j = emptyJourney({ key: "k", name: "Test", realm: "R", level: 3 } as Journey["character"]);
  const t0 = 1_800_000_000;
  j.events = [
    { t: t0, k: "on", level: 1 },
    { t: t0 + 1, k: "zone", mapID: 27 },
    { t: t0 + 500, k: "lvl", level: 2 },
    { t: t0 + 4000, k: "in", name: "The Deadmines" },
    { t: t0 + 5000, k: "out" },
    { t: t0 + 5200, k: "rare", name: "Boar" },
  ] as Journey["events"];
  j.zones = { "27": "Dun Morogh" };
  // Wolf at +10, +20 (level 1); Boar at +600 (level 2); Kobold x3 in the dungeon; Boar at +5200.
  j.kills = { d: `${t0 + 10},50,1;10,50,1;580,60,2;3410,70,3;10,70,3;10,70,3;1170,80,2;`, names: ["Wolf", "Boar", "Kobold"] };
  j.sessions = [{ start: t0, end: t0 + 7200 }];
  return j;
}

describe("kill stats from the Road to Sixty kill log", () => {
  const k = killStats(made());

  it("counts each creature with where and at what level", () => {
    expect(k.total).toBe(7);
    expect(k.fromLog).toBe(true);
    expect(k.different).toBe(3);
    expect(k.creatures.map((c) => [c.name, c.count])).toEqual([["Kobold", 3], ["Boar", 2], ["Wolf", 2]]);
    const wolf = k.creatures.find((c) => c.name === "Wolf")!;
    expect([wolf.minLevel, wolf.maxLevel, wolf.zone, wolf.dungeon]).toEqual([1, 1, "Dun Morogh", false]);
    const kobold = k.creatures.find((c) => c.name === "Kobold")!;
    expect([kobold.zone, kobold.dungeon]).toEqual(["The Deadmines", true]);
    expect(k.creatures.find((c) => c.name === "Boar")!.rare).toBe(true);
    expect(k.rares).toBe(1);
  });

  it("splits kills by level and zone, and finds the busiest hour", () => {
    expect(k.byLevel).toEqual([2, 5]);
    expect(k.byZone).toEqual([
      { zone: "Dun Morogh", count: 4, dungeon: false },
      { zone: "The Deadmines", count: 3, dungeon: true },
    ]);
    // The three dungeon kills and the Boar after: four inside an hour.
    expect(k.busiest?.count).toBe(4);
    expect(k.busiest?.zone).toBe("The Deadmines");
    expect(k.perHour).toBe(4); // 7 kills in 2h played, rounded
  });

  it("goes on the kill boards", () => {
    const e = boardEntries(made());
    const get = (b: string, p = "") => e.find((x) => x.b === b && x.p === p)?.v;
    expect(get("kills")).toBe(7);
    expect(get("creature", "Kobold")).toBe(3);
    expect(get("creatures")).toBe(3);
    expect(get("killhour")).toBe(4);
    expect(get("rares")).toBe(1);
    expect(get("elites")).toBeUndefined();
  });
});

describe("Journey Tracker's kill counters", () => {
  const j = made();
  j.kills = undefined;
  j.events = [];
  j.stats.kills = {
    total: 40,
    top: [["Wolf", 25], ["Boar", 15]],
    byType: { Beast: 30, Humanoid: 10 },
    byClass: { elite: 4, rareelite: 1, rare: 2 },
    toughest: { name: "Mangeclaw", diff: 4, mobLevel: 15, level: 11 },
  };
  const k = killStats(j);

  it("fill in types, elites and the toughest kill", () => {
    expect(k.fromLog).toBe(false);
    expect(k.creatures.map((c) => c.name)).toEqual(["Wolf", "Boar"]);
    expect(k.different).toBeUndefined();
    expect(k.byType).toEqual([{ type: "Beast", count: 30 }, { type: "Humanoid", count: 10 }]);
    expect(k.elites).toBe(5);
    expect(k.rares).toBe(3);
    expect(k.toughest?.name).toBe("Mangeclaw");
    expect(typeShares(k).get("Beast")).toBe(0.75);
    const e = boardEntries(j);
    expect(e.find((x) => x.b === "ctype" && x.p === "Beast")?.v).toBe(30);
    expect(e.find((x) => x.b === "toughest")?.v).toBe(4);
  });
});

describe("the samples", () => {
  it("read Road to Sixty's log and Journey Tracker's toughest kill", () => {
    expect(killLog(brannoc).length).toBeGreaterThan(0);
    const k = killStats(brannoc);
    expect(k.creatures[0].count).toBeGreaterThan(0);
    expect(k.byLevel.reduce((a, b) => a + b, 0)).toBe(killLog(brannoc).length);
  });

  it("compare side by side, cut at a level", () => {
    const a = killStats(cutAtLevel(brannoc, 5)), b = killStats(lyssira);
    const rows = killsHeadToHead(a, b, 5);
    expect(rows.find((r) => r.label === "Kills")?.a).toBeLessThanOrEqual(killStats(brannoc).total!);
    expect(killsByLevel(a, 8)).toHaveLength(8);
    for (const r of sharedPrey(a, b)) expect(r.a > 0 && r.b > 0).toBe(true);
  });
});
