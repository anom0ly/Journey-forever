import { describe, expect, it } from "vitest";
import { readUpload } from "../src/lib/parse/upload";
import { deathStats, goldStats, levelStats, professionStats, pvpStats } from "../src/lib/stats";
import { dungeonRuns } from "../src/lib/insights";
import { sampleFiles } from "./samples";

const { journeys } = readUpload(sampleFiles(), 1800000000);
const brannoc = journeys.find((j) => j.character.name === "Brannoc")!;
const lyssira = journeys.find((j) => j.character.name === "Lyssira")!;

describe("Road to Sixty 1.18 data", () => {
  it("keeps who killed you, but never another player's name", () => {
    const deaths = brannoc.events.filter((e) => e.k === "die");
    expect(deaths[0]).toMatchObject({ killer: "Burly Rockjaw Trogg", killerKind: "creature" });
    expect(deaths[1]).toMatchObject({ killer: "Sample Boss", spell: "Sample Smash" });
    const text = JSON.stringify(brannoc);
    expect(text).not.toContain("Duelist");
    expect(text).not.toContain("Elsewhere Guild");
    expect(text).not.toContain("Enemy-Elsewhere");
  });

  it("reads gold at login and logout, skill-ups, crafts, gathers and the snapshot totals", () => {
    expect(brannoc.events.find((e) => e.k === "off")?.money).toBeGreaterThan(0);
    expect(brannoc.events.filter((e) => e.k === "skill").length).toBeGreaterThan(5);
    expect(brannoc.events.find((e) => e.k === "craft")).toMatchObject({ item: { id: 1251, name: "Linen Bandage" }, count: 6, profession: "First Aid" });
    expect(brannoc.events.find((e) => e.k === "gath")).toMatchObject({ prof: "mining", itemID: 2770, loot: [{ id: 2770, count: 2 }, { id: 774, count: 1 }] });
    const l5 = brannoc.levels.find((l) => l.level === 5)!;
    expect(l5.kills).toBeGreaterThan(0);
    expect(l5.skills?.Mining?.rank).toBeGreaterThan(0);
  });

  it("reads a player killer from Journey Tracker as a kind only", async () => {
    const files = sampleFiles().map((f) => (f.path.endsWith("Brannoc/SavedVariables/JourneyTracker.lua") ? { ...f, text: f.text.replace('"Burly Rockjaw Trogg"', '"Player (PvP)"') } : f));
    const files2 = files.map((f) => (f.path.endsWith("Brannoc/SavedVariables/RoadToSixty.lua") ? { ...f, text: f.text.replace(/"Burly Rockjaw Trogg",\s*-- \[6\]/, "nil, -- [6]") } : f));
    const b = readUpload(files2).journeys.find((j) => j.character.name === "Brannoc")!;
    const first = b.events.find((e) => e.k === "die")!;
    expect(first.killerKind).toBe("player");
    expect(first.killer).toBeUndefined();
  });
});

describe("deathStats", () => {
  const d = deathStats(brannoc);
  it("counts deaths, causes and the longest stretch alive", () => {
    expect(d.count).toBe(2);
    expect(d.rows[1]).toMatchObject({ killer: "Sample Boss", inInstance: true, zone: "Gnomeregan" });
    expect(d.causes.map((c) => [c.label, c.count])).toEqual([["Creatures, open world", 1], ["Creatures, in dungeons", 1]]);
    expect(d.longestAlive?.seconds).toBeGreaterThan(0);
    expect(d.byLevel.reduce((n, b) => n + b.world + b.instance, 0)).toBe(2);
  });
});

describe("goldStats", () => {
  const g = goldStats(brannoc);
  it("draws gold held from logins, logouts and level ups", () => {
    expect(g.points.length).toBeGreaterThan(4);
    expect(g.points.map((p) => p.t)).toEqual([...g.points.map((p) => p.t)].sort((a, b) => a - b));
    expect(g.sessions).toHaveLength(2);
    expect(g.sessions.every((s) => s.change !== undefined)).toBe(true);
    expect(g.peak!.money).toBeGreaterThanOrEqual(g.now!.money);
    expect(g.questMoney).toBeGreaterThan(0);
  });
});

describe("professionStats", () => {
  const p = professionStats(brannoc);
  it("follows each profession's skill against the character's level", () => {
    const mining = p.professions.find((x) => x.name === "Mining")!;
    expect(mining.rank).toBe(64);
    expect(mining.max).toBe(75);
    expect(mining.gathers).toBe(5);
    expect(mining.points.map((x) => x.rank)).toEqual([...mining.points.map((x) => x.rank)].sort((a, b) => a - b));
    expect(mining.points.every((x) => x.level >= 1 && x.level < brannoc.character.level + 1)).toBe(true);
    expect(p.professions.find((x) => x.name === "First Aid")?.made).toBe(6);
    expect(p.history.Mining[0].text).toMatch(/Made 8 × Copper Bar/);
    expect(p.gathered[0]).toMatchObject({ name: "Copper Ore" });
  });
});

describe("pvpStats", () => {
  const p = pvpStats(brannoc);
  it("reads battlegrounds and duels, and keeps them out of the dungeon list", () => {
    expect(p.matches).toHaveLength(1);
    expect(p.matches[0]).toMatchObject({ name: "Warsong Gulch", result: "won" });
    expect(p.maps[0].objectives).toEqual([{ name: "Flag Captures", value: 1 }, { name: "Flag Returns", value: 2 }]);
    expect(p.hk).toBe(14);
    expect(p.honor).toBe(240);
    expect(p.duels).toEqual([{ t: expect.any(Number), result: "won", label: "Level 8 Human Warrior", toDeath: false }]);
    expect(dungeonRuns(brannoc).map((r) => r.name)).toEqual(["Gnomeregan"]);
  });
});

describe("levelStats", () => {
  it("gives a row per level with what happened during it", () => {
    const s = levelStats(brannoc);
    expect(s.rows).toHaveLength(brannoc.character.level);
    expect(s.rows.reduce((n, r) => n + r.quests, 0)).toBe(brannoc.events.filter((e) => e.k === "qd").length);
    expect(s.rows.reduce((n, r) => n + r.deaths, 0)).toBe(2);
    expect(s.rows.at(-1)!.inProgress).toBe(true);
    expect(s.questShare).toBeGreaterThan(0);
    expect(s.rows.some((r) => r.dungeons === 1)).toBe(true);
  });

  it("copes with a journey with no snapshots or kills", () => {
    const s = levelStats(lyssira);
    expect(s.rows).toHaveLength(5);
    expect(s.rows[0].quests).toBe(1);
  });
});
