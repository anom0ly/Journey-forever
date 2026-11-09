import { describe, expect, it } from "vitest";
import type { CharacterSummary } from "../src/lib/journey";
import { BOARD_BY_ID } from "../src/lib/boardDefs";
import { boardEntries } from "../src/lib/boards";
import { summarize } from "../src/lib/merge";
import { readUpload } from "../src/lib/parse/upload";
import { summaryProblem, isFreeParam, knownParam, paramLooksRight, valueInRange } from "../src/lib/checks";
import { sampleFiles } from "./samples";

const summary = (over: Partial<CharacterSummary> = {}): CharacterSummary => ({
  key: "Brannoc-SampleRealm", name: "Brannoc", realm: "SampleRealm", className: "WARRIOR", race: "Dwarf", level: 24,
  quests: 10, distance: 1000, deaths: 2, sources: [], ...over,
});

describe("upload checks", () => {
  it("accepts a real summary and refuses made-up names", () => {
    expect(summaryProblem(summary())).toBeUndefined();
    expect(summaryProblem(summary({ realm: "Pyrewood Village" }))).toBeUndefined();
    expect(summaryProblem(summary({ name: "Visit my site.com" }))).toMatch(/name/);
    expect(summaryProblem(summary({ name: "Adom Ashford" }))).toBeUndefined();
    expect(summaryProblem(summary({ name: "Âura Ëlwyn" }))).toBeUndefined();
    expect(summaryProblem(summary({ name: "Adom  Ashford" }))).toMatch(/name/);
    expect(summaryProblem(summary({ name: "Adom Ashford Smith" }))).toMatch(/name/);
    expect(summaryProblem(summary({ className: "Buy gold here" }))).toMatch(/class/);
    expect(summaryProblem(summary({ level: 9000 }))).toMatch(/level/);
    expect(summaryProblem(summary({ deaths: -1 }))).toMatch(/numbers/);
  });

  it("drops an odd race or zone instead of refusing", () => {
    const s = summary({ race: "<b>x</b>", zone: "a".repeat(200) });
    summaryProblem(s);
    expect(s.race).toBeUndefined();
    expect(s.zone).toBeUndefined();
  });

  it("checks leaderboard names and numbers", () => {
    expect(knownParam("zone", "Un'Goro Crater")).toBe(true);
    expect(knownParam("dungeon", "The Deadmines")).toBe(true);
    expect(knownParam("profession", "First Aid")).toBe(true);
    expect(knownParam("zone", "Somewhere new")).toBe(false);
    expect(paramLooksRight("Shen'dralas")).toBe(true);
    expect(paramLooksRight("go to evil.com")).toBe(false);
    expect(paramLooksRight("<img src=x>")).toBe(false);
    expect(valueInRange("percent", 101)).toBe(false);
    expect(valueInRange("duration", 3600)).toBe(true);
    expect(valueInRange("level", 0)).toBe(false);
  });
});

describe("the sample characters pass every check", () => {
  const { journeys } = readUpload(sampleFiles(), 1800000000);
  it("summaries and board entries", () => {
    expect(journeys.length).toBeGreaterThan(0);
    for (const j of journeys) {
      const s = summarize(j);
      expect(summaryProblem(s)).toBeUndefined();
      expect(s.race).toBe(j.character.race);
      for (const e of boardEntries(j)) {
        const def = BOARD_BY_ID.get(e.b)!;
        expect(valueInRange(def.fmt, e.v), `${e.b} ${e.p} ${e.v}`).toBe(true);
        if (isFreeParam(def.param)) {
          expect(paramLooksRight(e.p), e.p).toBe(true);
          expect(knownParam(def.param, e.p), `${def.param} ${e.p}`).toBe(true);
        }
      }
    }
  });
});
