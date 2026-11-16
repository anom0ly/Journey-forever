// A made-up level 60 journey: the sample journey, then nine days at 60 with
// raids, dungeons, gear, gold, reputation and an epic mount.

import type { JEvent, Journey } from "../src/lib/journey";
import { readUpload } from "../src/lib/parse/upload";
import { sampleFiles } from "./samples";

export const T60 = 1794692520; // Sat 14 Nov 2026, 21:42 UTC
const H = 3600, D = 86400;

const item = (id: number, name: string, q: number) => ({ id, name, quality: q });

export type Mode = "all" | "rtsjf" | "rts";

export function sixtyJourney(mode: Mode = "all"): Journey {
  const base = readUpload(sampleFiles(), 1800000000).journeys[0];
  const j: Journey = structuredClone(base);
  j.character.level = 60;
  j.levels = [...j.levels.filter((l) => l.level < 60), { level: 60, t: T60, played: 6 * D + 2 * H, zone: "Winterspring", money: 3_200_000 }];
  const ev: JEvent[] = [];
  const sessions = j.sessions.filter((s) => s.end < T60);
  const session = (start: number, hours: number, from: number, to: number) => {
    sessions.push({ start, end: start + hours * H, startLevel: 60, endLevel: 60 });
    ev.push({ t: start, k: "on", level: 60, money: from }, { t: start + hours * H, k: "off", money: to });
  };
  ev.push({ t: T60, k: "lvl", level: 60 });
  session(T60 + 600, 3, 3_200_000, 3_600_000);
  ev.push({ t: T60 + 2000, k: "qd", questID: 7848, xp: 0, money: 0, title: "Attunement to the Core" });
  ev.push({ t: T60 + 3000, k: "eq", slot: 2, itemID: 15411, item: item(15411, "Mark of Fordring", 2), how: "quest" });

  const run = (t: number, name: string, id: number, type: string, dur: number, deaths: number, items: ReturnType<typeof item>[], money: number, size: number) => {
    ev.push({ t, k: "in", instanceID: id, name, type });
    for (const it of items) ev.push({ t: t + dur - 300, k: "loot", item: it, instanceID: id });
    ev.push({ t: t + dur, k: "out", instanceID: id, run: { name, duration: dur, kills: 0, deaths, money, items, groupSize: size, type } });
  };
  // Sun 15 Nov: Molten Core, 4 bosses
  session(T60 + D - 2 * H, 5, 3_600_000, 3_900_000);
  run(T60 + D - H, "Molten Core", 409, "raid", 3 * H + 1200, 3, [item(16854, "Lawbringer Helm", 4)], -250_000, 40);
  ev.push({ t: T60 + D + 3 * H, k: "eq", slot: 1, itemID: 16854, item: item(16854, "Lawbringer Helm", 4), how: "roll" });
  // Mon 16 Nov: dungeons
  session(T60 + 2 * D, 5, 3_900_000, 4_400_000);
  run(T60 + 2 * D + 600, "Stratholme", 329, "party", 6060, 0, [item(18420, "Hammer of the Grand Crusader", 3)], 210_000, 5);
  ev.push({ t: T60 + 2 * D + 6800, k: "eq", slot: 16, itemID: 18420, item: item(18420, "Hammer of the Grand Crusader", 3), how: "drop" });
  run(T60 + 2 * D + 8000, "Blackrock Spire", 229, "party", 7500, 1, [item(12927, "Truestrike Shoulders", 3)], 140_000, 10);
  ev.push({ t: T60 + 2 * D + 15600, k: "eq", slot: 3, itemID: 12927, item: item(12927, "Truestrike Shoulders", 3), how: "drop" });
  ev.push({ t: T60 + 2 * D + 16000, k: "rep", factionID: 47, standing: 8, name: "Ironforge", up: true });
  // Tue 17 Nov: Molten Core, 7 bosses
  session(T60 + 3 * D - 2 * H, 5, 4_400_000, 8_700_000);
  run(T60 + 3 * D - H, "Molten Core", 409, "raid", 3 * H + 1320, 4, [item(16857, "Lawbringer Chestguard", 4), item(16859, "Lawbringer Boots", 4)], -380_000, 40);
  ev.push({ t: T60 + 3 * D + 3 * H, k: "eq", slot: 5, itemID: 16857, item: item(16857, "Lawbringer Chestguard", 4), how: "roll" });
  ev.push({ t: T60 + 3 * D + 3 * H + 10, k: "eq", slot: 8, itemID: 16859, item: item(16859, "Lawbringer Boots", 4), how: "roll" });
  ev.push({ t: T60 + 3 * D + 3 * H + 60, k: "rep", factionID: 749, standing: 6, name: "Hydraxian Waterlords", up: true });
  // Wed 18 Nov: epic mount
  session(T60 + 4 * D, 3, 8_700_000, 1_000_000);
  ev.push({ t: T60 + 4 * D + H, k: "mount", name: "Swift Gray Ram" });
  ev.push({ t: T60 + 4 * D + 2 * H, k: "rep", factionID: 59, standing: 5, name: "Thorium Brotherhood", up: true });
  // Thu 19 Nov: Onyxia
  session(T60 + 5 * D - H, 3, 1_000_000, 1_400_000);
  run(T60 + 5 * D, "Onyxia's Lair", 249, "raid", 3840, 2, [item(18083, "Ringo's Blizzard Boots", 4)], 30_000, 40);
  ev.push({ t: T60 + 5 * D + 5000, k: "rare", name: "Lord Captain Wyrmak", classification: "rareelite", level: 59 });
  // Sat 21 Nov
  session(T60 + 7 * D, 4, 1_400_000, 2_600_000);
  ev.push({ t: T60 + 7 * D + 2 * H, k: "rep", factionID: 529, standing: 7, name: "Argent Dawn", up: true });
  ev.push({ t: T60 + 7 * D + 3 * H, k: "rep", factionID: 529, standing: 8, name: "Argent Dawn", up: true });

  j.events = [...j.events.filter((e) => e.t < T60), ...ev].sort((a, b) => a.t - b.t);
  j.sessions = sessions.sort((a, b) => a.start - b.start);
  j.zones = { ...j.zones, i409: "Molten Core", i329: "Stratholme", i229: "Blackrock Spire", i249: "Onyxia's Lair" };

  if (mode !== "rts") {
    // Our addon's dungeon screenshots: each raid's last boss (Onyxia), and, with
    // the boss screenshot on, every boss.
    const shot = (t: number, boss: string, kind = "boss") => ev.push({ t, k: "shot", kind, detail: { boss, instance: "x" } });
    const mc1 = ["Lucifron", "Magmadar", "Gehennas", "Garr"], mc2 = [...mc1, "Baron Geddon", "Shazzrah", "Sulfuron Harbinger"];
    mc1.forEach((b, i) => shot(T60 + D - H + 1200 + i * 1500, b));
    mc2.forEach((b, i) => shot(T60 + 3 * D - H + 1000 + i * 1300, b));
    ev.push({ t: T60 + 5 * D + 3000, k: "shot", kind: "dungeon", detail: { boss: "Onyxia", via: "encounter" } });
    j.events = [...j.events.filter((e) => e.t < T60), ...ev].sort((a, b) => a.t - b.t);
  }
  if (mode === "all") {
    j.stats = {
      ...j.stats,
      runs: [
        { name: "Molten Core", start: T60 + D - H + 60, level: 60, duration: 3 * H + 1200, bosses: 4, deaths: 3 },
        { name: "Stratholme", start: T60 + 2 * D + 650, level: 60, duration: 6060, bosses: 6, deaths: 0 },
        { name: "Blackrock Spire", start: T60 + 2 * D + 8050, level: 60, duration: 7500, bosses: 7, deaths: 1 },
        { name: "Molten Core", start: T60 + 3 * D - H + 60, level: 60, duration: 3 * H + 1320, bosses: 7, deaths: 4 },
        { name: "Onyxia's Lair", start: T60 + 5 * D + 60, level: 60, duration: 3840, bosses: 1, deaths: 2 },
      ],
      bosses: {
        Lucifron: { attempts: 2, kills: 2, wipes: 0 }, Magmadar: { attempts: 3, kills: 2, wipes: 1 }, Gehennas: { attempts: 2, kills: 2, wipes: 0 },
        Garr: { attempts: 4, kills: 2, wipes: 2 }, "Baron Geddon": { attempts: 1, kills: 1, wipes: 0 }, Shazzrah: { attempts: 1, kills: 1, wipes: 0 },
        "Sulfuron Harbinger": { attempts: 2, kills: 1, wipes: 1 }, Golemagg: { attempts: 1, kills: 0, wipes: 1 }, Onyxia: { attempts: 4, kills: 2, wipes: 2 },
        "Baron Rivendare": { attempts: 1, kills: 1, wipes: 0 },
      },
      worn: { 16854: 2 * D + 5 * H, 18420: 4 * D, 12927: 3 * D + 2 * H, 16857: D + 4 * H, 16859: D + 4 * H, 15411: 6 * D },
      money: { ...j.stats.money, repairs: 1_460_000, auctionIncome: 5_120_000, loot: 3_180_000 },
    };
    j.bossFirst = { Lucifron: { t: T60 + D - H + 60 } };
  } else {
    j.stats = {};
    j.pcStats = undefined;
  }
  if (mode === "rts") j.events = j.events.filter((e) => e.k !== "shot");
  return j;
}
