import { describe, expect, it } from "vitest";
import { dungeonRuns, endBosses } from "../src/lib/clears";
import { boardEntries } from "../src/lib/boards";
import { moments } from "../src/lib/insights";
import type { JEvent, Journey } from "../src/lib/journey";
import { readUpload } from "../src/lib/parse/upload";
import { sampleFiles } from "./samples";

const { journeys } = readUpload(sampleFiles(), 1800000000);

const T = 1793976144;

// A journey with just the parts dungeon runs read.
function journey(events: JEvent[], kills: [number, string][] = [], runs: Journey["stats"]["runs"] = []): Journey {
  const names: string[] = [];
  let last = 0;
  let d = "";
  for (const [t, name] of kills) {
    if (!names.includes(name)) names.push(name);
    d += `${t - last},50,${names.indexOf(name) + 1};`;
    last = t;
  }
  return { events, zones: {}, levels: [], sessions: [], segments: [], items: {}, character: { name: "Test", key: "t" }, kills: kills.length ? { d, names } : undefined, stats: { runs } } as unknown as Journey;
}

const visit = (from: number, to: number, kills = 10, name = "Ragefire Chasm", instanceID = 389): JEvent[] => [
  { t: from, k: "in", instanceID, name, type: "party" },
  { t: to, k: "out", instanceID, run: { name, duration: to - from, kills, deaths: 0, type: "party" } },
];

describe("full dungeon clears", () => {
  it("knows each dungeon's end boss", () => {
    expect(endBosses("Ragefire Chasm")?.has("taragaman the hungerer")).toBe(true);
    expect(endBosses("the deadmines")?.has("edwin vancleef")).toBe(true);
    expect(endBosses("Somewhere New")).toBeUndefined();
  });

  it("calls a run that stopped short left early (Oggleflint but no Taragaman)", () => {
    const j = journey(visit(T, T + 960, 54), [[T + 100, "Ragefire Trogg"], [T + 400, "Oggleflint"], [T + 800, "Earthborer"]]);
    const [run] = dungeonRuns(j);
    expect(run).toMatchObject({ name: "Ragefire Chasm", duration: 960, kills: 54, cleared: false });
    expect(boardEntries(j).filter((e) => e.b === "dungeonrun" || e.b === "runs" || e.b === "youngclear")).toEqual([]);
    expect(moments(j).find((m) => m.kind === "dungeon")?.tag).toEqual({ text: "Left early", tone: "grey" });
  });

  it("calls a run where the end boss died a full clear", () => {
    const j = journey(visit(T, T + 960, 54), [[T + 400, "Oggleflint"], [T + 900, "Taragaman the Hungerer"]]);
    const [run] = dungeonRuns(j);
    expect(run).toMatchObject({ cleared: true, boss: "Taragaman the Hungerer" });
    expect(boardEntries(j).find((e) => e.b === "dungeonrun")).toMatchObject({ p: "Ragefire Chasm", v: 960 });
    expect(boardEntries(j).find((e) => e.b === "runs")?.v).toBe(1);
  });

  it("ignores an end boss killed outside the run", () => {
    const j = journey(visit(T, T + 960), [[T + 2000, "Taragaman the Hungerer"]]);
    expect(dungeonRuns(j)[0].cleared).toBe(false);
  });

  it("joins a wipe and run back into one run, timed from the first entry", () => {
    const events = [...visit(T, T + 600, 20), ...visit(T + 900, T + 1500, 15)];
    const j = journey(events, [[T + 1400, "Taragaman the Hungerer"]]);
    const runs = dungeonRuns(j);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ start: T, t: T + 1500, duration: 1500, kills: 35, visits: 2, cleared: true });
  });

  it("keeps visits apart when the gap is long or another dungeon is between", () => {
    expect(dungeonRuns(journey([...visit(T, T + 600), ...visit(T + 1300, T + 1900)]))).toHaveLength(2);
    const between = [...visit(T, T + 600), ...visit(T + 650, T + 700, 1, "Wailing Caverns", 43), ...visit(T + 750, T + 900)];
    expect(dungeonRuns(journey(between))).toHaveLength(3);
  });

  it("takes the addon's end boss screenshot when the kill log has nothing", () => {
    const shot: JEvent = { t: T + 902, k: "shot", kind: "dungeon", detail: { instance: "Ragefire Chasm", boss: "Taragaman the Hungerer", via: "encounter" } };
    const left: JEvent = { t: T + 902, k: "shot", kind: "dungeon", detail: { instance: "Ragefire Chasm", via: "left" } };
    expect(dungeonRuns(journey([...visit(T, T + 960), shot]))[0]).toMatchObject({ cleared: true, boss: "Taragaman the Hungerer" });
    expect(dungeonRuns(journey([...visit(T, T + 960), left]))[0].cleared).toBe(false);
  });

  it("can't tell for a dungeon with no listed end boss, and leaves it off the boards", () => {
    const j = journey(visit(T, T + 960, 30, "Somewhere New", 9999), [[T + 900, "Big Boss"]]);
    expect(dungeonRuns(j)[0].cleared).toBeUndefined();
    expect(boardEntries(j).find((e) => e.b === "dungeonrun")).toBeUndefined();
    expect(moments(j).find((m) => m.kind === "dungeon")?.tag).toBeUndefined();
  });

  it("checks Journey Tracker's runs against the addon when there is no Road to Sixty", () => {
    const shot: JEvent = { t: T + 500, k: "shot", kind: "dungeon", detail: { via: "encounter" } };
    const runs = [{ name: "Ragefire Chasm", start: T, duration: 960, bosses: 1 }, { name: "Ragefire Chasm", start: T + 5000, duration: 600, bosses: 1 }];
    expect(dungeonRuns(journey([shot], [], runs)).map((r) => r.cleared)).toEqual([true, false]);
  });

  it("finds the sample's Gnomeregan clear", () => {
    const brannoc = journeys.find((j) => j.character.name === "Brannoc")!;
    expect(dungeonRuns(brannoc)).toMatchObject([{ name: "Gnomeregan", cleared: true, boss: "Mekgineer Thermaplugg" }]);
  });
});
