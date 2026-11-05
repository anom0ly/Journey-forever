import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import jpeg from "jpeg-js";
import type { StoredCharacter } from "../../website/src/app/api";
import type { CharacterSummary, Journey } from "../../website/src/lib/journey";
import { uploadMessage } from "../src/app";
import { prepareImage, shotId } from "../src/images";
import { sync, type Client, type ShotMeta, type ShotSource } from "../src/sync";
import type { PreparedImage } from "../src/images";
import { listSaved, readSaved, signature } from "../src/wow";

// The website's sample account, laid out as a _forever_ folder.
const FOREVER = join(import.meta.dir, "..", "..", "website", "samples");

function tinyJpeg(seed: number): Uint8Array {
  const data = new Uint8Array(64 * 36 * 4).map((_, i) => (i * seed) % 255);
  return new Uint8Array(jpeg.encode({ width: 64, height: 36, data }, 80).data);
}

// The site, kept in memory.
class FakeSite implements Client {
  chars = new Map<string, StoredCharacter>();
  journeys = new Map<string, Journey>();
  shots = new Map<string, Map<string, ShotMeta>>();
  boards = new Map<string, number>();
  friends: unknown;
  calls: string[] = [];

  async characters() {
    return [...this.chars.values()];
  }
  async journey(key: string) {
    return this.journeys.get(key);
  }
  async screenshotIds(key: string) {
    return [...(this.shots.get(key)?.keys() ?? [])];
  }
  async saveJourney(j: Journey, summary: CharacterSummary) {
    this.calls.push(`journey ${j.character.name}`);
    this.journeys.set(j.character.key, j);
    this.chars.set(j.character.key, { key: j.character.key, summary, isPublic: false, slug: null, updatedAt: 0, hasJourney: true });
  }
  async saveBoards(key: string, entries: unknown[]) {
    this.boards.set(key, entries.length);
  }
  async saveScreenshot(key: string, img: PreparedImage, meta: ShotMeta) {
    this.calls.push(`shot ${meta.file}`);
    if (!this.shots.has(key)) this.shots.set(key, new Map());
    this.shots.get(key)!.set(img.id, meta);
  }
  async saveFriends(lists: unknown) {
    this.calls.push("friends");
    this.friends = lists;
  }
}

async function shotFiles(names: string[]): Promise<ShotSource[]> {
  return names.map((name, i) => {
    const bytes = tinyJpeg(i + 3);
    return { name, size: bytes.length, mtime: 1, read: async () => bytes };
  });
}

function options(known = new Set<string>(), friendsHash?: string) {
  return { shots: true, known, friendsHash, idOf: async (f: ShotSource) => shotId(await f.read()), prepare: async (f: ShotSource) => prepareImage(f.name, await f.read()) };
}

describe("finding the saved files", () => {
  it("lists every character's and the account's files with paths the parsers read", async () => {
    const files = await listSaved(FOREVER);
    const rels = files.map((f) => f.rel).sort();
    expect(rels).toContain("WTF/Account/SAMPLEACCOUNT/SavedVariables/RoadToSixty.lua");
    expect(rels).toContain("WTF/Account/SAMPLEACCOUNT/SampleRealm/Brannoc/SavedVariables/JourneyForever.lua");
    expect(rels).toContain("WTF/Account/SAMPLEACCOUNT/SampleRealm/Lyssira/SavedVariables/RoadToSixty.lua");
    expect(signature(files)).toBe(signature([...files].reverse()));
  });
});

describe("one upload", () => {
  it("saves each character, its leaderboard numbers and matched screenshots, then nothing the second time", async () => {
    const saved = await readSaved(await listSaved(FOREVER));
    const site = new FakeSite();
    const { readUpload } = await import("../../website/src/lib/parse/upload");
    const brannoc = readUpload(saved).journeys.find((j) => j.character.name === "Brannoc")!;
    const logged = brannoc.events.filter((e) => e.k === "shot" && !e.failed && typeof e.shot === "string").map((e) => `${e.shot}.jpg`);
    expect(logged.length).toBeGreaterThan(0);
    const shots = await shotFiles([...logged, "WoWScrnShot_010101_000000.jpg", "holiday.png"]);

    const second = await sync(site, saved, shots, options());
    expect(second.characters.map((c) => c.name).sort()).toEqual(["Brannoc", "Lyssira"]);
    expect(second.characters.every((c) => c.isNew)).toBe(true);
    expect(second.skippedPreLaunch).toBe(0);
    expect(site.boards.size).toBe(2);
    expect(second.shots).toBe(new Set(logged).size);
    expect(site.calls.filter((c) => c.startsWith("shot"))).toHaveLength(second.shots);

    const msg = uploadMessage(second, "https://site");
    expect(msg!.title).toBe("Uploaded 2 characters");
    expect(msg!.url).toBe("https://site/characters");

    // Same files again: up to date, and the screenshots are known.
    site.calls = [];
    const third = await sync(site, saved, shots, options(new Set(second.shotIds), second.friendsHash));
    expect(third.characters).toHaveLength(0);
    expect(third.shots).toBe(0);
    expect(site.calls).toEqual([]);
    expect(uploadMessage(third, "https://site")).toBeUndefined();

    // Forgotten here but already on the site (another PC uploaded them): not sent again.
    const fourth = await sync(site, saved, shots, options(new Set(), second.friendsHash));
    expect(fourth.shots).toBe(0);
    expect(fourth.shotIds.length).toBe(second.shots);
  });

  it("leaves screenshots alone when they're switched off", async () => {
    const saved = await readSaved(await listSaved(FOREVER));
    const site = new FakeSite();
    const shots = await shotFiles(["WoWScrnShot_110426_183015.jpg"]);
    const r = await sync(site, saved, shots, { ...options(), shots: false, idOf: async () => { throw new Error("read"); } });
    expect(r.shots).toBe(0);
  });
});

describe("the notification", () => {
  it("names one character's levels, time and screenshots", () => {
    const m = uploadMessage(
      { characters: [{ key: "Adom-Toretto", name: "Adom", fromLevel: 23, toLevel: 25, played: 8040, isNew: false, fillsGap: false }], shots: 4, shotIds: [], notes: [], skippedPreLaunch: 0 },
      "https://site",
    )!;
    expect(m.title).toBe("Adom's journey is up to date");
    expect(m.body).toBe("Level 23 → 25 · 2h 14m played · 4 screenshots");
    expect(m.url).toBe("https://site/c/Adom-Toretto");
  });
});
