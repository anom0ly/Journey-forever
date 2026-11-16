import { describe, expect, it } from "vitest";
import { sixtyStats, bossFirstKills, isEpicMount } from "../src/lib/sixty";
import { boardEntries } from "../src/lib/boards";
import { dungeonRuns } from "../src/lib/clears";
import { mergeJourneys } from "../src/lib/merge";
import { parseJourneyTracker } from "../src/lib/parse/jt";
import { parseItem } from "../src/lib/wow";
import type { Journey } from "../src/lib/journey";
import { sixtyJourney, T60 } from "./sixtyFixture";

const D = 86400;

describe("life at 60", () => {
  it("is only for characters at 60", () => {
    const j = sixtyJourney();
    expect(sixtyStats({ ...j, character: { ...j.character, level: 59 } })).toBeUndefined();
    expect(sixtyStats(j)?.reached).toBe(T60);
  });

  it("reads raid bosses from Journey Tracker, dated by runs and screenshots", () => {
    const s = sixtyStats(sixtyJourney("all"))!;
    expect(s.bossSource).toBe("jt");
    const mc = s.raids.find((r) => r.raid.name === "Molten Core")!;
    expect(mc.killed).toBe(7);
    expect(mc.visits).toBe(2);
    const garr = mc.bosses.find((b) => b.name === "Garr")!;
    expect(garr).toMatchObject({ kills: 2, wipes: 2 });
    expect(garr.first?.exact).toBe(true); // the boss screenshot
    // Golemagg the Incinerator is "Golemagg" to the game here: not in the table, so no kill.
    expect(mc.bosses.find((b) => b.name === "Ragnaros")?.kills).toBe(0);
    expect(s.raids.find((r) => r.raid.name === "Onyxia's Lair")?.killed).toBe(1);
    // Dungeon bosses aren't raid bosses.
    expect(s.bossKills).toBe(13);
  });

  it("falls back to our addon's screenshots without Journey Tracker", () => {
    const s = sixtyStats(sixtyJourney("rtsjf"))!;
    expect(s.bossSource).toBe("shots");
    const mc = s.raids.find((r) => r.raid.name === "Molten Core")!;
    expect(mc.bosses.find((b) => b.name === "Lucifron")).toMatchObject({ kills: 2, wipes: undefined });
    expect(mc.firstBoss?.t).toBe(T60 + D - 3600 + 1200);
    expect(s.wipes).toBeUndefined();
  });

  it("shows raid visits only with Road to Sixty alone", () => {
    const s = sixtyStats(sixtyJourney("rts"))!;
    expect(s.bossSource).toBeUndefined();
    expect(s.raidVisits).toBe(3);
    expect(s.raids.map((r) => [r.raid.name, r.visits, r.epics])).toEqual([["Molten Core", 2, 3], ["Onyxia's Lair", 1, 1]]);
  });

  it("lists gear, upgrades, gold, reputation and milestones", () => {
    const s = sixtyStats(sixtyJourney("all"))!;
    expect(s.gear.find((g) => g.slot === 1)).toMatchObject({ item: { name: "Lawbringer Helm", quality: 4 }, how: "Molten Core roll", worn: 2 * D + 5 * 3600 });
    expect(s.upgrades[0].item.name).toBe("Lawbringer Boots");
    expect(s.epics).toBe(4);
    expect(s.exalted).toEqual(["Argent Dawn", "Ironforge"]);
    expect(s.reps.find((r) => r.faction === "Argent Dawn")).toMatchObject({ standing: 8, from: 6 });
    expect(s.epicMount?.name).toBe("Swift Gray Ram");
    const titles = s.milestones.map((m) => m.title);
    expect(titles).toContain("Attuned to Molten Core");
    expect(titles).toContain("First raid: Molten Core");
    expect(titles).toContain("Epic mount: Swift Gray Ram");
    expect(s.goldAt60).toBeDefined();
    expect(s.time.find((t) => t.label === "Raids")!.seconds).toBeGreaterThan(6 * 3600);
  });

  it("puts level 60 numbers on the boards", () => {
    const e = boardEntries(sixtyJourney("all"));
    const get = (b: string, p = "") => e.find((x) => x.b === b && x.p === p)?.v;
    expect(get("bosskills")).toBe(13);
    expect(get("firstboss", "Garr")).toBe(T60 + D - 3600 + 1200 + 3 * 1500);
    expect(get("firstboss", "Onyxia")).toBeDefined();
    expect(get("raidvisits")).toBe(3);
    expect(get("epics60")).toBe(4);
    expect(get("exalted", "Argent Dawn")).toBe(T60 + 7 * D + 3 * 3600);
    expect(get("epicmount")).toBeGreaterThan(0);
    expect(get("killrate")).toBe(Math.round((13 / 19) * 1000) / 10);
  });

  it("knows epic mounts", () => {
    expect(isEpicMount("Swift Gray Ram")).toBe(true);
    expect(isEpicMount("Great White Kodo")).toBe(true);
    expect(isEpicMount("Gray Ram")).toBe(false);
  });
});

describe("first raid boss kills across uploads", () => {
  const base = () => {
    const j = sixtyJourney("all");
    j.events = j.events.filter((e) => e.k !== "shot");
    j.bossFirst = undefined;
    return j;
  };
  const withBosses = (j: Journey, bosses: NonNullable<Journey["stats"]["bosses"]>, runs: NonNullable<Journey["stats"]["runs"]>): Journey => ({ ...j, pcStats: undefined, stats: { ...j.stats, bosses, runs } });

  it("dates a boss by the one raid run it could have died in", () => {
    const j = withBosses(base(), { Onyxia: { kills: 1, attempts: 1 } }, [{ name: "Onyxia's Lair", start: 5000, bosses: 1 }]);
    expect(bossFirstKills(undefined, j)).toEqual({ Onyxia: { t: 5000 } });
  });

  it("dates a new kill by the runs since the last upload", () => {
    const old = withBosses(base(), { Lucifron: { kills: 1 } }, [{ name: "Molten Core", start: T60 + D, bosses: 1 }]);
    old.bossFirst = { Lucifron: { t: T60 + D } };
    const next = withBosses(base(), { Lucifron: { kills: 2 }, Garr: { kills: 1 } }, [
      { name: "Molten Core", start: T60 + D, bosses: 1 },
      { name: "Molten Core", start: T60 + 20 * D, bosses: 4 },
    ]);
    const merged = mergeJourneys(old, next);
    expect(merged.bossFirst).toEqual({ Lucifron: { t: T60 + D }, Garr: { t: T60 + 20 * D } });
  });

  it("gives no date when the first upload has many runs", () => {
    const j = withBosses(base(), { Garr: { kills: 3 } }, [
      { name: "Molten Core", start: 100, bosses: 3 },
      { name: "Molten Core", start: 200, bosses: 5 },
    ]);
    expect(bossFirstKills(undefined, j)).toBeUndefined();
  });
});

describe("level 60 data in the saved files", () => {
  it("reads Journey Tracker's bosses, time worn and the day it hit 60", () => {
    const c = parseJourneyTracker(
      {
        schemaVersion: 1,
        char: { name: "A", realm: "B" },
        bosses: { Ragnaros: { attempts: 3, kills: 1, wipes: 2 } },
        worn: { a: { link: "|cffa335ee|Hitem:17076::::|h[Bonereaver's Edge]|h|r", played: 100 }, b: { link: "|cffa335ee|Hitem:17076:1:::|h[Bonereaver's Edge]|h|r", played: 50 } },
        reachedMax: 1794692520,
      },
      {},
    );
    expect(c.stats?.bosses).toEqual({ Ragnaros: { attempts: 3, kills: 1, wipes: 2 } });
    expect(c.stats?.worn).toEqual({ 17076: 150 });
    expect(c.stats?.reachedMax).toBe(1794692520);
  });

  it("reads the quality newer clients put in item links", () => {
    expect(parseItem("|cnIQ4:|Hitem:16854::::|h[Lawbringer Helm]|h|r")).toEqual({ id: 16854, name: "Lawbringer Helm", quality: 4 });
  });

  it("leaves a run at 60 with no XP kills undecided, not left early", () => {
    const j = sixtyJourney("rts");
    const strat = dungeonRuns(j).find((r) => r.name === "Stratholme")!;
    expect(strat.cleared).toBeUndefined();
  });
});
