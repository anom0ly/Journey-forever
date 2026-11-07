import { describe, expect, it } from "vitest";
import type { Death, JEvent, Journey } from "../src/lib/journey";
import { buildJourney, collapseDeaths, deathCount, mergeJourneys } from "../src/lib/merge";
// Domonip's stored deaths on 7 Nov 2026: 30 on the timeline, 25 in Journey
// Tracker's list, for 18 real deaths (the client fired PLAYER_DEAD twice).
import domonip from "./fixtures-death-twins.json";

const stored = domonip as { events: JEvent[]; deaths: Death[] };

function journey(events: JEvent[], deaths: Death[]): Journey {
  return {
    format: 1,
    character: { key: "Player-1-ABC", guid: "Player-1-ABC", name: "Domonip", realm: "5", level: 27 },
    sources: [{ addon: "rts", status: "ok" }, { addon: "jt", status: "ok" }, { addon: "jf", status: "missing" }],
    events,
    segments: [],
    levels: [],
    sessions: [],
    stats: { deaths },
    zones: {},
    items: {},
    updatedAt: 0,
  };
}

describe("deaths saved twice", () => {
  it("counts each death once", () => {
    expect(collapseDeaths([{ t: 100 }, { t: 101 }, { t: 106 }, { t: 200 }]).map((d) => d.t)).toEqual([100, 200]);
    // Ten seconds apart is two deaths.
    expect(collapseDeaths([{ t: 100 }, { t: 110 }])).toHaveLength(2);
  });

  it("keeps Road to Sixty's death and fills its blanks from Journey Tracker's twin", () => {
    const rts: JEvent = { t: 1000, k: "die", killer: "Voidwalker Minion", killerKind: "creature", c: 1, x: 1, y: 2 };
    const jt: Death[] = [
      { t: 1001, killer: "Gazz'uz", zone: "Durotar", subzone: "Skull Rock", level: 12, mapID: 1411, mapX: 0.5, mapY: 0.1 },
      { t: 1003, killer: "Gazz'uz", zone: "Durotar", subzone: "Skull Rock", level: 12, mapID: 1411, mapX: 0.5, mapY: 0.1 },
    ];
    const j = buildJourney([
      { source: { addon: "rts", status: "ok" }, character: { guid: "Player-1-ABC", name: "Domonip" }, events: [rts] },
      { source: { addon: "jt", status: "ok" }, character: { guid: "Player-1-ABC", name: "Domonip" }, stats: { deaths: jt } },
    ]);
    const deaths = j.events.filter((e) => e.k === "die");
    expect(deaths).toHaveLength(1);
    expect(deaths[0]).toMatchObject({ t: 1000, killer: "Voidwalker Minion", killerKind: "creature", x: 1, subzone: "Skull Rock", level: 12 });
    expect(deathCount(j)).toBe(1);
  });

  it("cleans the twins an earlier upload stored", () => {
    const old = journey(stored.events, stored.deaths);
    expect(deathCount(old)).toBe(30);
    const merged = mergeJourneys(old, journey(stored.events, stored.deaths));
    expect(merged.events.filter((e) => e.k === "die")).toHaveLength(18);
    expect(deathCount(merged)).toBe(18);
    // The Road to Sixty copy (with the killer's kind) is the one kept.
    expect(merged.events.find((e) => e.t === 1793848469)).toMatchObject({ killer: "Voidwalker Minion", killerKind: "creature" });
    expect(merged.events.find((e) => e.t === 1793990256)).toMatchObject({ killerKind: "creature" });
  });
});
