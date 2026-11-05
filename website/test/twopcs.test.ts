import { describe, expect, it } from "vitest";
import type { Journey, Session, Stats } from "../src/lib/journey";
import { combineStats, mergeJourneys, mergeKills, pcCount, summarize, uploadDelta } from "../src/lib/merge";

// One character played on two PCs: the desktop on day 1 and day 3, the laptop
// on day 2. Each PC's files hold only its own sessions.
const DAY = 86400;
const T0 = 1793900000;

function journey(sessions: Session[], stats: Stats, kills?: Journey["kills"]): Journey {
  const events = sessions.flatMap((s) => [
    { t: s.start, k: "on", level: s.startLevel },
    { t: s.start + 60, k: "qd", questID: s.start },
    { t: s.end, k: "off" },
  ]);
  return {
    format: 1,
    character: { key: "Player-1-ABC", guid: "Player-1-ABC", name: "Adom", realm: "91", level: 10 },
    sources: [{ addon: "rts", status: "ok" }, { addon: "jt", status: "ok" }, { addon: "jf", status: "missing" }],
    events,
    segments: [],
    ...(kills ? { kills } : {}),
    levels: [],
    sessions,
    stats,
    ...(Object.keys(stats).length ? { pcStats: { [String(stats.firstSeen ?? "?")]: stats } } : {}),
    zones: {},
    items: {},
    updatedAt: T0,
  };
}

const s = (day: number, hours: number): Session => ({ start: T0 + day * DAY, end: T0 + day * DAY + hours * 3600, startLevel: 5, endLevel: 6 });

const desktopStats: Stats = { firstSeen: T0 - 100, played: 5 * 3600, money: { quest: 100, vendor: 50 }, kills: { total: 40, top: [["Kobold", 30]] }, loot: { items: 10 } };
const laptopStats: Stats = { firstSeen: T0 + DAY - 50, played: 7 * 3600, money: { quest: 20, repair: -5 }, kills: { total: 15, top: [["Kobold", 5], ["Wolf", 10]] }, loot: { items: 4 } };

describe("two PCs, one journey", () => {
  const desktop = journey([s(0, 2), s(2, 3)], desktopStats, { d: `${T0 + 100},50,1;10,60,2;`, names: ["Kobold", "Wolf"] });
  const laptop = journey([s(1, 2)], laptopStats, { d: `${T0 + DAY + 100},70,1;`, names: ["Wolf"] });
  const stored = mergeJourneys(undefined, desktop);

  it("sees the older laptop file as filling a gap, not as up to date", () => {
    const before = summarize(stored);
    expect(uploadDelta(before, laptop).upToDate).toBe(true); // without the stored journey it can't tell
    const d = uploadDelta(before, laptop, stored);
    expect(d.upToDate).toBe(false);
    expect(d.fillsGap).toBe(true);
    expect(d.played).toBe(2 * 3600);
    expect(d.quests).toBe(1);
  });

  it("still calls a re-upload of the same file up to date", () => {
    const d = uploadDelta(summarize(stored), desktop, stored);
    expect(d.upToDate).toBe(true);
    expect(d.fillsGap).toBeUndefined();
  });

  it("interleaves the sessions and timeline in time order", () => {
    const j = mergeJourneys(stored, laptop);
    expect(j.sessions.map((x) => x.start)).toEqual([s(0, 2).start, s(1, 2).start, s(2, 3).start]);
    expect(j.events.filter((e) => e.k === "qd")).toHaveLength(3);
  });

  it("adds up each PC's Journey Tracker totals", () => {
    const j = mergeJourneys(stored, laptop);
    expect(pcCount(j)).toBe(2);
    expect(j.stats.money).toEqual({ quest: 120, vendor: 50, repair: -5 });
    expect(j.stats.kills?.total).toBe(55);
    expect(j.stats.kills?.top).toEqual([["Kobold", 35], ["Wolf", 10]]);
    expect(j.stats.loot?.items).toBe(14);
    expect(j.stats.played).toBe(7 * 3600); // the server's /played, not a sum
    expect(j.stats.firstSeen).toBe(T0 - 100);
  });

  it("replaces a PC's totals when that PC uploads again", () => {
    const later = journey([s(1, 2), s(3, 1)], { ...laptopStats, played: 8 * 3600, loot: { items: 6 } });
    const j = mergeJourneys(mergeJourneys(stored, laptop), later);
    expect(pcCount(j)).toBe(2);
    expect(j.stats.loot?.items).toBe(16);
  });

  it("keeps a journey stored before this change and adds the other PC to it", () => {
    const legacy = { ...stored };
    delete legacy.pcStats;
    const j = mergeJourneys(legacy, laptop);
    expect(pcCount(j)).toBe(2);
    expect(j.stats.kills?.total).toBe(55);
  });

  it("combines the kill lists by time, matching mobs by name", () => {
    const k = mergeKills(desktop.kills, laptop.kills)!;
    expect(k.names).toEqual(["Kobold", "Wolf"]);
    const times: [number, number, string][] = [];
    let t = 0;
    for (const m of k.d.matchAll(/(-?\d+),(\d+),(\d+);/g)) {
      t += Number(m[1]);
      times.push([t, Number(m[2]), k.names[Number(m[3]) - 1]]);
    }
    expect(times).toEqual([
      [T0 + 100, 50, "Kobold"],
      [T0 + 110, 60, "Wolf"],
      [T0 + DAY + 100, 70, "Wolf"],
    ]);
    // The same list twice is the same list.
    expect(mergeKills(desktop.kills, desktop.kills)!.d).toBe(desktop.kills!.d);
  });

  it("leaves a single PC's totals untouched", () => {
    expect(combineStats([desktopStats])).toBe(desktopStats);
  });
});
