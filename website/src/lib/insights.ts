// What the journey page shows, worked out from a stored journey. Each value
// is undefined when no uploaded file could give it, so the page can say
// which addon would.

import type { Item, JEvent, Journey, RunSummary } from "./journey";
import { deathCount, firstSeen, questCount, sessionsPlayed } from "./merge";
import { decodeSegment, distanceByMode } from "./path";
import { QUALITY_NAMES } from "./wow";

export interface Tile {
  label: string;
  value?: string | number;
  sub?: string;
  needs?: string; // the addon that would fill it in
}

export interface Moment {
  t: number;
  level?: number;
  title: string;
  where?: string;
  quality?: number;
  kind: string;
}

export function zoneName(j: Journey, mapID: unknown): string | undefined {
  return typeof mapID === "number" ? j.zones[mapID] ?? `Zone ${mapID}` : undefined;
}

// The zone the character was in at time t, from the zone events.
export function zoneAt(j: Journey, t: number): string | undefined {
  let zone: string | undefined;
  for (const e of j.events) {
    if (e.t > t) break;
    if (e.k === "zone") zone = zoneName(j, e.mapID);
    else if (e.k === "in" && typeof e.name === "string") zone = e.name;
    else if (e.k === "out") zone = undefined;
  }
  return zone;
}

export function levelAt(j: Journey, t: number): number {
  let level = 1;
  for (const e of j.events) {
    if (e.t > t) break;
    if ((e.k === "lvl" || e.k === "on") && typeof e.level === "number") level = Math.max(level, e.level);
  }
  for (const l of j.levels) if (l.t !== undefined && l.t <= t) level = Math.max(level, l.level);
  return level;
}

export function itemName(j: Journey, item: Item | undefined): string {
  if (!item) return "an item";
  return item.name ?? (item.id ? j.items[item.id] ?? `item ${item.id}` : "an item");
}

export function lootCounts(j: Journey): Record<number, number> {
  const out: Record<number, number> = {};
  for (const e of j.events) {
    if (e.k !== "loot") continue;
    const q = (e.item as Item | undefined)?.quality;
    if (q !== undefined) out[q] = (out[q] ?? 0) + 1;
  }
  return out;
}

export function killCount(j: Journey): number | undefined {
  const d = j.kills?.d;
  const fromRts = d ? (d.match(/;/g) ?? []).length : 0;
  const fromJt = j.stats.kills?.total ?? 0;
  return fromRts || fromJt ? Math.max(fromRts, fromJt) : undefined;
}

export function dungeonRuns(j: Journey): { t: number; name: string; run?: RunSummary }[] {
  const out: { t: number; name: string; run?: RunSummary }[] = [];
  for (const e of j.events) {
    if (e.k !== "out") continue;
    const run = e.run as RunSummary | undefined;
    const name = run?.name ?? (typeof e.instanceID === "number" ? j.zones[`i${e.instanceID}`] : undefined);
    if (name) out.push({ t: e.t, name, run });
  }
  if (!out.length) for (const r of j.stats.runs ?? []) out.push({ t: r.start, name: r.name, run: { name: r.name, duration: r.duration, deaths: r.deaths } });
  return out;
}

// XP an hour in the last session, from quest turn-ins and kills.
export function xpPerHour(j: Journey): number | undefined {
  const s = j.sessions.at(-1);
  if (!s || s.end - s.start < 600) return undefined;
  let xp = 0;
  for (const e of j.events) if (e.k === "qd" && e.t >= s.start && e.t <= s.end && typeof e.xp === "number") xp += e.xp;
  if (j.kills?.d) {
    let t = 0;
    for (const m of j.kills.d.matchAll(/(-?\d+),(\d+),(\d+);/g)) {
      t += Number(m[1]);
      if (t >= s.start && t <= s.end) xp += Number(m[2]);
    }
  }
  return xp ? Math.round((xp / (s.end - s.start)) * 3600) : undefined;
}

export function played(j: Journey): number | undefined {
  return j.stats.played ?? sessionsPlayed(j.sessions);
}

export function tiles(j: Journey): Tile[] {
  const dist = distanceByMode(j.segments);
  const walked = dist.w || j.stats.travel?.ground || 0;
  const loot = lootCounts(j);
  const byQ = j.stats.loot?.byQuality ?? {};
  const green = byQ[2] ?? loot[2] ?? 0, blue = byQ[3] ?? loot[3] ?? 0, epic = byQ[4] ?? loot[4] ?? 0;
  const kills = killCount(j);
  const rares = j.events.filter((e) => e.k === "rare").length || j.stats.kills?.byClass?.rare || 0;
  const elites = j.stats.kills?.byClass?.elite ?? 0;
  const deaths = j.events.filter((e) => e.k === "die");
  const runs = dungeonRuns(j);
  const money = j.stats.money;
  const xph = xpPerHour(j);
  const meters = walked * 0.9144;
  const q = j.stats.quests;
  return [
    { label: "Quests completed", value: questCount(j) || (j.events.length ? 0 : undefined), sub: q?.abandoned ? `${q.abandoned} abandoned` : undefined, needs: "Road to Sixty" },
    {
      label: "Walked",
      value: walked ? `${(walked / 1093.6133).toFixed(1)} km` : undefined,
      sub: walked ? `≈ ${Math.round(meters / 0.75).toLocaleString("en-US")} steps` : undefined,
      needs: "Road to Sixty",
    },
    {
      label: "Gold earned",
      value: money?.earned !== undefined ? goldShort(money.earned) : undefined,
      sub: money?.spent !== undefined ? `spent ${gold(money.spent)}` : undefined,
      needs: "Journey Tracker",
    },
    {
      label: "Items looted",
      value: j.stats.loot?.items?.toLocaleString("en-US") ?? (Object.keys(loot).length ? `${green + blue + epic}+` : undefined),
      sub: [green && `${green} green`, blue && `${blue} blue`, epic && `${epic} epic`].filter(Boolean).join(", ") || undefined,
      needs: "Journey Tracker",
    },
    {
      label: "Mobs killed",
      value: kills?.toLocaleString("en-US"),
      sub: [elites && `${elites} elites`, rares && `${rares} rare${rares === 1 ? "" : "s"}`].filter(Boolean).join(", ") || undefined,
      needs: "Road to Sixty or Journey Tracker",
    },
    {
      label: "Deaths",
      value: deathCount(j),
      sub: deaths.length && typeof deaths.at(-1)!.killer === "string" ? `last: ${deaths.at(-1)!.killer}` : undefined,
    },
    {
      label: "Dungeons",
      value: runs.length,
      sub: [...new Set(runs.map((r) => r.name))].slice(0, 3).join(", ") || undefined,
    },
    { label: "XP per hour", value: xph ? `${(xph / 1000).toFixed(1)}k` : undefined, sub: xph ? "last session" : undefined, needs: "Road to Sixty" },
  ];
}

export interface LevelBar {
  level: number;
  seconds?: number;
  died: boolean;
  zone?: string;
}

export function levelBars(j: Journey): LevelBar[] {
  const deathsAt = new Set<number>();
  for (const e of j.events) if (e.k === "die" && typeof e.level === "number") deathsAt.add(e.level);
  for (const d of j.stats.deaths ?? []) if (d.level) deathsAt.add(d.level);
  const out: LevelBar[] = [];
  for (let level = 1; level < Math.max(2, j.character.level); level++) {
    const l = j.levels.find((x) => x.level === level);
    const next = j.levels.find((x) => x.level === level + 1);
    out.push({ level, seconds: l?.secondsOnLevel, died: deathsAt.has(level), zone: next?.zone ?? (next?.t ? zoneAt(j, next.t) : undefined) });
  }
  return out;
}

export interface GoldRow {
  label: string;
  amount: number;
}

export function goldFlows(j: Journey): { earned?: number; spent?: number; onHand?: number; incoming: GoldRow[]; outgoing: GoldRow[] } {
  const m = j.stats.money ?? {};
  const questMoney = j.stats.quests?.money ?? j.events.reduce((n, e) => n + (e.k === "qd" && typeof e.money === "number" ? e.money : 0), 0);
  const incoming = [
    { label: "Quest rewards", amount: questMoney },
    { label: "Looted coin", amount: m.loot ?? 0 },
    { label: "Vendor sales", amount: m.vendor ?? 0 },
    { label: "Auction house", amount: m.auctionIncome ?? 0 },
    { label: "Other mail", amount: Math.max(0, (m.mail ?? 0) - (m.auctionIncome ?? 0)) },
  ].filter((r) => r.amount > 0).sort((a, b) => b.amount - a.amount);
  const outgoing = [
    { label: "Class training", amount: m.training ?? 0 },
    { label: "Repairs", amount: m.repairs ?? 0 },
    { label: "Flight paths", amount: m.flights ?? 0 },
    { label: "Vendor purchases", amount: m.vendorSpent ?? 0 },
    { label: "Auction house", amount: m.auctionSpent ?? 0 },
  ].filter((r) => r.amount > 0).sort((a, b) => b.amount - a.amount);
  const lastLevel = [...j.levels].reverse().find((l) => l.money !== undefined);
  return {
    // Journey Tracker counts every gain in earned, quest rewards included.
    earned: m.earned,
    spent: m.spent,
    onHand: m.last ?? lastLevel?.money,
    incoming,
    outgoing,
  };
}

export interface DeathRow {
  t: number;
  level?: number;
  killer?: string;
  where?: string;
}

export function deathRows(j: Journey): DeathRow[] {
  return j.events
    .filter((e) => e.k === "die")
    .map((e) => ({
      t: e.t,
      level: e.level as number | undefined,
      killer: e.killer as string | undefined,
      where: [e.dungeon ?? e.zone ?? zoneAt(j, e.t), e.subzone].filter(Boolean).join(", ") || undefined,
    }))
    .reverse();
}

// The journey's highlights: its start, firsts, level milestones, dungeon
// clears, rare and epic loot, and notes.
export function moments(j: Journey): Moment[] {
  const out: Moment[] = [];
  const start = firstSeen(j);
  if (start) out.push({ t: start, level: levelAt(j, start), title: "Journey began", where: zoneAt(j, start + 60), kind: "start" });
  let firstRide = true, firstMount = true, firstRare = true, firstDungeon = true, firstGuild = true;
  for (const e of j.events) {
    const level = levelAt(j, e.t);
    const where = zoneAt(j, e.t);
    if (e.k === "lvl" && typeof e.level === "number" && e.level % 10 === 0) {
      out.push({ t: e.t, level: e.level, title: `Reached level ${e.level}`, where, kind: "level" });
    } else if (e.k === "out") {
      const run = e.run as RunSummary | undefined;
      if (!run?.name) continue;
      const mins = run.duration ? `${Math.round(run.duration / 60)} min` : undefined;
      const group = run.groupSize ? `group of ${run.groupSize}` : undefined;
      out.push({ t: e.t, level, title: `${firstDungeon ? "First dungeon: " : "Dungeon: "}${run.name}`, where: [mins, group].filter(Boolean).join(", ") || undefined, kind: "dungeon" });
      firstDungeon = false;
    } else if (e.k === "loot") {
      const item = e.item as Item | undefined;
      if ((item?.quality ?? 0) < 3) continue;
      out.push({ t: e.t, level, title: `Looted [${itemName(j, item)}]`, where: typeof e.instanceID === "number" ? j.zones[`i${e.instanceID}`] ?? where : where, quality: item?.quality, kind: "loot" });
    } else if (e.k === "ride" && firstRide) {
      out.push({ t: e.t, level, title: `Learned ${typeof e.name === "string" ? e.name : "riding"}`, where, kind: "ride" });
      firstRide = false;
    } else if (e.k === "mount" && firstMount) {
      out.push({ t: e.t, level, title: `First mount${typeof e.name === "string" ? `: ${e.name}` : ""}`, where, kind: "mount" });
      firstMount = false;
    } else if (e.k === "rare") {
      out.push({ t: e.t, level, title: `${firstRare ? "First rare kill" : "Rare kill"}: ${typeof e.name === "string" ? e.name : "a rare"}`, where, kind: "rare" });
      firstRare = false;
    } else if (e.k === "gj" && !e.baseline && firstGuild) {
      out.push({ t: e.t, level, title: `Joined <${String(e.name ?? "a guild")}>`, where, kind: "guild" });
      firstGuild = false;
    } else if (e.k === "rep" && e.up && typeof e.standing === "number" && e.standing >= 7) {
      out.push({ t: e.t, level, title: `${["", "", "", "", "", "", "", "Revered", "Exalted"][e.standing]} with ${String(e.name ?? "a faction")}`, where, kind: "rep" });
    } else if (e.k === "note") {
      out.push({ t: e.t, level, title: `“${String(e.text)}”`, where: (e.zone as string | undefined) ?? where, kind: "note" });
    }
  }
  return out.reverse();
}

// The journal lines the replay shows as it goes.
export function describe(j: Journey, e: JEvent): { text: string; tone: "gold" | "red" | "plain" | "muted" | "lilac" } | undefined {
  switch (e.k) {
    case "lvl": return { text: `Reached level ${e.level}`, tone: "gold" };
    case "die": return { text: e.killer ? `Died to ${e.killer}` : "Died", tone: "red" };
    case "qd": return { text: `Quest: ${e.title ?? `#${e.questID}`}`, tone: "gold" };
    case "zone": return { text: `Entered ${zoneName(j, e.mapID)}`, tone: "plain" };
    case "in": return { text: `Entered ${e.name ?? "a dungeon"}`, tone: "lilac" };
    case "out": {
      const run = e.run as RunSummary | undefined;
      return { text: run?.name ? `Left ${run.name}` : "Left the instance", tone: "lilac" };
    }
    case "loot": {
      const item = e.item as Item | undefined;
      return { text: `Looted [${itemName(j, item)}]`, tone: (item?.quality ?? 0) >= 3 ? "lilac" : "plain" };
    }
    case "rare": return { text: `Killed rare ${e.name ?? ""}`, tone: "gold" };
    case "prof": return { text: e.baseline ? `Knows ${e.name} (${e.rank})` : `Learned ${e.name}`, tone: "plain" };
    case "rec": return { text: `Learned recipe ${e.name}`, tone: "muted" };
    case "gj": return { text: `Joined <${e.name}>`, tone: "plain" };
    case "gl": return { text: `Left <${e.name}>`, tone: "muted" };
    case "rep": return { text: `${["", "Hated", "Hostile", "Unfriendly", "Neutral", "Friendly", "Honored", "Revered", "Exalted"][Number(e.standing)] ?? "New standing"} with ${e.name}`, tone: "plain" };
    case "ride": return { text: `Learned ${e.name ?? "riding"}`, tone: "gold" };
    case "mount": return { text: `New mount: ${e.name ?? ""}`, tone: "gold" };
    case "grp": return { text: `Joined a ${e.kind === "raid" ? "raid" : "group"} of ${e.size}`, tone: "muted" };
    case "shot": return { text: `Screenshot: ${shotLabel(j, e)}`, tone: "lilac" };
    case "note": return { text: `Note: “${e.text}”`, tone: "plain" };
    case "on": return { text: "Logged in", tone: "muted" };
    case "off": return { text: "Logged out", tone: "muted" };
    default: return undefined;
  }
}

export function shotLabel(j: Journey, e: JEvent): string {
  const d = (e.detail ?? {}) as Record<string, unknown>;
  switch (e.kind) {
    case "dungeon": return `Cleared ${d.instance ?? d.name ?? "a dungeon"}`;
    case "epic":
    case "blue": return `Looted [${itemName(j, d.item as Item | undefined)}]`;
    case "level": return `Reached level ${d.level ?? levelAt(j, e.t)}`;
    case "death": return "Died";
    case "boss": return `Killed ${d.name ?? "a boss"}`;
    case "rare": return `Killed rare ${d.name ?? ""}`.trim();
    case "zone": return `First visit: ${d.zone ?? zoneName(j, e.mapID) ?? "a new zone"}`;
    default: return typeof d.text === "string" ? d.text : "Screenshot";
  }
}

export function gold(copper: number): string {
  const neg = copper < 0;
  copper = Math.abs(Math.round(copper));
  const g = Math.floor(copper / 10000), s = Math.floor((copper % 10000) / 100), c = copper % 100;
  const parts = [g && `${g.toLocaleString("en-US")}g`, s && `${String(s).padStart(g ? 2 : 1, "0")}s`, !g && c && `${c}c`].filter(Boolean);
  return (neg ? "-" : "") + (parts.join(" ") || "0c");
}

export function goldShort(copper: number): string {
  const g = copper / 10000;
  return g >= 1 ? `${Math.floor(g).toLocaleString("en-US")}g` : gold(copper);
}

export function duration(seconds: number | undefined): string {
  if (seconds === undefined) return "—";
  const d = Math.floor(seconds / 86400), h = Math.floor((seconds % 86400) / 3600), m = Math.floor((seconds % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}m`;
}

export { QUALITY_NAMES };

// The path decoded once, for the route thumbnail and the replay.
export function pathPoints(j: Journey, continent?: number) {
  return j.segments.filter((s) => continent === undefined || s.c === continent).map((s) => ({ seg: s, p: decodeSegment(s) }));
}
