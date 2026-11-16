// Life at 60: what a character did after reaching the level cap. Levels and
// XP stop there, and so do kills (both addons count a kill from its XP
// message), so this reads what keeps coming: instance runs, raid bosses,
// gear, gold, reputation and mounts.
//
// Raid bosses come from Journey Tracker's boss counts (every boss fight the
// game announces, kills and wipes, no dates) or, without it, from our
// addon's boss and dungeon screenshot entries (exact times). Road to Sixty
// alone can't tell which bosses died.

import type { BossCount, Item, JEvent, Journey, RunSummary } from "./journey";
import { dungeonRuns } from "./clears";
import { itemName, zoneAt } from "./insights";
import { FACTIONS, RAIDS, type Raid } from "./sixtyLists";
import { goldStats, journeyEnd, journeyStart, levelTimes, playedBetween, zoneTimes, type GoldPoint } from "./stats";

export const CAP = 60;

// ---------------------------------------------------------------- raids

const RAID_BY_NAME = new Map<string, Raid>();
const RAID_BY_BOSS = new Map<string, Raid>();
for (const r of RAIDS) {
  for (const n of [r.name, ...r.aliases]) RAID_BY_NAME.set(n.toLowerCase(), r);
  for (const b of r.bosses) RAID_BY_BOSS.set(b.toLowerCase(), r);
}

export function raidNamed(name: string | undefined): Raid | undefined {
  return name ? RAID_BY_NAME.get(name.toLowerCase()) : undefined;
}

export function raidOfBoss(boss: string): Raid | undefined {
  return RAID_BY_BOSS.get(boss.toLowerCase());
}

// The boss's name as the table spells it.
function bossKey(name: string): string | undefined {
  const r = raidOfBoss(name);
  return r?.bosses.find((b) => b.toLowerCase() === name.toLowerCase());
}

// ---------------------------------------------------------------- reputation

export const STANDINGS = ["", "Hated", "Hostile", "Unfriendly", "Neutral", "Friendly", "Honored", "Revered", "Exalted"];
export const EXALTED = 8;

// ---------------------------------------------------------------- milestones

// Mounts that run at the faster speed. The client gives the mount's name.
const EPIC_MOUNT = /^(Swift |Great .*Kodo|Black War |Frostwolf Howler|Stormpike Battle Charger|.*Skeletal Warhorse|Deathcharger|Charger$|Summon Charger|Dreadsteed|Summon Dreadsteed|Black Qiraji|.*Battle Tank|Ivory Raptor|Fiery Warhorse)/;

export function isEpicMount(name: unknown): boolean {
  return typeof name === "string" && EPIC_MOUNT.test(name);
}

// Quests whose turn-in opens a raid or dungeon.
export const ATTUNEMENTS: Record<string, string> = {
  "Attunement to the Core": "Molten Core",
  "Drakefire Amulet": "Onyxia's Lair",
  "Blood of the Black Dragon Champion": "Onyxia's Lair",
  "Blackhand's Command": "Blackwing Lair",
  "The Key to Scholomance": "Scholomance",
  "Seal of Ascension": "Upper Blackrock Spire",
};

const CITIES = new Set(["Stormwind City", "Ironforge", "Darnassus", "Orgrimmar", "Thunder Bluff", "Undercity", "Shattrath City"]);

// ---------------------------------------------------------------- the numbers

export interface SixtyRun {
  start: number;
  name: string;
  raid: boolean;
  duration?: number;
  deaths?: number;
  groupSize?: number;
  bosses?: number; // Journey Tracker's boss kills in the run
  items: Item[]; // green and up
  money?: number; // copper gained (negative: lost) inside
}

export interface BossRow {
  name: string;
  kills: number;
  wipes?: number; // Journey Tracker only
  first?: { t: number; by?: boolean; exact?: boolean };
}

export interface RaidRow {
  raid: Raid;
  bosses: BossRow[];
  killed: number; // different bosses killed
  visits: number;
  inside: number; // seconds inside, all visits
  deaths: number;
  epics: number;
  firstVisit?: number;
  lastVisit?: number;
  firstBoss?: { t: number; by?: boolean };
}

export interface GearSlot {
  slot: number;
  label: string;
  item: Item;
  since: number;
  how?: string; // "Molten Core drop", "quest reward", ...
  worn?: number; // played seconds, Journey Tracker
}

export interface Upgrade {
  t: number;
  slot: string;
  item: Item;
  replaced?: Item;
  how?: string;
}

export interface RepRow {
  faction: string;
  standing: number;
  from?: number; // standing before the first change since 60
  t: number; // last change
}

export interface Milestone {
  t: number;
  title: string;
  sub?: string;
  tone: "gold" | "lilac" | "accent" | "teal";
}

export interface TimeSplit {
  label: string;
  seconds: number;
  color: string;
}

export interface SixtyStats {
  reached: number;
  zone?: string;
  playedTo60?: number;
  daysTo60?: number;
  playedSince: number;
  daysSince: number;
  runs: SixtyRun[]; // newest first
  dungeonRuns: number;
  topDungeon?: { name: string; n: number };
  raids: RaidRow[];
  bossSource?: "jt" | "shots"; // where the boss kills came from
  bossKills: number;
  bossesKilled: number;
  wipes?: number;
  raidVisits: number;
  epics: number;
  gear: GearSlot[];
  upgrades: Upgrade[]; // newest first
  slotsChanged: number;
  rarity: Record<number, number>;
  gold: GoldPoint[];
  goldAt60?: number;
  goldNow?: number;
  reps: RepRow[];
  exalted: string[];
  milestones: Milestone[]; // oldest first
  time: TimeSplit[];
  topZones: string[];
  epicMount?: { t: number; name: string; played?: number };
}

export function reachedCap(j: Journey): number | undefined {
  if (j.character.level < CAP) return undefined;
  return levelTimes(j).get(CAP) ?? j.stats.reachedMax;
}

const SLOT_NAMES: Record<number, string> = {
  1: "Head", 2: "Neck", 3: "Shoulder", 5: "Chest", 6: "Waist", 7: "Legs", 8: "Feet", 9: "Wrist", 10: "Hands",
  11: "Finger", 12: "Finger", 13: "Trinket", 14: "Trinket", 15: "Back", 16: "Main hand", 17: "Off hand", 18: "Ranged",
};

const HOW: Record<string, string> = {
  drop: "drop", quest: "quest reward", vendor: "bought", trade: "traded", mail: "from the mail", ah: "auction house", craft: "crafted", roll: "won on a roll",
};

const day = (t: number) => Math.floor(t / 86400);

// Our addon's boss and end-boss screenshot entries: exact kill times.
export function bossShots(j: Journey): { t: number; boss: string }[] {
  const out: { t: number; boss: string }[] = [];
  for (const e of j.events) {
    if (e.k !== "shot" || (e.kind !== "boss" && e.kind !== "dungeon")) continue;
    const d = e.detail as { boss?: unknown; via?: unknown } | undefined;
    if (typeof d?.boss !== "string") continue;
    if (e.kind === "dungeon" && d.via !== "encounter") continue;
    const boss = bossKey(d.boss);
    if (!boss) continue;
    // A boss kill that also cleared the place logs two entries at once.
    if (out.some((o) => o.boss === boss && Math.abs(o.t - e.t) < 30)) continue;
    out.push({ t: e.t, boss });
  }
  return out.sort((a, b) => a.t - b.t);
}

// Journey Tracker's boss counts, by the table's spelling.
function jtBosses(j: Journey): Map<string, BossCount> {
  const out = new Map<string, BossCount>();
  for (const [name, b] of Object.entries(j.stats.bosses ?? {})) {
    const key = bossKey(name);
    if (!key) continue;
    const had = out.get(key) ?? {};
    out.set(key, { attempts: (had.attempts ?? 0) + (b.attempts ?? 0), kills: (had.kills ?? 0) + (b.kills ?? 0), wipes: (had.wipes ?? 0) + (b.wipes ?? 0) });
  }
  return out;
}

// Journey Tracker's runs that line up with a run (its clock is the PC's,
// Road to Sixty's the realm's, so a few minutes either way).
const RUN_SLACK = 900;
function jtBossesIn(j: Journey, name: string, from: number, to: number): number | undefined {
  let n: number | undefined;
  const raid = raidNamed(name);
  for (const r of j.stats.runs ?? []) {
    const same = r.name === name || (raid && raidNamed(r.name) === raid);
    if (!same || r.start < from - RUN_SLACK || r.start > to + RUN_SLACK) continue;
    if (r.bosses !== undefined) n = (n ?? 0) + r.bosses;
  }
  return n;
}

export function sixtyStats(j: Journey): SixtyStats | undefined {
  const t60 = reachedCap(j);
  if (t60 === undefined) return undefined;
  const end = Math.max(journeyEnd(j), t60);
  const level60 = j.levels.find((l) => l.level === CAP);
  const start = journeyStart(j);

  // Runs
  const runs: SixtyRun[] = [];
  for (const r of dungeonRuns(j)) {
    if (r.start < t60) continue;
    const raid = !!raidNamed(r.name) || r.run?.type === "raid";
    const items = (r.run?.items ?? []).filter((i) => (i.quality ?? 0) >= 2);
    runs.push({
      start: r.start, name: r.name, raid, duration: r.duration, deaths: r.deaths, groupSize: r.groupSize,
      bosses: jtBossesIn(j, r.name, r.start, r.t), items, money: (r.run as RunSummary | undefined)?.money,
    });
  }
  // Without Road to Sixty: Journey Tracker's own runs (dungeonRuns falls back to them).
  runs.reverse();
  const dungeons = runs.filter((r) => !r.raid);
  const byDungeon = new Map<string, number>();
  for (const r of dungeons) byDungeon.set(r.name, (byDungeon.get(r.name) ?? 0) + 1);
  const top = [...byDungeon].sort((a, b) => b[1] - a[1])[0];

  // Raid bosses
  const counts = jtBosses(j);
  const shots = bossShots(j);
  const bossSource: SixtyStats["bossSource"] = counts.size ? "jt" : shots.length ? "shots" : undefined;
  const raids: RaidRow[] = [];
  for (const raid of RAIDS) {
    const visits = runs.filter((r) => raidNamed(r.name) === raid);
    const bosses: BossRow[] = raid.bosses.map((name) => {
      const c = counts.get(name);
      const mine = shots.filter((s) => s.boss === name);
      const stored = j.bossFirst?.[name];
      let first: BossRow["first"] = mine[0] ? { t: mine[0].t, exact: true } : undefined;
      if (stored && (!first || stored.t < first.t)) first = { t: stored.t, by: stored.by };
      return { name, kills: Math.max(c?.kills ?? 0, mine.length), wipes: c ? c.wipes ?? 0 : undefined, first };
    });
    const killed = bosses.filter((b) => b.kills > 0);
    if (!visits.length && !killed.length) continue;
    const dated = killed.filter((b) => b.first).sort((a, b) => a.first!.t - b.first!.t);
    raids.push({
      raid,
      bosses,
      killed: killed.length,
      visits: visits.length,
      inside: visits.reduce((n, r) => n + (r.duration ?? 0), 0),
      deaths: visits.reduce((n, r) => n + (r.deaths ?? 0), 0),
      epics: visits.reduce((n, r) => n + r.items.filter((i) => (i.quality ?? 0) >= 4).length, 0),
      firstVisit: visits.at(-1)?.start,
      lastVisit: visits[0]?.start,
      firstBoss: dated[0]?.first ? { t: dated[0].first.t, by: dated[0].first.by } : undefined,
    });
  }
  const allBosses = raids.flatMap((r) => r.bosses);

  // Gear
  const gearEvents = j.events.filter((e) => e.k === "eq" && typeof e.slot === "number");
  const current = new Map<number, JEvent>();
  const upgrades: Upgrade[] = [];
  const changed = new Set<string>();
  for (const e of gearEvents) {
    const slot = e.slot as number;
    const before = current.get(slot);
    if (typeof e.itemID !== "number" || e.itemID <= 0) {
      current.delete(slot);
      continue;
    }
    current.set(slot, e);
    if (e.t >= t60 && !e.late && SLOT_NAMES[slot]) {
      upgrades.push({ t: e.t, slot: SLOT_NAMES[slot], item: itemOf(j, e), replaced: before ? itemOf(j, before) : undefined, how: howOf(j, e) });
      changed.add(SLOT_NAMES[slot] + (slot === 12 || slot === 14 ? "2" : ""));
    }
  }
  const gear: GearSlot[] = [];
  const rarity: Record<number, number> = {};
  for (const [slot, e] of [...current].sort((a, b) => a[0] - b[0])) {
    if (!SLOT_NAMES[slot]) continue;
    const item = itemOf(j, e);
    if (item.quality !== undefined) rarity[item.quality] = (rarity[item.quality] ?? 0) + 1;
    gear.push({ slot, label: SLOT_NAMES[slot], item, since: e.t, how: howOf(j, e), worn: j.stats.worn?.[String(e.itemID)] });
  }

  // Gold
  const g = goldStats(j);
  const before60 = g.points.filter((p) => p.t <= t60).at(-1);
  const gold = [...(before60 ? [before60] : []), ...g.points.filter((p) => p.t > t60)];

  // Reputation
  const reps = new Map<string, RepRow>();
  const exalted = new Set<string>();
  for (const e of j.events) {
    if (e.k !== "rep" || typeof e.name !== "string" || typeof e.standing !== "number") continue;
    if (e.standing === EXALTED) exalted.add(e.name);
    else exalted.delete(e.name);
    if (e.t < t60) continue;
    const had = reps.get(e.name);
    reps.set(e.name, { faction: e.name, standing: e.standing, from: had ? had.from : e.up ? e.standing - 1 : e.standing + 1, t: e.t });
  }

  // Milestones
  const milestones: Milestone[] = [];
  let epicMount: SixtyStats["epicMount"];
  for (const e of j.events) {
    if (e.k === "mount" && isEpicMount(e.name) && !epicMount) {
      epicMount = { t: e.t, name: String(e.name), played: e.t >= t60 ? playedBetween(j.sessions, t60, e.t) : undefined };
      milestones.push({ t: e.t, title: `Epic mount: ${e.name}`, sub: e.t >= t60 ? afterSixty(j, t60, e.t) : undefined, tone: "gold" });
    } else if (e.k === "qd" && typeof e.title === "string" && ATTUNEMENTS[e.title]) {
      milestones.push({ t: e.t, title: `Attuned to ${ATTUNEMENTS[e.title]}`, sub: `quest "${e.title}"`, tone: "accent" });
    } else if (e.t < t60) {
      continue;
    } else if (e.k === "rep" && e.standing === EXALTED && e.up) {
      milestones.push({ t: e.t, title: `Exalted with ${e.name}`, tone: "teal" });
    } else if (e.k === "rare" && typeof e.name === "string") {
      milestones.push({ t: e.t, title: `Rare killed: ${e.name}`, sub: zoneAt(j, e.t), tone: "gold" });
    }
  }
  const firstEpic = j.events.find((e) => e.k === "loot" && e.t >= t60 && ((e.item as Item | undefined)?.quality ?? 0) >= 4);
  if (firstEpic) milestones.push({ t: firstEpic.t, title: `First epic at 60: ${itemName(j, firstEpic.item as Item)}`, sub: placeOf(j, firstEpic), tone: "accent" });
  const firstRaid = runs.filter((r) => r.raid).at(-1);
  if (firstRaid) milestones.push({ t: firstRaid.start, title: `First raid: ${firstRaid.name}`, sub: firstRaid.groupSize ? `${firstRaid.groupSize}-player group` : undefined, tone: "lilac" });
  const firstKill = allBosses.filter((b) => b.first && !b.first.by).sort((a, b) => a.first!.t - b.first!.t)[0];
  if (firstKill?.first) milestones.push({ t: firstKill.first.t, title: `First raid boss: ${firstKill.name}`, sub: raidOfBoss(firstKill.name)?.name, tone: "lilac" });
  milestones.sort((a, b) => a.t - b.t);

  // Time
  const playedSince = playedBetween(j.sessions, t60, end) ?? Math.max(0, end - t60);
  const inside = { raid: 0, party: 0, pvp: 0 };
  let open: JEvent | undefined;
  for (const e of j.events) {
    if (e.k === "in") open = e;
    else if (e.k === "out" && open) {
      if (e.t > t60) {
        const kind = open.type === "raid" || raidNamed(String(open.name)) ? "raid" : open.type === "pvp" ? "pvp" : "party";
        inside[kind] += playedBetween(j.sessions, Math.max(open.t, t60), e.t) ?? e.t - Math.max(open.t, t60);
      }
      open = undefined;
    }
  }
  const zones = zoneTimes(j, t60, end);
  let cities = 0;
  const outdoor: [string, number][] = [];
  const instanceNames = new Set(j.events.filter((e) => e.k === "in" && typeof e.name === "string").map((e) => e.name as string));
  for (const [zone, s] of zones) {
    if (CITIES.has(zone)) cities += s;
    else if (!instanceNames.has(zone)) outdoor.push([zone, s]);
  }
  const world = Math.max(0, playedSince - inside.raid - inside.party - inside.pvp - cities);
  const time: TimeSplit[] = [
    { label: "Raids", seconds: inside.raid, color: "var(--accent)" },
    { label: "Dungeons", seconds: inside.party, color: "var(--gold)" },
    { label: "Battlegrounds", seconds: inside.pvp, color: "var(--teal)" },
    { label: "Cities", seconds: cities, color: "var(--lilac)" },
    { label: "Out in the world", seconds: world, color: "var(--grey)" },
  ].filter((x) => x.seconds >= 60);

  const sessionDays = new Set(j.sessions.filter((s) => s.end > t60).map((s) => day(Math.max(s.start, t60))));
  return {
    reached: t60,
    zone: level60?.zone,
    playedTo60: level60?.played,
    daysTo60: start !== undefined ? day(t60) - day(start) + 1 : undefined,
    playedSince,
    daysSince: sessionDays.size,
    runs,
    dungeonRuns: dungeons.length,
    topDungeon: top ? { name: top[0], n: top[1] } : undefined,
    raids,
    bossSource,
    bossKills: allBosses.reduce((n, b) => n + b.kills, 0),
    bossesKilled: allBosses.filter((b) => b.kills > 0).length,
    wipes: bossSource === "jt" ? allBosses.reduce((n, b) => n + (b.wipes ?? 0), 0) : undefined,
    raidVisits: runs.filter((r) => r.raid).length,
    epics: j.events.filter((e) => e.k === "loot" && e.t >= t60 && ((e.item as Item | undefined)?.quality ?? 0) >= 4).length,
    gear,
    upgrades: upgrades.reverse(),
    slotsChanged: changed.size,
    rarity,
    gold,
    goldAt60: before60?.money,
    goldNow: g.now?.money,
    reps: [...reps.values()].sort((a, b) => b.standing - a.standing || b.t - a.t),
    exalted: [...exalted].sort(),
    milestones,
    time,
    topZones: outdoor.sort((a, b) => b[1] - a[1]).slice(0, 3).map(([z]) => z),
    epicMount,
  };
}

function itemOf(j: Journey, e: JEvent): Item {
  const item = (e.item as Item | undefined) ?? {};
  const id = typeof e.itemID === "number" ? e.itemID : item.id;
  return { id, name: item.name ?? (id ? j.items[id] : undefined), quality: item.quality };
}

// Where a piece of gear came from: the instance it dropped in, when the
// loot log has it.
function howOf(j: Journey, e: JEvent): string | undefined {
  const how = typeof e.how === "string" ? e.how : undefined;
  if (how === "drop" || how === "roll" || how === undefined) {
    const loot = [...j.events].reverse().find((x) => x.k === "loot" && x.t <= e.t + 5 && (x.item as Item | undefined)?.id === e.itemID);
    const place = loot && typeof loot.instanceID === "number" ? j.zones[`i${loot.instanceID}`] : undefined;
    if (place) return `${place} ${how === "roll" ? "roll" : "drop"}`;
  }
  return how && how !== "?" ? HOW[how] ?? how : undefined;
}

function placeOf(j: Journey, e: JEvent): string | undefined {
  return typeof e.instanceID === "number" ? j.zones[`i${e.instanceID}`] : undefined;
}

function afterSixty(j: Journey, t60: number, t: number): string | undefined {
  const p = playedBetween(j.sessions, t60, t);
  if (p === undefined) return undefined;
  const d = Math.floor(p / 86400), h = Math.floor((p % 86400) / 3600), m = Math.floor((p % 3600) / 60);
  return `${d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`} played after 60`;
}

// ---------------------------------------------------------------- first kills

// When each raid boss was first killed, from Journey Tracker's counts. It
// keeps no dates, so the date is the raid run in which a boss's count first
// went above 0: an upload that brings a new kill also brings that run.
// old: the journey stored before this upload (undefined for the first);
// known kills stay as they were.
export function bossFirstKills(old: Journey | undefined, next: Journey): Journey["bossFirst"] {
  const out: NonNullable<Journey["bossFirst"]> = { ...old?.bossFirst };
  const before = old?.stats.bosses ? jtBosses(old) : undefined;
  const since = before && old ? journeyEnd(old) : -Infinity;
  for (const [name, c] of jtBosses(next)) {
    if (!c.kills || out[name] || (before?.get(name)?.kills ?? 0) > 0) continue;
    const raid = raidOfBoss(name);
    const runs = (next.stats.runs ?? []).filter((r) => r.start > since - RUN_SLACK && raidNamed(r.name) === raid && (r.bosses ?? 0) > 0);
    if (runs.length === 1) out[name] = { t: runs[0].start };
    else if (runs.length > 1 && before) out[name] = { t: runs.at(-1)!.start, by: true };
    else if (!runs.length && before) out[name] = { t: journeyEnd(next), by: true };
  }
  return Object.keys(out).length ? out : undefined;
}

// ---------------------------------------------------------------- boards

export function sixtyBoardEntries(j: Journey, add: (b: string, v: number | undefined, p?: string) => void): void {
  const s = sixtyStats(j);
  if (!s) return;
  if (s.bossKills) add("bosskills", s.bossKills);
  for (const r of s.raids) for (const b of r.bosses) if (b.first && !b.first.by) add("firstboss", b.first.t, b.name);
  const counts = jtBosses(j);
  let attempts = 0, kills = 0;
  for (const c of counts.values()) {
    attempts += c.attempts ?? 0;
    kills += c.kills ?? 0;
  }
  if (kills >= 5 && attempts >= kills) add("killrate", Math.round((kills / attempts) * 1000) / 10);
  if (s.epicMount?.played !== undefined) add("epicmount", s.epicMount.played);
  if (s.epics) add("epics60", s.epics);
  if (s.raidVisits) add("raidvisits", s.raidVisits);
  const exalted = new Set<string>();
  for (const e of j.events) {
    if (e.k !== "rep" || e.standing !== EXALTED || !e.up || typeof e.name !== "string" || exalted.has(e.name) || !FACTIONS.includes(e.name)) continue;
    exalted.add(e.name);
    add("exalted", e.t, e.name);
  }
}
