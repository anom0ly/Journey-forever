// Dungeon runs, and whether each one was a full clear: the dungeon's end boss
// died while the player was inside. Road to Sixty's kill log names every
// kill with its time, so the end boss is looked for between entering and
// leaving. The addon's "dungeon cleared" screenshot entry (end boss kill
// seen) is the backup, for when the kill log has nothing.

import type { JEvent, Journey, RunSummary } from "./journey";

// Each dungeon's end boss (or each wing's, for dungeons in wings), by the
// names Road to Sixty saves: the instance name the game gives, and the
// creature's name. The same list as the addon's FINAL_BOSSES.
const END_BOSS_LIST: [string[], string[]][] = [
  [["Ragefire Chasm"], ["Taragaman the Hungerer"]],
  [["Wailing Caverns"], ["Mutanus the Devourer"]],
  [["The Deadmines", "Deadmines"], ["Edwin VanCleef"]],
  [["Shadowfang Keep"], ["Archmage Arugal"]],
  [["Blackfathom Deeps"], ["Aku'mai"]],
  [["The Stockade", "Stormwind Stockade"], ["Bazil Thredd"]],
  [["Gnomeregan"], ["Mekgineer Thermaplugg"]],
  [["Razorfen Kraul"], ["Charlga Razorflank"]],
  [["Razorfen Downs"], ["Amnennar the Coldbringer"]],
  [["Uldaman"], ["Archaedas"]],
  [["Zul'Farrak"], ["Chief Ukorz Sandscalp"]],
  [["Maraudon"], ["Princess Theradras"]],
  [["The Temple of Atal'Hakkar", "Temple of Atal'Hakkar", "Sunken Temple"], ["Shade of Eranikus"]],
  [["Blackrock Depths"], ["Emperor Dagran Thaurissan"]],
  [["Lower Blackrock Spire"], ["Overlord Wyrmthalak"]],
  [["Upper Blackrock Spire"], ["General Drakkisath"]],
  [["Blackrock Spire"], ["Overlord Wyrmthalak", "General Drakkisath"]],
  [["Scholomance"], ["Darkmaster Gandling"]],
  [["Scarlet Monastery"], ["Bloodmage Thalnos", "Arcanist Doan", "Herod", "High Inquisitor Whitemane"]],
  [["Dire Maul"], ["Alzzin the Wildshaper", "Prince Tortheldrin", "King Gordok"]],
  [["Stratholme"], ["Balnazzar", "Baron Rivendare"]],
  // Forever's new dungeons: not yet confirmed in game.
  [["Hall of Thanes"], ["Durgen Dirgehammer"]],
  [["Ruins of Lordaeron"], ["Bjork"]],
  [["Excavation Site"], ["Relic Guardian"]],
  // Raids
  [["Onyxia's Lair"], ["Onyxia"]],
  [["Molten Core"], ["Ragnaros"]],
  [["Blackwing Lair"], ["Nefarian"]],
  [["Zul'Gurub"], ["Hakkar"]],
  [["Ruins of Ahn'Qiraj"], ["Ossirian the Unscarred"]],
  [["Ahn'Qiraj Temple", "Temple of Ahn'Qiraj"], ["C'Thun"]],
  [["Naxxramas"], ["Kel'Thuzad"]],
];

const END_BOSSES = new Map<string, Set<string>>();
for (const [dungeons, bosses] of END_BOSS_LIST) {
  for (const d of dungeons) END_BOSSES.set(d.toLowerCase(), new Set(bosses.map((b) => b.toLowerCase())));
}

// The dungeon's end bosses, or undefined for a dungeon nobody listed yet.
export function endBosses(dungeon: string): Set<string> | undefined {
  return END_BOSSES.get(dungeon.toLowerCase());
}

// Back-to-back visits to the same dungeon this close together are one run:
// releasing after a wipe puts the player outside, and the clock keeps going.
export const REJOIN_SECONDS = 600;
// How long after the end boss dies the addon's screenshot entry can land.
const SHOT_SLACK = 30;

export interface DungeonRun {
  t: number; // when the player last left
  start: number;
  name: string;
  duration?: number;
  kills?: number;
  deaths?: number;
  groupSize?: number;
  visits: number;
  // true: the end boss died inside. false: it didn't. undefined: a dungeon
  // whose end boss isn't listed, so nobody can tell.
  cleared?: boolean;
  boss?: string; // the end boss that died
  run?: RunSummary; // the last visit's summary
}

interface Visit {
  from?: number;
  to: number;
  instanceID?: number;
  name: string;
  run?: RunSummary;
}

function dungeonVisits(j: Journey): Visit[] {
  const out: Visit[] = [];
  let open: JEvent | undefined;
  for (const e of j.events) {
    if (e.k === "in") {
      open = e.type === "pvp" ? undefined : e;
    } else if (e.k === "out") {
      const run = e.run as RunSummary | undefined;
      const inEvent = open;
      open = undefined;
      if (run?.pvp || run?.type === "pvp") continue; // battlegrounds have their own tab
      const instanceID = typeof e.instanceID === "number" ? e.instanceID : undefined;
      const name = run?.name ?? (instanceID !== undefined ? j.zones[`i${instanceID}`] : undefined);
      if (!name) continue;
      const from = run?.duration !== undefined ? e.t - run.duration : inEvent?.t;
      out.push({ from, to: e.t, instanceID, name, run });
    }
  }
  return out;
}

interface Kill {
  t: number;
  name: string;
}

function killLog(j: Journey): Kill[] {
  const out: Kill[] = [];
  if (!j.kills?.d) return out;
  let t = 0;
  for (const m of j.kills.d.matchAll(/(-?\d+),(\d+),(\d+);/g)) {
    t += Number(m[1]);
    const name = j.kills.names[Number(m[3]) - 1];
    if (name) out.push({ t, name });
  }
  return out;
}

// Times the addon saw an end boss die (its "dungeon" screenshot entries).
function addonClears(j: Journey): { t: number; boss?: string }[] {
  const out: { t: number; boss?: string }[] = [];
  for (const e of j.events) {
    if (e.k !== "shot" || e.kind !== "dungeon") continue;
    const d = e.detail as { via?: unknown; boss?: unknown } | undefined;
    if (d?.via !== "encounter") continue;
    out.push({ t: e.t, boss: typeof d.boss === "string" ? d.boss : undefined });
  }
  return out;
}

function sameDungeon(a: Visit, b: Visit): boolean {
  if (a.instanceID !== undefined && b.instanceID !== undefined) return a.instanceID === b.instanceID;
  return a.name === b.name;
}

export function dungeonRuns(j: Journey): DungeonRun[] {
  const visits = dungeonVisits(j);
  const kills = killLog(j);
  const shots = addonClears(j);
  const out: DungeonRun[] = [];

  const finish = (group: Visit[]) => {
    const first = group[0], last = group[group.length - 1];
    const start = first.from ?? first.to;
    const sum = (f: (r: RunSummary) => number | undefined) => {
      let n: number | undefined;
      for (const v of group) {
        const x = v.run && f(v.run);
        if (x !== undefined) n = (n ?? 0) + x;
      }
      return n;
    };
    const run: DungeonRun = {
      t: last.to,
      start,
      name: last.name,
      duration: first.from !== undefined ? last.to - first.from : undefined,
      kills: sum((r) => r.kills),
      deaths: sum((r) => r.deaths),
      groupSize: group.reduce<number | undefined>((m, v) => (v.run?.groupSize !== undefined ? Math.max(m ?? 0, v.run.groupSize) : m), undefined),
      visits: group.length,
      run: last.run,
    };
    const bosses = endBosses(run.name);
    if (bosses) {
      const k = kills.find((x) => x.t >= start && x.t <= run.t && bosses.has(x.name.toLowerCase()));
      const s = k ? undefined : shots.find((x) => x.t >= start && x.t <= run.t + SHOT_SLACK);
      run.cleared = !!(k || s);
      if (k) run.boss = k.name;
      else if (s?.boss) run.boss = s.boss;
    }
    out.push(run);
  };

  let group: Visit[] = [];
  for (const v of visits) {
    const prev = group[group.length - 1];
    const vStart = v.from ?? v.to;
    if (prev && !(sameDungeon(prev, v) && vStart - prev.to <= REJOIN_SECONDS && vStart >= prev.to)) {
      finish(group);
      group = [];
    }
    group.push(v);
  }
  if (group.length) finish(group);

  // Characters without Road to Sixty: Journey Tracker's run list.
  if (!out.length) {
    for (const r of j.stats.runs ?? []) {
      const end = r.start + (r.duration ?? 0);
      const bosses = endBosses(r.name);
      const s = bosses && r.duration !== undefined ? shots.find((x) => x.t >= r.start && x.t <= end + SHOT_SLACK) : undefined;
      out.push({
        t: end,
        start: r.start,
        name: r.name,
        duration: r.duration,
        deaths: r.deaths,
        visits: 1,
        cleared: bosses ? !!s : undefined,
        boss: s?.boss,
        run: { name: r.name, duration: r.duration, deaths: r.deaths },
      });
    }
  }
  return out;
}

// Runs where the end boss died.
export function fullClears(j: Journey): DungeonRun[] {
  return dungeonRuns(j).filter((r) => r.cleared);
}
