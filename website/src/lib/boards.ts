// Leaderboards: what each board ranks, and each character's numbers for
// them. The numbers are worked out in the browser from a journey (like the
// rest of the site's stats) and stored with the character; the Worker only
// sorts them. Also the automatic checks that are shown to the reviewer next
// to reports: they never hide anything by themselves.

import { dungeonRuns, killCount, lootCounts } from "./insights";
import type { Journey } from "./journey";
import { GOLD_LEVELS, MILESTONES, type BoardEntry } from "./boardDefs";
import { distanceByMode } from "./path";
import { deathStats, goldStats, journeyEnd, journeyStart, levelFraction, levelStats, levelTimes, playedBetween, professionStats, pvpStats, zoneTimes } from "./stats";

// ---------------------------------------------------------------- entries

const HOUR = 3600;
const RUN_MIN_KILLS = 10;
const ZONE_MIN_SECONDS = 600;

export function boardEntries(j: Journey): BoardEntry[] {
  const out: BoardEntry[] = [];
  const add = (b: string, v: number | undefined, p = "", t?: number) => {
    if (v === undefined || !Number.isFinite(v)) return;
    out.push(t === undefined ? { b, p, v } : { b, p, v, t });
  };
  const times = levelTimes(j);
  const start = journeyStart(j);
  const end = journeyEnd(j);
  const levels = levelStats(j);
  const rows = new Map(levels.rows.map((r) => [r.level, r]));

  // Played time from level 1 to each level, while every level on the way
  // has its played time. A journey that started later has none for level 1.
  const toLevel = new Map<number, number>();
  let sum = 0;
  for (let level = 1; level < j.character.level; level++) {
    const r = rows.get(level);
    if (!r || r.inProgress || r.played === undefined) break;
    sum += r.played;
    toLevel.set(level + 1, sum);
  }
  const fromOne = toLevel.has(2);

  // Leveling
  add("to60", toLevel.get(60));
  for (const m of MILESTONES) add("tolevel", toLevel.get(Number(m)), m);
  for (const r of levels.rows) {
    if (r.inProgress || !r.played || r.played < 1) continue;
    add("levelfast", r.played, String(r.level));
    add("levelslow", r.played, String(r.level));
  }
  if (fromOne || (start !== undefined && times.get(60) !== undefined)) add("first60", times.get(60));
  add("xph", bestXpPerHour(j));
  const quests = j.events.filter((e) => e.k === "qd").length || j.stats.quests?.completed;
  if (quests) add("quests", quests);
  const kills = killCount(j);
  if (kills) add("kills", kills);

  // Survival
  const deaths = j.events.filter((e) => e.k === "die");
  const at60 = times.get(60);
  if (fromOne && at60 !== undefined) {
    const to60 = toLevel.get(60);
    add("fewdeaths60", deaths.filter((e) => e.t < at60).length, "", to60 !== undefined ? Math.min(0.999, to60 / 1e8) : 0.999);
  }
  const ds = deathStats(j);
  if (ds.longestAlive) add("alive", ds.longestAlive.seconds);
  if (fromOne) add("deathless", deaths.length ? Math.floor(levelFraction(j, deaths[0].t, times)) : j.character.level);
  const deathCount = deaths.length || j.stats.deaths?.length || 0;
  if (deathCount) add("deaths", deathCount);

  // Gold
  const g = goldStats(j);
  for (const l of GOLD_LEVELS) {
    const money = j.levels.find((x) => x.level === Number(l))?.money;
    if (money !== undefined && money > 0) add("goldat", money, l);
  }
  if (g.peak && g.peak.money > 0) add("goldpeak", g.peak.money);
  const sessionRates = g.sessions.filter((s) => s.change !== undefined && s.played >= HOUR && s.change > 0).map((s) => (s.change! / s.played) * HOUR);
  if (sessionRates.length) add("goldsession", Math.round(Math.max(...sessionRates)));
  if (g.questMoney > 0) add("questgold", g.questMoney);
  const m = j.stats.money ?? {};
  if (m.earned) add("goldearned", m.earned);
  if (m.auctionIncome) add("goldah", m.auctionIncome);
  if (m.repairs) add("repairs", m.repairs);

  // Professions
  const ps = professionStats(j);
  let gathered = 0, crafted = 0;
  for (const r of ps.professions) {
    gathered += r.gathers;
    crafted += r.made;
    if (!r.learned || r.learned.baseline) continue;
    for (const ms of r.milestones) {
      if (ms.t === undefined || ![150, 225, 300].includes(ms.cap)) continue;
      add(`prof${ms.cap}`, playedBetween(j.sessions, r.learned.t, ms.t), r.name);
    }
  }
  for (const r of ps.professions) {
    const ms = r.milestones.find((x) => x.cap === 300);
    if (ms?.level !== undefined) add("youngartisan", Math.floor(ms.level), r.name);
  }
  if (gathered) add("gathered", gathered);
  if (crafted) add("crafted", crafted);

  // World
  if (start !== undefined) {
    for (const [zone, seconds] of zoneTimes(j, start, end)) if (seconds >= ZONE_MIN_SECONDS) add("zonetime", Math.round(seconds), zone);
  }
  const dist = distanceByMode(j.segments);
  if (dist.w) add("distance", Math.round(dist.w));
  if (dist.t) add("flown", Math.round(dist.t));
  const visited = new Set(j.events.filter((e) => e.k === "zone" && typeof e.mapID === "number").map((e) => e.mapID));
  if (visited.size) add("zones", visited.size);

  // Dungeons
  const runs = dungeonRuns(j);
  const fastest = new Map<string, number>(), lowest = new Map<string, number>();
  for (const r of runs) {
    const d = r.run?.duration;
    if (!d || d < 60 || (r.run?.kills ?? 0) < RUN_MIN_KILLS) continue;
    fastest.set(r.name, Math.min(fastest.get(r.name) ?? Infinity, d));
    const level = Math.floor(levelFraction(j, r.t, times));
    lowest.set(r.name, Math.min(lowest.get(r.name) ?? Infinity, level));
  }
  for (const [name, d] of fastest) add("dungeonrun", d, name);
  for (const [name, l] of lowest) add("youngclear", l, name);
  if (runs.length) add("runs", runs.length);
  const epics = lootCounts(j)[4];
  if (epics) add("epics", epics);

  // PvP
  const pvp = pvpStats(j);
  if (pvp.hk) add("hk", pvp.hk);
  if (pvp.won) add("bgwins", pvp.won);
  if (pvp.won + pvp.lost >= 20) add("winrate", Math.round((pvp.won / (pvp.won + pvp.lost)) * 1000) / 10);
  if (pvp.duelsWon) add("duels", pvp.duelsWon);

  return out;
}

// The best XP an hour over any session of an hour or more.
export function bestXpPerHour(j: Journey): number | undefined {
  const gains: { t: number; xp: number }[] = [];
  for (const e of j.events) if (e.k === "qd" && typeof e.xp === "number") gains.push({ t: e.t, xp: e.xp });
  if (j.kills?.d) {
    let t = 0;
    for (const m of j.kills.d.matchAll(/(-?\d+),(\d+),(\d+);/g)) {
      t += Number(m[1]);
      gains.push({ t, xp: Number(m[2]) });
    }
  }
  let best: number | undefined;
  for (const s of j.sessions) {
    const length = s.end - s.start;
    if (length < HOUR) continue;
    let xp = 0;
    for (const g of gains) if (g.t >= s.start && g.t <= s.end) xp += g.xp;
    if (xp > 0) best = Math.max(best ?? 0, Math.round((xp / length) * HOUR));
  }
  return best;
}

// ---------------------------------------------------------------- checks

// Things that look impossible in a journey. They're shown to the reviewer
// beside reports; nothing is hidden because of them. before is the journey
// stored before this upload, when there was one.
export function integrityChecks(j: Journey, before?: Journey, now = Date.now() / 1000): string[] {
  const out: string[] = [];
  const times = levelTimes(j);

  const sorted = [...times.entries()].sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i][1] < sorted[i - 1][1]) {
      out.push(`Level ${sorted[i][0]} is recorded before level ${sorted[i - 1][0]}.`);
      break;
    }
  }
  const last = journeyEnd(j);
  if (last > now + 2 * 86400) out.push("Some of the journey is dated in the future.");

  // A level faster than a minute per character level (level 30 in under
  // 30 minutes) is well past anything seen in Classic.
  for (const r of levelStats(j).rows) {
    if (r.level < 10 || r.inProgress || r.played === undefined) continue;
    if (r.played < r.level * 60) out.push(`Level ${r.level} took ${Math.round(r.played / 60)} minutes of played time.`);
  }

  for (const s of goldStats(j).sessions) {
    if (s.change === undefined || s.played < 600) continue;
    const perHour = (s.change / s.played) * HOUR;
    if (s.change >= 100 * 10000 && perHour >= 300 * 10000) {
      out.push(`Gold went up ${Math.round(s.change / 10000)}g in ${Math.round(s.played / 60)} minutes of play.`);
      break;
    }
  }

  for (const r of professionStats(j).professions) {
    for (let i = 1; i < r.points.length; i++) {
      const a = r.points[i - 1], b = r.points[i];
      if (b.rank - a.rank >= 75 && b.t - a.t < 900) {
        out.push(`${r.name} went from ${a.rank} to ${b.rank} in ${Math.max(1, Math.round((b.t - a.t) / 60))} minutes.`);
        break;
      }
    }
  }

  for (const s of j.sessions) {
    if (s.end - s.start < 3 * HOUR) continue;
    const moved = Object.values(distanceByMode(j.segments, s.start, s.end)).reduce((n, d) => n + d, 0);
    const acted = j.events.some((e) => e.t >= s.start && e.t <= s.end && ["qd", "die", "lvl", "loot", "in", "zone"].includes(e.k));
    if (moved < 20 && !acted) {
      out.push(`${Math.round((s.end - s.start) / HOUR)}h of played time with no movement, quests or loot.`);
      break;
    }
  }

  if (before) {
    const old = levelTimes(before);
    for (const [level, t] of old) {
      const now2 = times.get(level);
      if (now2 !== undefined && Math.abs(now2 - t) > 600) {
        out.push(`An upload changed when level ${level} was reached.`);
        break;
      }
    }
  }
  return [...new Set(out)].slice(0, 12);
}
