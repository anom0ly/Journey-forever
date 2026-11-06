import { describe, expect, it } from "vitest";
import { BOARD_BY_ID, BOARDS, CARDS, coins, fixedParams, formatValue, GROUPS } from "../src/lib/boardDefs";
import { boardEntries, integrityChecks } from "../src/lib/boards";
import type { Journey } from "../src/lib/journey";
import { readUpload } from "../src/lib/parse/upload";
import { sampleFiles } from "./samples";

const { journeys } = readUpload(sampleFiles(), 1800000000);
const brannoc = journeys.find((j) => j.character.name === "Brannoc")!;
const lyssira = journeys.find((j) => j.character.name === "Lyssira")!;
const NOW = 1800000000;

describe("board catalogue", () => {
  it("has a card for every board, and every card's boards exist", () => {
    const onCards = new Set(Object.values(CARDS).flatMap((cs) => cs.flatMap((c) => c.boards.map((b) => b.id))));
    for (const b of BOARDS) expect(onCards.has(b.id), b.id).toBe(true);
    for (const id of onCards) expect(BOARD_BY_ID.has(id), id).toBe(true);
    expect(GROUPS.map((g) => g.id).sort()).toEqual(Object.keys(CARDS).sort());
  });

  it("formats values", () => {
    expect(formatValue("duration", 3 * 86400 + 5 * 3600 + 7 * 60)).toBe("3d 5h 07m");
    expect(formatValue("duration", 125)).toBe("2m 05s");
    expect(formatValue("gold", 2125000)).toBe("212g 50s 0c");
    expect(formatValue("percent", 61.25)).toBe("61.3%");
    expect(formatValue("deaths", 1)).toBe("1 death");
  });
});

describe("board entries", () => {
  const entries = boardEntries(brannoc);
  const get = (b: string, p = "") => entries.find((e) => e.b === b && e.p === p)?.v;

  it("works out the numbers from a sample journey", () => {
    expect(get("quests")).toBe(12);
    expect(get("deaths")).toBe(2);
    expect(get("levelfast", "3")).toBeGreaterThan(0);
    expect(get("zonetime", "Loch Modan")).toBeGreaterThan(600);
    expect(get("dungeonrun", "Gnomeregan")).toBeGreaterThan(0);
    expect(get("goldearned")).toBeGreaterThan(0); // Journey Tracker
  });

  it("only uses params the server accepts", () => {
    for (const e of [...entries, ...boardEntries(lyssira)]) {
      const def = BOARD_BY_ID.get(e.b)!;
      expect(def, e.b).toBeDefined();
      if (!def.param) expect(e.p).toBe("");
      const fixed = fixedParams(def.param);
      if (fixed) expect(fixed).toContain(e.p);
    }
  });

  it("leaves out boards with nothing to show", () => {
    const l = boardEntries(lyssira);
    expect(l.find((e) => e.b === "deaths")).toBeUndefined();
    expect(l.find((e) => e.b === "goldearned")).toBeUndefined();
  });
});

describe("automatic checks", () => {
  it("finds nothing wrong with the samples", () => {
    expect(integrityChecks(brannoc, undefined, NOW)).toEqual([]);
    expect(integrityChecks(lyssira, undefined, NOW)).toEqual([]);
  });

  it("notices a rewritten level and an impossible level", () => {
    const j: Journey = structuredClone(brannoc);
    const lvl = j.events.find((e) => e.k === "lvl" && e.level === 5)!;
    lvl.t += 5000;
    for (const l of j.levels) if (l.level === 5 && l.t) l.t += 5000;
    const found = integrityChecks(j, brannoc, NOW);
    expect(found.some((c) => c.includes("changed when level"))).toBe(true);
  });

  it("notices levels out of order", () => {
    const j: Journey = structuredClone(brannoc);
    const l3 = j.events.find((e) => e.k === "lvl" && e.level === 3)!;
    const l4 = j.events.find((e) => e.k === "lvl" && e.level === 4)!;
    [l3.t, l4.t] = [l4.t, l3.t];
    j.levels = j.levels.map((l) => ({ ...l, t: undefined }));
    expect(integrityChecks(j, undefined, NOW).some((c) => c.includes("recorded before"))).toBe(true);
  });
});

describe("gold board values", () => {
  it("splits copper into gold, silver and copper", () => {
    expect(coins(12843712)).toEqual({ g: 1284, s: 37, c: 12 });
    expect(coins(9407)).toEqual({ g: 0, s: 94, c: 7 });
    expect(formatValue("gold", 4129903)).toBe("412g 99s 3c");
    expect(formatValue("goldHour", 381560)).toBe("38g 15s 60c/h");
  });
});
