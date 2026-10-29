import { describe, expect, it } from "vitest";
import { mergeJourneys, summarize, uploadDelta } from "../src/lib/merge";
import { contextOf, readUpload } from "../src/lib/parse/upload";
import { distanceByMode } from "../src/lib/path";
import { sampleFiles } from "./samples";

describe("contextOf", () => {
  it("finds realm and character from the folder", () => {
    expect(contextOf("ACC/Realm/Char/SavedVariables/RoadToSixty.lua")).toEqual({ realm: "Realm", character: "Char", accountWide: false });
    expect(contextOf("WTF/Account/ACC/Realm/Char/SavedVariables/RoadToSixty.lua")).toMatchObject({ realm: "Realm", character: "Char" });
    expect(contextOf("ACC/SavedVariables/RoadToSixty.lua").accountWide).toBe(true);
    expect(contextOf("WTF/Account/ACC/SavedVariables/RoadToSixty.lua").accountWide).toBe(true);
    expect(contextOf("RoadToSixty.lua").accountWide).toBe(false);
  });
});

describe("readUpload with the sample account", () => {
  const { journeys, notes } = readUpload(sampleFiles(), 1800000000);
  const brannoc = journeys.find((j) => j.character.name === "Brannoc")!;
  const lyssira = journeys.find((j) => j.character.name === "Lyssira")!;

  it("finds both characters and reads every file", () => {
    expect(notes).toEqual([]);
    expect(journeys.map((j) => j.character.name).sort()).toEqual(["Brannoc", "Lyssira"]);
    expect(brannoc.character).toMatchObject({ key: "Player-0000-00SAMPLE", realm: "Sample Realm", className: "PALADIN", race: "Dwarf" });
    expect(brannoc.sources.map((s) => [s.addon, s.status])).toEqual([["rts", "ok"], ["jt", "ok"], ["jf", "ok"]]);
    expect(lyssira.sources.map((s) => s.status)).toEqual(["ok", "missing", "missing"]);
  });

  it("builds the timeline from Road to Sixty and our addon", () => {
    const kinds = new Set(brannoc.events.map((e) => e.k));
    for (const k of ["on", "off", "lvl", "die", "qa", "qd", "zone", "in", "out", "loot", "eq", "prof", "gj", "rep", "rare", "grp", "grpx", "shot", "note"]) {
      expect(kinds, k).toContain(k);
    }
    const times = brannoc.events.map((e) => e.t);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    const epic = brannoc.events.find((e) => e.k === "loot" && (e.item as { quality: number }).quality === 4);
    expect(epic?.item).toMatchObject({ id: 9490, name: "Sample Epic Gizmo" });
    const out = brannoc.events.find((e) => e.k === "out");
    expect(out?.run).toMatchObject({ name: "Gnomeregan", groupSize: 3, kills: 64 });
  });

  it("gives screenshots and notes a place from the path", () => {
    const shots = brannoc.events.filter((e) => e.k === "shot");
    expect(shots).toHaveLength(3);
    expect(shots.every((s) => s.c === 0 && typeof s.x === "number")).toBe(true);
    const note = brannoc.events.find((e) => e.k === "note");
    expect(note).toMatchObject({ text: "Made it out of Coldridge Valley!", zone: "Dun Morogh", approx: true });
  });

  it("joins Road to Sixty's deaths with Journey Tracker's killers", () => {
    const deaths = brannoc.events.filter((e) => e.k === "die");
    expect(deaths).toHaveLength(2);
    expect(deaths[0]).toMatchObject({ killer: "Burly Rockjaw Trogg", zone: "Dun Morogh", c: 0 });
    expect(deaths[1]).toMatchObject({ killer: "Sample Boss", dungeon: "Gnomeregan" });
  });

  it("never keeps other players' names or GUIDs", () => {
    const text = JSON.stringify(journeys);
    expect(text).not.toContain("Groupmate");
    expect(text).not.toContain("0000AAAA");
    expect(text).not.toContain("0000BBBB");
  });

  it("reads levels, sessions and stats", () => {
    expect(brannoc.levels[0].level).toBe(1);
    expect(brannoc.levels.find((l) => l.level === 2)?.secondsOnLevel).toBeGreaterThan(0);
    expect(brannoc.sessions).toHaveLength(2);
    expect(brannoc.stats.money?.earned).toBe(52000);
    expect(brannoc.stats.kills?.top?.[0]).toEqual(["Rockjaw Trogg", 21]);
    expect(lyssira.levels.length).toBe(0);
    expect(lyssira.character.level).toBe(5);
  });

  it("measures the path by travel mode", () => {
    const d = distanceByMode(brannoc.segments);
    expect(d.w).toBeGreaterThan(3000);
    expect(d.t).toBeGreaterThan(1500);
    expect(d.g).toBeGreaterThan(100);
  });

  it("summarizes for the character list and the upload preview", () => {
    const s = summarize(brannoc);
    expect(s).toMatchObject({ name: "Brannoc", level: brannoc.character.level, deaths: 2, zone: "Loch Modan" });
    expect(s.quests).toBeGreaterThanOrEqual(10);
    expect(uploadDelta(undefined, brannoc).isNew).toBe(true);
    const again = uploadDelta(s, brannoc);
    expect(again.upToDate).toBe(true);
  });
});

describe("version checks", () => {
  it("refuses a newer layout and still loads the rest", () => {
    const files = sampleFiles().map((f) =>
      f.path.endsWith("Brannoc/SavedVariables/RoadToSixty.lua") ? { ...f, text: f.text.replace('["version"] = 4', '["version"] = 5') } : f,
    );
    const { journeys } = readUpload(files);
    const b = journeys.find((j) => j.character.name === "Brannoc")!;
    expect(b.sources[0]).toMatchObject({ addon: "rts", status: "refused" });
    expect(b.sources[0].message).toMatch(/newer Road to Sixty/);
    expect(b.segments).toEqual([]);
    expect(b.stats.money?.earned).toBe(52000);
    expect(b.events.some((e) => e.k === "shot")).toBe(true);
  });

  it("reports a broken file and reads the others", () => {
    const files = sampleFiles().map((f) =>
      f.path.endsWith("Brannoc/SavedVariables/JourneyTracker.lua") ? { ...f, text: f.text.slice(0, 2000) } : f,
    );
    const { journeys, notes } = readUpload(files);
    expect(notes).toHaveLength(1);
    expect(notes[0].path).toMatch(/JourneyTracker\.lua$/);
    expect(journeys.find((j) => j.character.name === "Brannoc")!.segments.length).toBeGreaterThan(0);
  });
});

describe("mergeJourneys", () => {
  it("keeps what a wiped file no longer has", () => {
    const full = readUpload(sampleFiles()).journeys.find((j) => j.character.name === "Brannoc")!;
    const wiped = structuredClone(full);
    wiped.events = wiped.events.slice(-5);
    wiped.segments = wiped.segments.slice(-2);
    const merged = mergeJourneys(full, wiped);
    expect(merged.events).toHaveLength(full.events.length);
    expect(merged.segments).toHaveLength(full.segments.length);
  });

  it("adds a new session's events to the stored ones", () => {
    const full = readUpload(sampleFiles()).journeys.find((j) => j.character.name === "Brannoc")!;
    const older = structuredClone(full);
    const cut = full.sessions[0].end;
    older.events = older.events.filter((e) => e.t <= cut);
    const merged = mergeJourneys(older, full);
    expect(merged.events).toHaveLength(full.events.length);
  });
});
