// The numbers behind the journey page's tabs (Deaths, Gold, Professions,
// PvP, Levels), worked out from a stored journey. Like insights.ts, no
// browser calls, so it is tested offline.

import type { Item, JEvent, Journey, LevelInfo, PvpSummary, RunSummary, Session } from "./journey";
import { zoneAt, zoneName } from "./insights";
import { distanceByMode } from "./path";
import { GATHER_NAMES } from "./wow";

// ---------------------------------------------------------------- shared

// Played seconds between two times, from the sessions. Undefined when no
// sessions were recorded.
export function playedBetween(sessions: Session[], from: number, to: number): number | undefined {
  if (!sessions.length) return undefined;
  let total = 0;
  for (const s of sessions) total += Math.max(0, Math.min(s.end, to) - Math.max(s.start, from));
  return total;
}

export function journeyEnd(j: Journey): number {
  return Math.max(j.events.at(-1)?.t ?? 0, j.segments.at(-1)?.t ?? 0, j.sessions.at(-1)?.end ?? 0);
}

export function journeyStart(j: Journey): number | undefined {
  const times = [j.events[0]?.t, j.segments[0]?.t, j.sessions[0]?.start].filter((x): x is number => !!x);
  return times.length ? Math.min(...times) : undefined;
}

// When each level was reached: from the snapshots, else the level-up events.
export function levelTimes(j: Journey): Map<number, number> {
  const out = new Map<number, number>();
  for (const e of j.events) if (e.k === "lvl" && typeof e.level === "number" && !out.has(e.level)) out.set(e.level, e.t);
  for (const l of j.levels) if (l.t !== undefined) out.set(l.level, Math.min(l.t, out.get(l.level) ?? Infinity));
  return out;
}

// The character's level at t as a fraction: 5.5 is halfway through level 5
// by wall-clock time between the two level-ups.
export function levelFraction(j: Journey, t: number, times = levelTimes(j)): number {
  const levels = [...times.entries()].sort((a, b) => a[0] - b[0]);
  let level = 1, from = journeyStart(j) ?? t;
  for (const [l, at] of levels) {
    if (at > t) {
      const span = at - from;
      return level + (span > 0 ? Math.min(0.999, Math.max(0, (t - from) / span)) : 0);
    }
    level = l;
    from = at;
  }
  // On the current level: placed by how far through the journey so far it
  // is, short of the next level (its length isn't known yet).
  const end = journeyEnd(j);
  return level + (end > from ? Math.min(0.9, Math.max(0, ((t - from) / (end - from)) * 0.9)) : 0);
}

// Instance visits, from the "in" and "out" events.
export interface Visit {
  from: number;
  to: number;
  instanceID?: number;
  name?: string;
  pvp: boolean;
  run?: RunSummary;
  outEvent?: JEvent;
}

export function visits(j: Journey): Visit[] {
  const out: Visit[] = [];
  let open: Visit | undefined;
  for (const e of j.events) {
    if (e.k === "in") {
      if (open) out.push(open);
      open = { from: e.t, to: e.t, instanceID: e.instanceID as number | undefined, name: e.name as string | undefined, pvp: e.type === "pvp" };
    } else if (e.k === "out") {
      const run = e.run as RunSummary | undefined;
      const v = open ?? { from: e.t, to: e.t, instanceID: e.instanceID as number | undefined, name: run?.name, pvp: false };
      v.to = e.t;
      v.run = run;
      v.outEvent = e;
      v.name ??= run?.name;
      if (run?.pvp || run?.type === "pvp") v.pvp = true;
      out.push(v);
      open = undefined;
    }
  }
  if (open) out.push(open);
  return out;
}

export function isPvpRun(run: RunSummary | undefined): boolean {
  return !!run && (!!run.pvp || run.type === "pvp");
}

// ---------------------------------------------------------------- deaths

export type KillerKind = "creature" | "player" | "pet" | "world" | "unknown";

export interface DeathRow {
  t: number;
  level?: number;
  killer?: string; // undefined for another player or their pet: never named
  kind: KillerKind;
  spell?: string;
  where?: string;
  zone?: string;
  inInstance: boolean;
  aliveFor?: number; // played seconds since the death before (or the start)
}

export interface DeathStats {
  rows: DeathRow[]; // oldest first
  count: number;
  perPlayed?: number; // played seconds per death
  deadliest?: { level: number; count: number; zone?: string };
  nemesis?: { name: string; count: number };
  longestAlive?: { seconds: number; fromLevel?: number; toLevel?: number; ongoing: boolean };
  sinceLast?: number; // played seconds since the last death
  byLevel: { level: number; world: number; instance: number }[];
  causes: { label: string; count: number; tone: "teal" | "gold" | "red" | "grey" }[];
  topKillers: { name: string; count: number }[];
  byZone: { zone: string; count: number }[];
  played?: number;
}

function killerKind(e: JEvent): KillerKind {
  const k = e.killerKind;
  if (k === "player" || k === "pet" || k === "world" || k === "creature") return k;
  return typeof e.killer === "string" ? "creature" : "unknown";
}

export function deathLabel(d: Pick<DeathRow, "kind" | "killer">): string {
  if (d.kind === "player") return "Another player";
  if (d.kind === "pet") return "Another player's pet";
  if (d.kind === "world") return d.killer ?? "The world";
  return d.killer ?? "Unknown";
}

export function deathStats(j: Journey): DeathStats {
  const vs = visits(j);
  const inside = (t: number) => vs.find((v) => t >= v.from && t <= v.to);
  const start = journeyStart(j) ?? 0;
  const end = journeyEnd(j);
  const rows: DeathRow[] = [];
  let prev = start;
  for (const e of j.events) {
    if (e.k !== "die") continue;
    const v = inside(e.t);
    const zone = (e.dungeon as string | undefined) ?? v?.name ?? (e.zone as string | undefined) ?? zoneAt(j, e.t);
    rows.push({
      t: e.t,
      level: e.level as number | undefined,
      killer: e.killerKind === "player" || e.killerKind === "pet" ? undefined : (e.killer as string | undefined),
      kind: killerKind(e),
      spell: e.spell as string | undefined,
      zone,
      where: [zone, e.subzone].filter(Boolean).join(", ") || undefined,
      inInstance: !!v || !!e.dungeon,
      aliveFor: playedBetween(j.sessions, prev, e.t),
    });
    prev = e.t;
  }
  const played = playedBetween(j.sessions, start, end);
  const levelCount = new Map<number, DeathRow[]>();
  for (const r of rows) if (r.level !== undefined) levelCount.set(r.level, [...(levelCount.get(r.level) ?? []), r]);
  let deadliest: DeathStats["deadliest"];
  for (const [level, list] of levelCount) {
    if (!deadliest || list.length > deadliest.count || (list.length === deadliest.count && level > deadliest.level)) {
      deadliest = { level, count: list.length, zone: mode(list.map((r) => r.zone)) };
    }
  }
  const killers = new Map<string, number>();
  for (const r of rows) if (r.kind === "creature" && r.killer) killers.set(r.killer, (killers.get(r.killer) ?? 0) + 1);
  const topKillers = [...killers.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const nemesis = topKillers[0];

  // The longest stretch alive, in played time, including the one running now.
  let longestAlive: DeathStats["longestAlive"];
  if (j.sessions.length) {
    const marks = [start, ...rows.map((r) => r.t), end];
    for (let i = 0; i < marks.length - 1; i++) {
      const s = playedBetween(j.sessions, marks[i], marks[i + 1]) ?? 0;
      if (!longestAlive || s > longestAlive.seconds) {
        longestAlive = { seconds: s, fromLevel: Math.floor(levelFraction(j, marks[i])), toLevel: Math.floor(levelFraction(j, marks[i + 1])), ongoing: i === marks.length - 2 };
      }
    }
  }

  const maxLevel = Math.max(j.character.level, ...rows.map((r) => r.level ?? 0));
  const byLevel = [];
  for (let level = 1; level <= maxLevel; level++) {
    const list = levelCount.get(level) ?? [];
    byLevel.push({ level, world: list.filter((r) => !r.inInstance).length, instance: list.filter((r) => r.inInstance).length });
  }

  const count = (f: (r: DeathRow) => boolean) => rows.filter(f).length;
  const causes: DeathStats["causes"] = [
    { label: "Creatures, open world", count: count((r) => r.kind === "creature" && !r.inInstance), tone: "teal" as const },
    { label: "Creatures, in dungeons", count: count((r) => r.kind === "creature" && r.inInstance), tone: "gold" as const },
    { label: "Other players", count: count((r) => r.kind === "player" || r.kind === "pet"), tone: "red" as const },
    { label: "Falling, drowning, lava", count: count((r) => r.kind === "world"), tone: "grey" as const },
    { label: "Not known", count: count((r) => r.kind === "unknown"), tone: "grey" as const },
  ].filter((c) => c.count > 0);

  const zones = new Map<string, number>();
  for (const r of rows) if (r.zone) zones.set(r.zone, (zones.get(r.zone) ?? 0) + 1);

  return {
    rows,
    count: rows.length,
    perPlayed: played && rows.length ? played / rows.length : undefined,
    deadliest,
    nemesis,
    longestAlive,
    sinceLast: rows.length ? playedBetween(j.sessions, rows.at(-1)!.t, end) : undefined,
    byLevel,
    causes,
    topKillers,
    byZone: [...zones.entries()].map(([zone, count]) => ({ zone, count })).sort((a, b) => b.count - a.count || a.zone.localeCompare(b.zone)),
    played,
  };
}

function mode(values: (string | undefined)[]): string | undefined {
  const n = new Map<string, number>();
  for (const v of values) if (v) n.set(v, (n.get(v) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

// ---------------------------------------------------------------- gold

export interface GoldPoint {
  t: number;
  money: number; // copper held
  level: number; // fractional, see levelFraction
  why: "login" | "logout" | "level";
}

export interface GoldDrop {
  t: number;
  level: number;
  amount: number; // copper lost (positive)
  label?: string; // what was bought, when a learn event says
}

export interface GoldSessionRow {
  start: number;
  end: number;
  played: number;
  startLevel?: number;
  endLevel?: number;
  startMoney?: number;
  endMoney?: number;
  change?: number;
}

export interface GoldStats {
  points: GoldPoint[];
  now?: GoldPoint;
  peak?: GoldPoint;
  drops: GoldDrop[];
  sessions: GoldSessionRow[]; // newest first
  bestSession?: GoldSessionRow;
  perHour?: number; // change in gold held per played hour, over the last 7 days
  questMoney: number;
  quests: number;
  atLevel: { level: number; money: number }[];
}

const DROP_MIN = 10000; // a drop of at least 1g...
const DROP_SHARE = 0.25; // ...and a quarter of what was held is marked

export function goldStats(j: Journey): GoldStats {
  const times = levelTimes(j);
  const raw: { t: number; money: number; why: GoldPoint["why"] }[] = [];
  for (const e of j.events) {
    if ((e.k === "on" || e.k === "off") && typeof e.money === "number") raw.push({ t: e.t, money: e.money, why: e.k === "on" ? "login" : "logout" });
  }
  for (const l of j.levels) if (l.t !== undefined && l.money !== undefined) raw.push({ t: l.t, money: l.money, why: "level" });
  raw.sort((a, b) => a.t - b.t);
  const points: GoldPoint[] = raw.map((p) => ({ ...p, level: levelFraction(j, p.t, times) }));

  const now = points.at(-1);
  const peak = points.reduce<GoldPoint | undefined>((a, p) => (!a || p.money > a.money ? p : a), undefined);

  const drops: GoldDrop[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const lost = a.money - b.money;
    if (lost >= DROP_MIN && lost >= a.money * DROP_SHARE) {
      const learned = j.events.find((e) => e.t >= a.t && e.t <= b.t && (e.k === "ride" || e.k === "mount"));
      drops.push({ t: b.t, level: b.level, amount: lost, label: learned ? String(learned.name ?? (learned.k === "ride" ? "Riding" : "A mount")) : undefined });
    }
  }

  let lastOff: number | undefined;
  const sessions: GoldSessionRow[] = j.sessions.map((s) => {
    const on = j.events.find((e) => e.k === "on" && e.t === s.start);
    const off = j.events.find((e) => e.k === "off" && e.t === s.end);
    // Gold at login is missing in older journeys (and when the client said
    // 0 too early): the gold at the logout before, or none at level 1.
    const startMoney = typeof on?.money === "number" ? on.money : lastOff ?? (s.startLevel === 1 ? 0 : undefined);
    const endMoney = typeof off?.money === "number" ? off.money : undefined;
    lastOff = endMoney;
    return {
      start: s.start, end: s.end, played: Math.max(0, s.end - s.start), startLevel: s.startLevel, endLevel: s.endLevel,
      startMoney, endMoney, change: startMoney !== undefined && endMoney !== undefined ? endMoney - startMoney : undefined,
    };
  }).reverse();
  const bestSession = sessions.filter((s) => s.change !== undefined).sort((a, b) => b.change! - a.change!)[0];

  let perHour: number | undefined;
  if (now) {
    const since = now.t - 7 * 86400;
    const first = points.find((p) => p.t >= since);
    const hours = first ? (playedBetween(j.sessions, first.t, now.t) ?? 0) / 3600 : 0;
    if (first && hours >= 0.5) perHour = (now.money - first.money) / hours;
  }

  let questMoney = 0, quests = 0;
  for (const e of j.events) if (e.k === "qd") {
    quests++;
    if (typeof e.money === "number") questMoney += e.money;
  }

  return {
    points, now, peak, drops, sessions, bestSession, perHour, questMoney, quests,
    atLevel: j.levels.filter((l) => l.money !== undefined).map((l) => ({ level: l.level, money: l.money! })),
  };
}

// ---------------------------------------------------------------- professions

export const SKILL_CAPS = [75, 150, 225, 300];

export interface SkillPoint {
  t: number;
  level: number; // the character's level, fractional
  rank: number;
}

export interface ProfessionRow {
  name: string;
  rank: number;
  max?: number;
  learned?: { t: number; level: number; baseline: boolean };
  points: SkillPoint[];
  milestones: { cap: number; t?: number; level?: number }[];
  perLevel?: number;
  recipes: number;
  made: number; // things crafted, counting stacks
  gathers: number; // nodes or fishing catches
}

export interface HistoryRow {
  t: number;
  level: number;
  rank?: number;
  from?: number;
  text: string;
  item?: Item;
}

export interface ProfessionStats {
  professions: ProfessionRow[];
  history: Record<string, HistoryRow[]>; // by profession, newest first
  gathered: { id: number; name: string; count: number }[];
  bestMade: { item: Item; level: number; t: number; count: number }[];
}

const GATHER_PROF: Record<string, string> = { mining: "Mining", herbalism: "Herbalism", fishing: "Fishing" };

export function tierName(max: number | undefined): string | undefined {
  return max === undefined ? undefined : max <= 75 ? "Apprentice" : max <= 150 ? "Journeyman" : max <= 225 ? "Expert" : "Artisan";
}

export function professionStats(j: Journey): ProfessionStats {
  const times = levelTimes(j);
  const at = (t: number) => levelFraction(j, t, times);
  const by = new Map<string, ProfessionRow>();
  const row = (name: string): ProfessionRow => {
    let r = by.get(name);
    if (!r) {
      r = { name, rank: 0, points: [], milestones: SKILL_CAPS.map((cap) => ({ cap })), recipes: 0, made: 0, gathers: 0 };
      by.set(name, r);
    }
    return r;
  };
  const history = new Map<string, HistoryRow[]>();
  const hist = (name: string, h: HistoryRow) => history.set(name, [...(history.get(name) ?? []), h]);
  const add = (r: ProfessionRow, t: number, rank: number) => {
    if (rank === r.points.at(-1)?.rank) return;
    const level = at(t);
    r.points.push({ t, level, rank });
    r.rank = rank;
    for (const m of r.milestones) if (m.t === undefined && rank >= m.cap) Object.assign(m, { t, level });
  };

  // The level snapshots give a point at each level, for skill-ups recorded
  // before Road to Sixty logged them one by one.
  const snaps: { t: number; name: string; rank: number; max?: number }[] = [];
  for (const l of j.levels) if (l.t !== undefined && l.skills) for (const [name, s] of Object.entries(l.skills)) snaps.push({ t: l.t, name, rank: s.rank, max: s.max });

  const timeline: ({ e: JEvent } | { snap: (typeof snaps)[number] })[] = [
    ...j.events.filter((e) => ["prof", "skill", "rec", "craft", "gath"].includes(e.k)).map((e) => ({ e })),
    ...snaps.map((snap) => ({ snap })),
  ].sort((a, b) => ("e" in a ? a.e.t : a.snap.t) - ("e" in b ? b.e.t : b.snap.t));

  const gathered = new Map<number, number>();
  const made: ProfessionStats["bestMade"] = [];
  for (const x of timeline) {
    if ("snap" in x) {
      const r = row(x.snap.name);
      if (x.snap.max !== undefined) r.max = Math.max(r.max ?? 0, x.snap.max);
      r.learned ??= { t: x.snap.t, level: at(x.snap.t), baseline: true };
      if (x.snap.rank > r.rank) add(r, x.snap.t, x.snap.rank);
      continue;
    }
    const e = x.e;
    const level = at(e.t);
    if (e.k === "prof" && typeof e.name === "string") {
      const r = row(e.name);
      const max = typeof e.max === "number" ? e.max : undefined;
      if (!r.learned) {
        r.learned = { t: e.t, level, baseline: !!e.baseline };
        hist(e.name, { t: e.t, level, text: e.baseline ? `Already knew ${e.name}` : `Learned ${e.name}` });
      } else if (max !== undefined && max > (r.max ?? 0)) {
        hist(e.name, { t: e.t, level, text: `Trained ${tierName(max)} ${e.name}` });
      }
      if (max !== undefined) r.max = Math.max(r.max ?? 0, max);
      if (typeof e.rank === "number") add(r, e.t, Math.max(r.rank, e.rank));
    } else if (e.k === "skill" && typeof e.name === "string" && typeof e.rank === "number") {
      const r = row(e.name);
      r.learned ??= { t: e.t, level, baseline: false };
      const from = typeof e.from === "number" ? e.from : r.rank;
      add(r, e.t, e.rank);
      const madeNow = j.events.find((c) => c.k === "craft" && c.profession === e.name && Math.abs(c.t - e.t) <= 30);
      const gathNow = j.events.find((g) => g.k === "gath" && GATHER_PROF[g.prof as string] === e.name && Math.abs(g.t - e.t) <= 30);
      const what = madeNow ? `Made ${madeNow.count && Number(madeNow.count) > 1 ? `${madeNow.count} × ` : ""}${itemLabel(j, madeNow.item as Item)}`
        : gathNow ? `${gathNow.prof === "fishing" ? "Fished" : gathNow.prof === "mining" ? "Mined" : "Gathered"} ${GATHER_NAMES[gathNow.itemID as number] ?? "a node"}`
        : e.late ? "Found at login" : "Skill-up";
      hist(e.name, { t: e.t, level, rank: e.rank, from, text: what, item: madeNow?.item as Item | undefined });
    } else if (e.k === "rec" && typeof e.profession === "string") {
      const r = row(e.profession);
      r.recipes++;
      hist(e.profession, { t: e.t, level, text: `Learned ${String(e.name ?? "a recipe")}${e.trainer ? " from a trainer" : ""}` });
    } else if (e.k === "craft") {
      const count = typeof e.count === "number" ? e.count : 1;
      if (typeof e.profession === "string") row(e.profession).made += count;
      const item = e.item as Item | undefined;
      if (item) made.push({ item, level: Math.floor(level), t: e.t, count });
    } else if (e.k === "gath") {
      const name = GATHER_PROF[e.prof as string];
      if (name) row(name).gathers++;
      for (const l of (e.loot as { id: number; count: number }[] | undefined) ?? []) gathered.set(l.id, (gathered.get(l.id) ?? 0) + l.count);
    }
  }

  // Journey Tracker's professions, when Road to Sixty has none of them.
  for (const [name, p] of Object.entries(j.stats.professions ?? {})) {
    if (by.has(name) || p.level === undefined) continue;
    const r = row(name);
    r.rank = p.level;
    if (p.time) r.learned = { t: p.time, level: at(p.time), baseline: false };
  }

  const nowLevel = j.character.level;
  for (const r of by.values()) {
    if (r.learned && nowLevel > r.learned.level + 1 && r.rank) r.perLevel = r.rank / (nowLevel - Math.floor(r.learned.level));
  }

  // Best things made: highest quality, then latest; one per item.
  const seen = new Set<string>();
  const bestMade = made
    .sort((a, b) => (b.item.quality ?? 1) - (a.item.quality ?? 1) || b.t - a.t)
    .filter((m) => {
      const k = String(m.item.id ?? m.item.name);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, 5);

  const professions = [...by.values()].filter((r) => r.rank > 0 || r.learned).sort((a, b) => b.rank - a.rank || a.name.localeCompare(b.name));
  const historyOut: Record<string, HistoryRow[]> = {};
  for (const [k, v] of history) historyOut[k] = [...v].reverse();
  return {
    professions,
    history: historyOut,
    gathered: [...gathered.entries()]
      .map(([id, count]) => ({ id, count, name: GATHER_NAMES[id] ?? j.items[id] ?? `Item ${id}` }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8),
    bestMade,
  };
}

function itemLabel(j: Journey, item: Item | undefined): string {
  if (!item) return "something";
  return item.name ?? (item.id ? j.items[item.id] ?? `item ${item.id}` : "something");
}

// ---------------------------------------------------------------- PvP

export interface MatchRow {
  t: number;
  name: string;
  level?: number;
  result: "won" | "lost" | "left";
  pvp: PvpSummary;
  length?: number;
}

export interface MapStats {
  name: string;
  played: number;
  won: number;
  lost: number;
  left: number;
  avgLength?: number;
  objectives: { name: string; value: number }[];
  best?: MatchRow;
  rep: Record<string, number>;
}

export interface DuelRow {
  t: number;
  result: string;
  label: string; // "Level 41 Human Warrior"
  toDeath: boolean;
}

export interface PvpStats {
  matches: MatchRow[]; // newest first
  won: number;
  lost: number;
  left: number;
  winRate?: number;
  hk: number;
  kb: number;
  honor: number;
  maps: MapStats[];
  weeks: { week: number; from: number; hk: number }[];
  duels: DuelRow[]; // newest first
  duelsWon: number;
  duelsLost: number;
}

export function pvpStats(j: Journey): PvpStats {
  const times = levelTimes(j);
  const matches: MatchRow[] = [];
  for (const v of visits(j)) {
    if (!v.pvp || !v.outEvent) continue;
    const pvp = v.run?.pvp ?? {};
    matches.push({
      t: v.outEvent.t,
      name: v.name ?? v.run?.name ?? "Battleground",
      level: Math.floor(levelFraction(j, v.outEvent.t, times)),
      result: pvp.won === true ? "won" : pvp.won === false ? "lost" : "left",
      pvp,
      length: pvp.length ?? (v.to > v.from ? v.to - v.from : undefined),
    });
  }
  const sum = (f: (m: MatchRow) => number | undefined) => matches.reduce((n, m) => n + (f(m) ?? 0), 0);
  const won = matches.filter((m) => m.result === "won").length;
  const lost = matches.filter((m) => m.result === "lost").length;

  const byMap = new Map<string, MatchRow[]>();
  for (const m of matches) byMap.set(m.name, [...(byMap.get(m.name) ?? []), m]);
  const maps: MapStats[] = [...byMap.entries()].map(([name, list]) => {
    const objectives = new Map<string, number>();
    const rep: Record<string, number> = {};
    for (const m of list) {
      for (const s of m.pvp.stats ?? []) objectives.set(s.name, (objectives.get(s.name) ?? 0) + s.value);
      for (const [f, n] of Object.entries(m.pvp.rep ?? {})) rep[f] = (rep[f] ?? 0) + n;
    }
    const lengths = list.map((m) => m.length).filter((x): x is number => x !== undefined);
    const best = [...list].sort((a, b) => (b.pvp.kb ?? 0) - (a.pvp.kb ?? 0) || (b.pvp.hk ?? 0) - (a.pvp.hk ?? 0))[0];
    return {
      name,
      played: list.length,
      won: list.filter((m) => m.result === "won").length,
      lost: list.filter((m) => m.result === "lost").length,
      left: list.filter((m) => m.result === "left").length,
      avgLength: lengths.length ? lengths.reduce((a, b) => a + b, 0) / lengths.length : undefined,
      objectives: [...objectives.entries()].map(([n, value]) => ({ name: n, value })),
      best,
      rep,
    };
  }).sort((a, b) => b.played - a.played || a.name.localeCompare(b.name));

  const weeks: PvpStats["weeks"] = [];
  if (matches.length) {
    const first = matches[0].t;
    for (const m of matches) {
      const week = Math.floor((m.t - first) / (7 * 86400)) + 1;
      while (weeks.length < week) weeks.push({ week: weeks.length + 1, from: first + weeks.length * 7 * 86400, hk: 0 });
      weeks[week - 1].hk += m.pvp.hk ?? 0;
    }
  }

  const duels: DuelRow[] = j.events
    .filter((e) => e.k === "duel")
    .map((e) => ({
      t: e.t,
      result: String(e.result ?? "unknown"),
      label: duelLabel(e),
      toDeath: !!e.toDeath,
    }))
    .reverse();

  return {
    matches: matches.reverse(),
    won,
    lost,
    left: matches.length - won - lost,
    winRate: won + lost ? won / (won + lost) : undefined,
    hk: sum((m) => m.pvp.hk),
    kb: sum((m) => m.pvp.kb),
    honor: sum((m) => m.pvp.honor ?? m.pvp.scoreHonor),
    maps,
    weeks,
    duels,
    duelsWon: duels.filter((d) => d.result === "won" || d.result === "theyFled").length,
    duelsLost: duels.filter((d) => d.result === "lost" || d.result === "fled").length,
  };
}

const RACES: Record<string, string> = { NightElf: "Night Elf", Scourge: "Undead", BloodElf: "Blood Elf" };

function duelLabel(e: JEvent): string {
  const race = typeof e.race === "string" ? RACES[e.race] ?? e.race : undefined;
  const cls = typeof e.class === "string" ? e.class.charAt(0) + e.class.slice(1).toLowerCase() : undefined;
  const who = [race, cls].filter(Boolean).join(" ") || "An opponent";
  return typeof e.level === "number" ? `Level ${e.level} ${who}` : who;
}

export function duelResult(r: string): string {
  return r === "won" ? "Won" : r === "lost" ? "Lost" : r === "fled" ? "You fled" : r === "theyFled" ? "They fled" : "Unknown";
}

// ---------------------------------------------------------------- levels

export interface LevelRow {
  level: number;
  reached?: number;
  played?: number; // undefined while in progress or when not recorded
  inProgress: boolean;
  kills: number;
  killXP: number;
  quests: number;
  questXP: number;
  deaths: number;
  dungeons: number;
  walked?: number; // yards
  flown?: number;
  money?: number; // gold held when reached
  zone?: string; // where most of the level was played
}

export interface LevelStats {
  rows: LevelRow[]; // level 1 first
  fastest?: LevelRow; // level 10 and up
  slowest?: LevelRow;
  questShare?: number; // share of XP from quests, 0-1
  mostKills?: LevelRow;
  average?: number; // played seconds per finished level
}

export function levelStats(j: Journey): LevelStats {
  const times = levelTimes(j);
  const end = journeyEnd(j);
  const current = j.character.level;
  const kills: { t: number; xp: number }[] = [];
  if (j.kills?.d) {
    let t = 0;
    for (const m of j.kills.d.matchAll(/(-?\d+),(\d+),(\d+);/g)) {
      t += Number(m[1]);
      kills.push({ t, xp: Number(m[2]) });
    }
  }
  const vs = visits(j).filter((v) => !v.pvp);
  const snap = new Map<number, LevelInfo>(j.levels.map((l) => [l.level, l]));
  const rows: LevelRow[] = [];
  for (let level = 1; level <= current; level++) {
    const from = times.get(level) ?? (level === 1 ? journeyStart(j) : undefined);
    const nextAt = times.get(level + 1);
    const inProgress = level === current;
    const to = nextAt ?? (inProgress ? end : undefined);
    const row: LevelRow = { level, reached: times.get(level), inProgress, kills: 0, killXP: 0, quests: 0, questXP: 0, deaths: 0, dungeons: 0, money: snap.get(level)?.money };
    if (from !== undefined && to !== undefined) {
      for (const k of kills) if (k.t >= from && k.t < to) {
        row.kills++;
        row.killXP += k.xp;
      }
      for (const e of j.events) {
        if (e.t < from || e.t >= to) continue;
        if (e.k === "qd") {
          row.quests++;
          if (typeof e.xp === "number") row.questXP += e.xp;
        } else if (e.k === "die") row.deaths++;
      }
      row.dungeons = vs.filter((v) => v.from >= from && v.from < to).length;
      if (j.segments.length) {
        const d = distanceByMode(j.segments, from, to);
        row.walked = d.w;
        row.flown = d.t;
      }
      row.played = inProgress ? undefined : snap.get(level)?.secondsOnLevel ?? playedBetween(j.sessions, from, to);
      row.zone = mainZone(j, from, to);
    } else {
      row.played = snap.get(level)?.secondsOnLevel;
    }
    // Where events are missing (older journeys), the snapshots' totals give the counts.
    const a = snap.get(level), b = snap.get(level + 1);
    if (a && b && !kills.length && a.kills !== undefined && b.kills !== undefined) {
      row.kills = b.kills - a.kills;
      row.killXP = (b.killXP ?? 0) - (a.killXP ?? 0);
    }
    rows.push(row);
  }
  const finished = rows.filter((r) => !r.inProgress && r.played !== undefined && r.played > 0);
  const tenUp = finished.filter((r) => r.level >= 10);
  const fastest = (tenUp.length ? tenUp : finished).reduce<LevelRow | undefined>((a, r) => (!a || r.played! < a.played! ? r : a), undefined);
  const slowest = finished.reduce<LevelRow | undefined>((a, r) => (!a || r.played! > a.played! ? r : a), undefined);
  const qxp = rows.reduce((n, r) => n + r.questXP, 0), kxp = rows.reduce((n, r) => n + r.killXP, 0);
  const mostKills = rows.reduce<LevelRow | undefined>((a, r) => (r.kills && (!a || r.kills > a.kills) ? r : a), undefined);
  return {
    rows,
    fastest,
    slowest,
    questShare: qxp + kxp ? qxp / (qxp + kxp) : undefined,
    mostKills,
    average: finished.length ? finished.reduce((n, r) => n + r.played!, 0) / finished.length : undefined,
  };
}

// The zone with the most time between two moments, from the zone events.
function mainZone(j: Journey, from: number, to: number): string | undefined {
  const spent = new Map<string, number>();
  let zone = zoneAt(j, from), at = from;
  let outdoors: string | undefined;
  for (const e of j.events) {
    if (e.k === "zone") outdoors = zoneName(j, e.mapID);
    if (e.t <= from) continue;
    if (e.t >= to) break;
    let next: string | undefined = zone;
    if (e.k === "zone") next = outdoors;
    else if (e.k === "in" && typeof e.name === "string" && e.type !== "pvp") next = e.name;
    else if (e.k === "out" && next !== outdoors) next = outdoors;
    if (next !== zone) {
      if (zone) spent.set(zone, (spent.get(zone) ?? 0) + (playedBetween(j.sessions, at, e.t) ?? e.t - at));
      zone = next;
      at = e.t;
    }
  }
  if (zone) spent.set(zone, (spent.get(zone) ?? 0) + (playedBetween(j.sessions, at, to) ?? to - at));
  return [...spent.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}
