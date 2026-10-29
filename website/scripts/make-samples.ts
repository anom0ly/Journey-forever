// Writes made-up saved files in samples/, laid out as a WTF\Account folder,
// for tests and for trying the upload page without playing. The characters,
// realm and account are invented. Run: node --experimental-strip-types scripts/make-samples.ts
//
// The layouts follow the addons' own format notes (Road to Sixty 1.15,
// Journey Tracker 0.6, Journey Forever 1); the output imitates how the game
// writes SavedVariables: tabs, ["key"] = value, and "-- [n]" after list items.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

type V = string | number | boolean | null | V[] | { [k: string]: V };

function lua(v: V, depth: number): string {
  const pad = "\t".repeat(depth);
  if (v === null) return "nil";
  if (typeof v === "string") return JSON.stringify(v).replace(/\\u([0-9a-f]{4})/g, (_, h) => `\\${parseInt(h, 16)}`);
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  const lines: string[] = [];
  if (Array.isArray(v)) {
    v.forEach((x, i) => lines.push(`${pad}\t${lua(x, depth + 1)}, -- [${i + 1}]`));
  } else {
    for (const [k, x] of Object.entries(v)) {
      const key = /^\d+$/.test(k) ? `[${k}]` : `[${JSON.stringify(k)}]`;
      lines.push(`${pad}\t${key} = ${lua(x, depth + 1)},`);
    }
  }
  return lines.length ? `{\n${lines.join("\n")}\n${pad}}` : "{\n" + pad + "}";
}

function file(globals: Record<string, V>): string {
  return Object.entries(globals).map(([k, v]) => `\n${k} = ${lua(v, 0)}\n`).join("");
}

// A deterministic stand-in for Math.random, so the samples never change.
let seed = 42;
function rand(): number {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
}

const START = Date.UTC(2026, 10, 4, 18, 0, 0) / 1000; // launch day, 4 Nov 2026

interface Walk {
  m: "w" | "t" | "g";
  c: number;
  t: number;
  from: [number, number];
  to: [number, number];
  seconds: number;
  j?: string;
}

// A segment walking (with some wander) from one point to another.
function segment(w: Walk): { seg: Record<string, V>; end: [number, number]; t: number } {
  const steps = Math.max(1, Math.round(w.seconds / (w.m === "t" ? 4 : 6)));
  let [x, y] = w.from;
  const parts: string[] = [];
  let t = w.t;
  for (let i = 1; i <= steps; i++) {
    const tx = w.from[0] + ((w.to[0] - w.from[0]) * i) / steps + (w.m === "t" ? 0 : (rand() - 0.5) * 14);
    const ty = w.from[1] + ((w.to[1] - w.from[1]) * i) / steps + (w.m === "t" ? 0 : (rand() - 0.5) * 14);
    const nx = Math.round(tx), ny = Math.round(ty);
    const dt = Math.max(1, Math.round(w.seconds / steps));
    parts.push(`${dt},${nx - x},${ny - y}`);
    x = nx;
    y = ny;
    t += dt;
  }
  const seg: Record<string, V> = { m: w.m, c: w.c, t: w.t, x: w.from[0], y: w.from[1], d: parts.join(";") };
  if (w.j) seg.j = w.j;
  return { seg, end: [x, y], t };
}

const link = (id: number, name: string, color: string) => `|cff${color}|Hitem:${id}::::::::10:::::::::|h[${name}]|h|r`;

function brannoc() {
  // Dwarf paladin: Coldridge Valley, Kharanos, Ironforge, then Loch Modan.
  const segs: Record<string, V>[] = [];
  const events: V[] = [];
  const kills: string[] = [];
  const killNames = ["Rockjaw Trogg", "Burly Rockjaw Trogg", "Small Crag Boar", "Frostmane Troll Whelp", "Ice Claw Bear", "Mangy Wolf", "Tunnel Rat Kobold"];
  let lastKill = 0;
  let level = 1;
  const levels: Record<string, V> = {};
  const ev = (t: number, kind: string, pos: [number, number] | null, ...fields: V[]) =>
    events.push([t, kind, pos ? 0 : -1, pos ? pos[0] : 0, pos ? pos[1] : 0, ...fields]);
  const dingAt: Record<number, number> = {};
  const deathsAt: number[] = [];
  const ding = (t: number, pos: [number, number]) => {
    level++;
    dingAt[level] = t;
    ev(t, "lvl", pos, level);
    levels[level] = { t, money: level * 1350, kills: kills.length, quests: level * 3, deaths: 0, distance: 0, flown: 0, gear: {}, links: {} };
  };
  const kill = (t: number, xp: number) => {
    const n = Math.floor(rand() * killNames.length);
    kills.push(`${t - lastKill},${xp},${n + 1};`);
    lastKill = t;
  };

  // Session 1: Coldridge Valley to Kharanos.
  let t = START;
  let pos: [number, number] = [-6240, 330];
  levels[1] = { t, money: 0, gear: {}, links: {}, kills: 0, quests: 0, deaths: 0, distance: 0, flown: 0 };
  ev(t, "on", pos, 1);
  ev(t + 2, "zone", pos, 1426);
  const route1: [number, number][] = [[-6180, 380], [-6080, 420], [-6120, 520], [-5980, 600], [-5850, 470], [-5720, 120], [-5600, -480]];
  let quest = 179;
  for (const [i, to] of route1.entries()) {
    const s = segment({ m: "w", c: 0, t, from: pos, to, seconds: 420, j: i === 0 ? "l" : undefined });
    segs.push(s.seg);
    for (let k = 0; k < 6; k++) kill(t + 40 + k * 55, 40 + level * 6);
    ev(t + 60, "qa", pos, quest);
    ev(s.t - 20, "qd", s.end, quest, 80 + level * 25, 15 * level, `Sample Quest ${i + 1}`);
    quest++;
    if (i % 2 === 1) ding(s.t - 10, s.end);
    t = s.t + 5;
    pos = s.end;
  }
  ev(t, "loot", pos, link(2361, "Battleworn Hammer", "1eff00"), 2, null);
  ev(t + 4, "eq", pos, 16, 2361, "item:2361::::::::5:::::::::", null, { how: "drop", t: t, c: 0, x: pos[0], y: pos[1], name: "Rockjaw Trogg", kind: "Creature", id: 707 });
  // A death and the ghost run back.
  ev(t + 30, "die", pos);
  deathsAt.push(t + 30);
  const ghost = segment({ m: "g", c: 0, t: t + 60, from: [-5650, -350], to: pos, seconds: 70, j: "d" });
  segs.push(ghost.seg);
  t = ghost.t + 30;
  ev(t, "prof", pos, "Mining", 1, 75, null);
  ev(t + 5, "gj", pos, "The Sample Guild", "Initiate", null);
  ev(t + 10, "off", pos);
  const end1 = t + 10;

  // Session 2, next evening: Ironforge, a flight to Thelsamar, Loch Modan.
  t = START + 86400 + 3600;
  ev(t, "on", pos, level);
  const s2a = segment({ m: "w", c: 0, t, from: pos, to: [-4980, -880], seconds: 600, j: "l" });
  segs.push(s2a.seg);
  ev(s2a.t - 30, "zone", s2a.end, 1455);
  ding(s2a.t - 5, s2a.end);
  t = s2a.t + 60;
  pos = s2a.end;
  const fly = segment({ m: "t", c: 0, t, from: [-4820, -1150], to: [-5420, -2930], seconds: 180 });
  segs.push(fly.seg);
  t = fly.t + 5;
  pos = fly.end;
  ev(t, "zone", pos, 1432);
  const route2: [number, number][] = [[-5300, -3100], [-5200, -3300], [-5500, -3450], [-5650, -3200], [-5380, -2980]];
  for (const [i, to] of route2.entries()) {
    const s = segment({ m: "w", c: 0, t, from: pos, to, seconds: 540 });
    segs.push(s.seg);
    for (let k = 0; k < 7; k++) kill(t + 30 + k * 60, 70 + level * 8);
    ev(t + 50, "qa", pos, quest);
    ev(s.t - 15, "qd", s.end, quest, 300 + level * 30, 50 * level, `Sample Loch Quest ${i + 1}`);
    quest++;
    if (i === 1 || i === 3) ding(s.t - 5, s.end);
    if (i === 2) ev(s.t - 2, "rare", s.end, "Sample Rare Boar", "rare", 12, 90001, "x");
    t = s.t + 5;
    pos = s.end;
  }
  // A dungeon run with a group (the members are other players: the site keeps only how many).
  ev(t, "grp", pos, "party", [["Player-0000-0000AAAA", "Groupmate-Elsewhere", "Human", "Female", "PRIEST", 12, null, null]], null, null);
  ev(t + 60, "in", pos, 90, "Gnomeregan", "party");
  const runEnd = t + 60 + 3900;
  ev(runEnd - 1500, "die", pos);
  deathsAt.push(runEnd - 1500);
  ev(runEnd, "loot", pos, link(9490, "Sample Epic Gizmo", "a335ee"), 4, 90);
  ev(runEnd + 30, "out", pos, 90, {
    name: "Gnomeregan", duration: 3930, kills: 64, xp: 9800, deaths: 1, money: 2210, levels: 1,
    items: [link(9490, "Sample Epic Gizmo", "a335ee"), link(9508, "Sample Blue Belt", "0070dd")],
    party: ["Player-0000-0000AAAA", "Player-0000-0000BBBB"], type: "party",
  });
  ding(runEnd - 600, pos);
  t = runEnd + 120;
  ev(t, "grpx", pos, { duration: 4100, kills: 64, xp: 9800, quests: 0, deaths: 1, instances: 1, met: ["Player-0000-0000AAAA"], levels: {} });
  ev(t + 20, "rep", pos, 47, 5, "Ironforge", true);
  ev(t + 30, "off", pos);

  return {
    char: {
      version: 4,
      addon: "1.15.0",
      journeyId: "Player-0000-00SAMPLE:0",
      class: "PALADIN",
      segments: segs,
      events,
      levels,
      kills: { d: kills.join(""), last: lastKill, names: killNames },
      recipes: {},
      people: { "Player-0000-0000AAAA": { name: "Groupmate-Elsewhere", class: "PRIEST" } },
      totals: { kills: kills.length, killXP: 20000, questXP: 9000, deaths: 1, quests: quest - 179, instances: 1, distance: 9000, flown: 1900 },
      lastZone: 1432,
      played: 6 * 3600,
    } as V,
    end1,
    end: t + 30,
    level,
    dingAt,
    deathsAt,
  };
}

function brannocJT(rtsEnd: number, level: number, deathsAt: number[]) {
  const dings: Record<string, V> = {};
  const levels: Record<string, V> = {};
  let played = 0;
  for (let l = 1; l <= level; l++) {
    const secs = 600 + l * 420;
    levels[l] = { xp: 400 * l, kills: 6 + l, quests: 3, deaths: l === 3 ? 1 : 0, ...(l < level ? { played: secs } : {}) };
    if (l > 1) dings[l] = { t: START + l * 1800, zone: l < 5 ? "Dun Morogh" : "Loch Modan", subzone: "", mapID: l < 5 ? 1426 : 1432, x: 40.2, y: 55.1, cause: "quest", gold: l * 1350, xpTotal: l * 900, kills: l * 8, deaths: l > 3 ? 1 : 0, quests: l * 3, grouped: false, played };
    played += secs;
  }
  return {
    schemaVersion: 1,
    characterId: "00000000-0000-4000-8000-000000000000",
    firstSeen: START,
    char: { guid: "Player-0000-00SAMPLE", name: "Brannoc", realm: "Sample Realm", class: "PALADIN", race: "Dwarf" },
    played: { total: played, levelStart: played - 900 },
    dings,
    levels,
    sessions: { list: [{ start: START, last: START + 4 * 3600, startLevel: 1, levels: 3 }, { start: START + 90000, last: rtsEnd, startLevel: 4, levels: level - 4 }] },
    time: { afk: 320, resting: 1800, taxi: 180, mounted: 0, dead: 140, grouped: 4100, solo: 14000, combat: 5200, corpseRuns: 1 },
    hours: { 18: 3600, 19: 3600, 20: 2400 },
    days: { "2026-11-04": true, "2026-11-05": true },
    xp: { total: 29000, quest: 9000, kill: 20000, explore: 300, other: 0, solo: 19000, grouped: 10000, restedUsed: 2400 },
    kills: { total: 74, byName: { "Rockjaw Trogg": 21, "Small Crag Boar": 14, "Mangy Wolf": 11, "Tunnel Rat Kobold": 9 }, byClass: { elite: 12, rare: 1 }, byType: { Humanoid: 40, Beast: 34 } },
    combat: { fights: 70, longest: 48, died: 1, ambushMobs: 3, multiPulls: 9, maxMobs: 3 },
    deaths: [
      { t: deathsAt[0] + 4, level: 3, zone: "Dun Morogh", subzone: "Coldridge Pass", mapID: 1426, x: 44, y: 60, killer: "Burly Rockjaw Trogg", grouped: false },
      { t: deathsAt[1] + 2, level: level - 1, zone: "Gnomeregan", subzone: "", killer: "Sample Boss", grouped: true, dungeon: "Gnomeregan" },
    ],
    quests: { completed: 10, xp: 9000, money: 9100, accepted: 12, abandoned: 1, byZone: {}, byTag: {}, open: {} },
    zones: { "Dun Morogh": { first: START, seconds: 9000, firstLevel: 1 }, "Loch Modan": { first: START + 92000, seconds: 6000, firstLevel: 6 } },
    travel: { hearths: 1, flights: 1, flightPaths: {}, ground: 9100, taxi: 1900 },
    dungeons: { entered: { Gnomeregan: 1 }, runs: [{ name: "Gnomeregan", start: rtsEnd - 4100, level: level - 1, bosses: 4, deaths: 1, duration: 3930 }] },
    money: { earned: 52000, spent: 31000, loot: 21000, vendor: 14500, vendorSpent: 4200, training: 16500, repairs: 5800, flights: 900, auctionSpent: 0, mail: 0, auctionIncome: 0, auctionsSold: 0, peak: 24000, last: 21000 },
    loot: { items: 214, byQuality: { 0: 80, 1: 118, 2: 13, 3: 2, 4: 1 } },
    professions: { Mining: { level: 3, time: START + 3 * 3600 } },
    where: { 1426: { 312: 900, 313: 1200, 338: 600 }, 1432: { 400: 1800 } },
    social: { seen: {}, unique: 3, jumps: 210 },
    falls: { count: 4, total: 12, fatal: 0 },
  } as V;
}

// As addon/FORMAT.md lays it out: keyed entries with the file name each
// screenshot should get (UTC here, as utcOffset is 0).
function shotName(t: number): string {
  const d = new Date(t * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `WoWScrnShot_${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCFullYear() % 100)}_${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

function brannocJF(rtsEnd: number, dingAt: Record<number, number>) {
  const shot = (t: number, kind: string, detail: Record<string, V>, place: Record<string, V>) => ({
    t, kind, detail, shot: shotName(t), ok: true, hiddenUI: true, ...place,
  });
  return {
    schemaVersion: 1,
    addon: "1.0.0",
    utcOffset: 0,
    char: { guid: "Player-0000-00SAMPLE", name: "Brannoc", realm: "SampleRealm", class: "PALADIN", race: "Dwarf", faction: "Alliance", level: 8 },
    screenshots: [
      shot(dingAt[3] + 1, "level", { level: 3 }, { mapID: 1426, x: 0.41, y: 0.55, zone: "Dun Morogh", level: 3 }),
      shot(rtsEnd - 149, "epic", { item: "item:9490::::::::8:::::", itemID: 9490, name: "Sample Epic Gizmo", quality: 4 }, { mapID: 226, zone: "Gnomeregan", level: 8 }),
      shot(rtsEnd - 145, "dungeon", { instance: "Gnomeregan", instanceID: 90, boss: "Sample Boss", via: "encounter" }, { mapID: 226, zone: "Gnomeregan", level: 8 }),
    ],
    notes: [{ t: START + 1500, text: "Made it out of Coldridge Valley!", mapID: 1426, x: 0.46, y: 0.5, zone: "Dun Morogh", level: 2 }],
    paused: false,
  } as V;
}

function lyssira() {
  // Night elf mage on Kalimdor, Road to Sixty only (no Journey Tracker).
  const segs: Record<string, V>[] = [];
  const events: V[] = [];
  let t = START + 7200;
  let pos: [number, number] = [10330, 830];
  events.push([t, "on", 1, pos[0], pos[1], 1]);
  events.push([t + 1, "zone", 1, pos[0], pos[1], 1438]);
  const route: [number, number][] = [[10200, 900], [10050, 950], [9870, 980], [9750, 1150]];
  let level = 1;
  for (const [i, to] of route.entries()) {
    const s = segment({ m: "w", c: 1, t, from: pos, to, seconds: 600, j: i === 0 ? "l" : undefined });
    segs.push(s.seg);
    events.push([s.t - 10, "qd", 1, s.end[0], s.end[1], 3100 + i, 200, 40, `Sample Grove Quest ${i + 1}`]);
    level++;
    events.push([s.t - 5, "lvl", 1, s.end[0], s.end[1], level]);
    t = s.t + 5;
    pos = s.end;
  }
  events.push([t, "off", 1, pos[0], pos[1]]);
  return {
    version: 4,
    addon: "1.15.0",
    journeyId: "Player-0000-00SAMPL2:0",
    class: "MAGE",
    segments: segs,
    events,
    levels: {},
    kills: { d: "", last: 0, names: {} },
    recipes: {},
    people: {},
    totals: { kills: 0, killXP: 0, questXP: 800, deaths: 0, quests: 4, instances: 0, distance: 1800, flown: 0 },
  } as V;
}

const root = join(dirname(new URL(import.meta.url).pathname), "..", "samples", "WTF", "Account", "SAMPLEACCOUNT");
function write(rel: string, globals: Record<string, V>) {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, file(globals));
}

const b = brannoc();
write("SampleRealm/Brannoc/SavedVariables/RoadToSixty.lua", { RoadToSixtyCharDB: b.char });
write("SampleRealm/Brannoc/SavedVariables/JourneyTracker.lua", { JourneyTrackerDB: brannocJT(b.end, b.level, b.deathsAt), JourneyTrackerBackup: {} });
write("SampleRealm/Brannoc/SavedVariables/JourneyForever.lua", { JourneyForeverDB: brannocJF(b.end, b.dingAt) });
write("SampleRealm/Lyssira/SavedVariables/RoadToSixty.lua", { RoadToSixtyCharDB: lyssira() });
write("SavedVariables/RoadToSixty.lua", {
  RoadToSixtyDB: {
    greet: true,
    pc: "abcdef123456",
    roster: {
      "Player-0000-00SAMPLE": { name: "Brannoc", realm: "Sample Realm", guid: "Player-0000-00SAMPLE", class: "PALADIN", level: b.level },
      "Player-0000-00SAMPL2": { name: "Lyssira", realm: "Sample Realm", guid: "Player-0000-00SAMPL2", class: "MAGE", level: 5 },
    },
  },
});
console.log("Wrote samples to", root);
