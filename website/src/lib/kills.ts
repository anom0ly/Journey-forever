// Kills: which creatures a character killed, how many, where and at what
// level. Road to Sixty's kill log names every kill that gave XP, with its
// time, so names, levels, zones and the busiest hour come from it alone.
// Journey Tracker adds what Road to Sixty doesn't know: creature types,
// elites, and the kill furthest above the player's level. Like stats.ts,
// no browser calls, so it is tested offline.

import type { Journey } from "./journey";
import { killCount, played, zoneName } from "./insights";

const HOUR = 3600;

export interface CreatureRow {
  name: string;
  count: number;
  first?: number; // time of the first kill (Road to Sixty only)
  minLevel?: number; // the player's level at the first and last kill
  maxLevel?: number;
  zone?: string; // where most of them were killed
  dungeon?: boolean; // that place is a dungeon
  rare?: boolean; // Road to Sixty logged it as a rare kill
}

export interface ZoneRow {
  zone: string;
  count: number;
  dungeon: boolean;
}

export interface KillStats {
  total?: number;
  perHour?: number; // kills an hour played
  creatures: CreatureRow[]; // most killed first
  different?: number; // creatures killed at least once
  busiest?: { count: number; t: number; zone?: string }; // most kills in any hour
  byLevel: number[]; // [level - 1] = kills at that level; empty without the kill log
  byZone: ZoneRow[];
  byType?: { type: string; count: number }[]; // Journey Tracker
  elites?: number; // Journey Tracker: elite and rare elite
  rares?: number; // rare and rare elite
  toughest?: { name: string; diff: number; mobLevel: number; level: number }; // Journey Tracker
  fromLog: boolean; // names, levels and zones come from Road to Sixty's kill log
}

interface Kill {
  t: number;
  name: string;
}

// Road to Sixty's packed log: "dt,xp,nameIndex;" with dt from the kill before.
export function killLog(j: Journey): Kill[] {
  const out: Kill[] = [];
  if (!j.kills?.d) return out;
  let t = 0;
  for (const m of j.kills.d.matchAll(/(-?\d+),(\d+),(\d+);/g)) {
    t += Number(m[1]);
    out.push({ t, name: j.kills.names[Number(m[3]) - 1] ?? "?" });
  }
  return out;
}

export function killStats(j: Journey): KillStats {
  const log = killLog(j).filter((k) => k.name !== "?");
  const jt = j.stats.kills;
  const total = killCount(j);
  const time = played(j);
  const rareNames = new Set(j.events.filter((e) => e.k === "rare" && typeof e.name === "string").map((e) => e.name as string));
  const rareEvents = j.events.filter((e) => e.k === "rare").length;

  const out: KillStats = {
    total,
    perHour: total && time && time >= 600 ? Math.round((total / time) * HOUR) : undefined,
    creatures: [],
    byLevel: [],
    byZone: [],
    fromLog: log.length > 0,
  };

  if (log.length) {
    // One pass through the timeline beside the kills, keeping the level and
    // where the character was.
    const marks: { t: number; level?: number; zone?: string; dungeon?: string; out?: boolean }[] = [];
    for (const e of j.events) {
      if ((e.k === "lvl" || e.k === "on") && typeof e.level === "number") marks.push({ t: e.t, level: e.level });
      else if (e.k === "zone") marks.push({ t: e.t, zone: zoneName(j, e.mapID) });
      else if (e.k === "in" && typeof e.name === "string") marks.push({ t: e.t, dungeon: e.name });
      else if (e.k === "out") marks.push({ t: e.t, out: true });
    }
    for (const l of j.levels) if (l.t !== undefined) marks.push({ t: l.t, level: l.level });
    marks.sort((a, b) => a.t - b.t);

    const rows = new Map<string, CreatureRow & { zones: Map<string, number> }>();
    const zones = new Map<string, ZoneRow>();
    const sorted = [...log].sort((a, b) => a.t - b.t);
    const placeOf: (string | undefined)[] = [];
    let level = 1, zone: string | undefined, dungeon: string | undefined, mi = 0;
    for (const k of sorted) {
      while (mi < marks.length && marks[mi].t <= k.t) {
        const m = marks[mi++];
        if (m.level !== undefined) level = Math.max(level, m.level);
        if (m.zone !== undefined) zone = m.zone;
        if (m.dungeon !== undefined) dungeon = m.dungeon;
        if (m.out) dungeon = undefined;
      }
      const where = dungeon ?? zone;
      placeOf.push(where);
      let r = rows.get(k.name);
      if (!r) {
        r = { name: k.name, count: 0, first: k.t, minLevel: level, maxLevel: level, zones: new Map() };
        rows.set(k.name, r);
      }
      r.count++;
      r.maxLevel = Math.max(r.maxLevel!, level);
      if (where) {
        r.zones.set(where, (r.zones.get(where) ?? 0) + 1);
        const z = zones.get(where) ?? { zone: where, count: 0, dungeon: !!dungeon };
        z.count++;
        zones.set(where, z);
      }
      while (out.byLevel.length < level) out.byLevel.push(0);
      out.byLevel[level - 1]++;
    }
    const dungeons = new Set([...zones.values()].filter((z) => z.dungeon).map((z) => z.zone));
    out.creatures = [...rows.values()]
      .map(({ zones: zs, ...r }) => {
        const top = [...zs].sort((a, b) => b[1] - a[1])[0]?.[0];
        return { ...r, zone: top, dungeon: top ? dungeons.has(top) : undefined, rare: rareNames.has(r.name) || undefined };
      })
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    out.byZone = [...zones.values()].sort((a, b) => b.count - a.count);

    // The most kills inside any hour of the clock.
    let best = 0, bestAt = 0;
    for (let i = 0, s = 0; i < sorted.length; i++) {
      while (sorted[i].t - sorted[s].t >= HOUR) s++;
      if (i - s + 1 > best) {
        best = i - s + 1;
        bestAt = sorted[s].t;
      }
    }
    if (best) {
      const counts = new Map<string, number>();
      // Where most of that hour's kills were.
      sorted.forEach((k, i) => {
        const z = placeOf[i];
        if (z && k.t >= bestAt && k.t < bestAt + HOUR) counts.set(z, (counts.get(z) ?? 0) + 1);
      });
      out.busiest = { count: best, t: bestAt, zone: [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] };
    }
  } else if (jt?.top?.length) {
    out.creatures = jt.top.map(([name, count]) => ({ name, count }));
  }
  out.different = out.fromLog ? out.creatures.length : undefined;

  if (jt?.byType) {
    const types = Object.entries(jt.byType).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
    if (types.length) out.byType = types.map(([type, count]) => ({ type, count }));
  }
  const cls = jt?.byClass;
  if (cls && Object.keys(cls).length) out.elites = (cls.elite ?? 0) + (cls.rareelite ?? 0);
  const jtRares = cls ? (cls.rare ?? 0) + (cls.rareelite ?? 0) : 0;
  if (rareEvents || jtRares) out.rares = Math.max(rareEvents, jtRares);
  const tk = jt?.toughest;
  if (tk && tk.diff > 0) out.toughest = tk;
  return out;
}

// Creatures both characters killed, the most killed between them first.
export function sharedPrey(a: KillStats, b: KillStats): { name: string; a: number; b: number }[] {
  const bb = new Map(b.creatures.map((c) => [c.name, c.count]));
  return a.creatures
    .filter((c) => bb.has(c.name))
    .map((c) => ({ name: c.name, a: c.count, b: bb.get(c.name)! }))
    .sort((x, y) => y.a + y.b - (x.a + x.b) || x.name.localeCompare(y.name));
}

// Each creature type's share of the kills that have a type.
export function typeShares(k: KillStats): Map<string, number> {
  const out = new Map<string, number>();
  const sum = (k.byType ?? []).reduce((n, t) => n + t.count, 0);
  if (sum) for (const t of k.byType!) out.set(t.type, t.count / sum);
  return out;
}
