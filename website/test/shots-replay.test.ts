import { describe, expect, it } from "vitest";
import { readUpload } from "../src/lib/parse/upload";
import { buildClock, toReal, toReplay, tracksOf, whereAt } from "../src/lib/replay";
import { matchShots, shotTime } from "../src/lib/shots";
import { sampleFiles } from "./samples";

const utc = (y: number, mo: number, d: number, h: number, mi: number, s: number) => Date.UTC(y, mo - 1, d, h, mi, s) / 1000;

describe("screenshots", () => {
  const { journeys } = readUpload(sampleFiles());
  const brannoc = journeys.find((j) => j.character.name === "Brannoc")!;
  const logged = brannoc.events.filter((e) => e.k === "shot");
  const fileAt = (t: number) => {
    const d = new Date(t * 1000);
    const p = (n: number) => String(n).padStart(2, "0");
    return `WoWScrnShot_${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCFullYear() % 100)}_${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}.jpg`;
  };

  it("reads the time from the game's file name", () => {
    expect(shotTime("WoWScrnShot_110426_183015.jpg", utc)).toBe(utc(2026, 11, 4, 18, 30, 15));
    expect(shotTime("holiday.png", utc)).toBeUndefined();
  });

  it("pairs files with logged shots, keeps hand-taken ones from a session, drops the rest", () => {
    const files = [
      ...logged.map((e) => ({ name: fileAt(e.t + 3), time: e.t + 3 })),
      { name: "manual", time: brannoc.sessions[1].start + 600 },
      { name: "old", time: brannoc.sessions[0].start - 90 * 86400 },
    ];
    const m = matchShots(files, journeys);
    expect(m.matched.map((x) => x.kind).sort()).toEqual(["dungeon", "epic", "level"]);
    expect(m.matched.find((x) => x.kind === "dungeon")?.label).toBe("Cleared Gnomeregan");
    expect(m.manual.map((x) => x.file.name)).toEqual(["manual"]);
    expect(m.unmatched.map((x) => x.name)).toEqual(["old"]);
  });
});

describe("replay clock", () => {
  const brannoc = readUpload(sampleFiles()).journeys.find((j) => j.character.name === "Brannoc")!;
  const tracks = tracksOf(brannoc.segments);
  const clock = buildClock(tracks);

  it("skips the time between sessions", () => {
    const realSpan = tracks.at(-1)!.t.at(-1)! - tracks[0].t[0];
    expect(clock.total).toBeLessThan(realSpan / 5);
    expect(clock.start.length).toBeGreaterThan(1);
  });

  it("maps real time to replay time and back", () => {
    const t = tracks[3].t[5];
    expect(toReal(clock, toReplay(clock, t))).toBe(t);
    expect(toReplay(clock, 0)).toBe(0);
  });

  it("finds the character between two points", () => {
    const tr = tracks[0];
    const mid = (tr.t[0] + tr.t[1]) / 2;
    const here = whereAt(tracks, mid)!;
    expect(here.x).toBeCloseTo((tr.x[0] + tr.x[1]) / 2);
    expect(here.c).toBe(0);
  });
});
