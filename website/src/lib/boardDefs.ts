// The leaderboards' catalogue: what each board ranks and how it's shown.
// No other imports, so the Worker can use it to check and sort entries.

// Bumped when the numbers are worked out differently, so stored characters
// are worked out again by their owner's browser.
export const BOARDS_VERSION = 1;

export type GroupId = "leveling" | "survival" | "gold" | "professions" | "world" | "dungeons" | "pvp";
export const GROUPS: { id: GroupId; label: string }[] = [
  { id: "leveling", label: "Leveling" },
  { id: "survival", label: "Survival" },
  { id: "gold", label: "Gold" },
  { id: "professions", label: "Professions" },
  { id: "world", label: "World" },
  { id: "dungeons", label: "Dungeons" },
  { id: "pvp", label: "PvP" },
];

// duration: played seconds. date: unix seconds. gold: copper. distance: yards.
// percent: 0-100. level: a character level.
export type Fmt = "duration" | "date" | "gold" | "goldHour" | "count" | "xp" | "distance" | "percent" | "level" | "deaths";
export type ParamKind = "milestone" | "goldLevel" | "level" | "profession" | "zone" | "dungeon";

export interface BoardDef {
  id: string;
  group: GroupId;
  title: string; // the full board's heading; {p} is the param
  sub: string; // what it ranks
  fmt: Fmt;
  dir: "asc" | "desc"; // asc: lowest first
  param?: ParamKind;
  defaultParam?: string;
  jt?: boolean; // needs Journey Tracker
  fromOne?: boolean; // needs Road to Sixty from level 1
}

export const BOARDS: BoardDef[] = [
  { id: "to60", group: "leveling", title: "Fastest to 60", sub: "Played time from level 1 to 60", fmt: "duration", dir: "asc", fromOne: true },
  { id: "tolevel", group: "leveling", title: "Fastest to level {p}", sub: "Played time from level 1", fmt: "duration", dir: "asc", param: "milestone", defaultParam: "30", fromOne: true },
  { id: "levelfast", group: "leveling", title: "Fastest level {p}", sub: "Played time on that one level", fmt: "duration", dir: "asc", param: "level", defaultParam: "20" },
  { id: "levelslow", group: "leveling", title: "Longest level {p}", sub: "Played time on that one level", fmt: "duration", dir: "desc", param: "level", defaultParam: "20" },
  { id: "first60", group: "leveling", title: "First to 60", sub: "Date the character reached 60", fmt: "date", dir: "asc" },
  { id: "xph", group: "leveling", title: "Best XP per hour", sub: "Best session of an hour or more", fmt: "xp", dir: "desc" },
  { id: "quests", group: "leveling", title: "Most quests", sub: "Quests turned in", fmt: "count", dir: "desc" },
  { id: "kills", group: "leveling", title: "Most kills", sub: "Creatures killed", fmt: "count", dir: "desc" },

  { id: "fewdeaths60", group: "survival", title: "Fewest deaths to 60", sub: "Deaths from level 1 to 60; ties go to the faster", fmt: "deaths", dir: "asc", fromOne: true },
  { id: "alive", group: "survival", title: "Longest alive", sub: "Most played time between two deaths", fmt: "duration", dir: "desc" },
  { id: "deathless", group: "survival", title: "Deathless", sub: "Highest level reached before the first death", fmt: "level", dir: "desc", fromOne: true },
  { id: "deaths", group: "survival", title: "Most deaths", sub: "Deaths, all time", fmt: "count", dir: "desc" },

  { id: "goldat", group: "gold", title: "Richest at level {p}", sub: "Gold held on reaching the level", fmt: "gold", dir: "desc", param: "goldLevel", defaultParam: "40" },
  { id: "goldpeak", group: "gold", title: "Most gold held", sub: "Most gold held at any login, logout or level-up", fmt: "gold", dir: "desc" },
  { id: "goldsession", group: "gold", title: "Best gold session", sub: "Gold gained per played hour, sessions of an hour or more", fmt: "goldHour", dir: "desc" },
  { id: "questgold", group: "gold", title: "Most quest gold", sub: "Gold from quest rewards", fmt: "gold", dir: "desc" },
  { id: "goldearned", group: "gold", title: "Most gold earned", sub: "Every copper that came in", fmt: "gold", dir: "desc", jt: true },
  { id: "goldah", group: "gold", title: "Most auction house gold", sub: "Gold from auction sales", fmt: "gold", dir: "desc", jt: true },
  { id: "repairs", group: "gold", title: "Most spent on repairs", sub: "Gold paid to repair gear", fmt: "gold", dir: "desc", jt: true },

  { id: "prof300", group: "professions", title: "Fastest to 300 in {p}", sub: "Played time from learning it to 300", fmt: "duration", dir: "asc", param: "profession" },
  { id: "prof225", group: "professions", title: "Fastest to 225 in {p}", sub: "Played time from learning it to 225", fmt: "duration", dir: "asc", param: "profession" },
  { id: "prof150", group: "professions", title: "Fastest to 150 in {p}", sub: "Played time from learning it to 150", fmt: "duration", dir: "asc", param: "profession" },
  { id: "youngartisan", group: "professions", title: "Youngest 300 in {p}", sub: "Lowest character level on reaching 300", fmt: "level", dir: "asc", param: "profession" },
  { id: "gathered", group: "professions", title: "Most gathered", sub: "Nodes and fishing catches", fmt: "count", dir: "desc" },
  { id: "crafted", group: "professions", title: "Most crafted", sub: "Items made, counting stacks", fmt: "count", dir: "desc" },

  { id: "zonetime", group: "world", title: "Most time in {p}", sub: "Played time spent there", fmt: "duration", dir: "desc", param: "zone" },
  { id: "distance", group: "world", title: "Farthest travelled", sub: "On foot or mounted", fmt: "distance", dir: "desc" },
  { id: "flown", group: "world", title: "Farthest flown", sub: "By flight path", fmt: "distance", dir: "desc" },
  { id: "zones", group: "world", title: "Most zones visited", sub: "Zones entered", fmt: "count", dir: "desc" },

  { id: "dungeonrun", group: "dungeons", title: "Fastest run: {p}", sub: "Time inside, runs with 10 or more kills", fmt: "duration", dir: "asc", param: "dungeon" },
  { id: "youngclear", group: "dungeons", title: "Lowest level run: {p}", sub: "Character level, runs with 10 or more kills", fmt: "level", dir: "asc", param: "dungeon" },
  { id: "runs", group: "dungeons", title: "Most dungeon runs", sub: "Dungeon runs", fmt: "count", dir: "desc" },
  { id: "epics", group: "dungeons", title: "Most epics looted", sub: "Epic items looted", fmt: "count", dir: "desc" },

  { id: "hk", group: "pvp", title: "Most honorable kills", sub: "In battlegrounds", fmt: "count", dir: "desc" },
  { id: "bgwins", group: "pvp", title: "Most battleground wins", sub: "Battlegrounds won", fmt: "count", dir: "desc" },
  { id: "winrate", group: "pvp", title: "Best win rate", sub: "Battlegrounds, at least 20 finished", fmt: "percent", dir: "desc" },
  { id: "duels", group: "pvp", title: "Most duels won", sub: "Duels won", fmt: "count", dir: "desc" },
];

export const BOARD_BY_ID = new Map(BOARDS.map((b) => [b.id, b]));

// The cards on the leaderboards page: one card per entry, with a switch
// between its boards when there's more than one.
export interface CardDef {
  title: string;
  boards: { id: string; label: string }[];
}

export const CARDS: Record<GroupId, CardDef[]> = {
  leveling: [
    { title: "Fastest to 60", boards: [{ id: "to60", label: "" }] },
    { title: "Fastest to level", boards: [{ id: "tolevel", label: "" }] },
    { title: "One level", boards: [{ id: "levelfast", label: "Fastest" }, { id: "levelslow", label: "Longest" }] },
    { title: "First to 60", boards: [{ id: "first60", label: "" }] },
    { title: "Best XP per hour", boards: [{ id: "xph", label: "" }] },
    { title: "Most quests and kills", boards: [{ id: "quests", label: "Quests" }, { id: "kills", label: "Kills" }] },
  ],
  survival: [
    { title: "Fewest deaths to 60", boards: [{ id: "fewdeaths60", label: "" }] },
    { title: "Longest alive", boards: [{ id: "alive", label: "" }] },
    { title: "Deathless", boards: [{ id: "deathless", label: "" }] },
    { title: "Most deaths", boards: [{ id: "deaths", label: "" }] },
  ],
  gold: [
    { title: "Richest at level", boards: [{ id: "goldat", label: "" }] },
    { title: "Most gold held", boards: [{ id: "goldpeak", label: "" }] },
    { title: "Best gold session", boards: [{ id: "goldsession", label: "" }] },
    { title: "Most quest gold", boards: [{ id: "questgold", label: "" }] },
    { title: "Lifetime gold", boards: [{ id: "goldearned", label: "Earned" }, { id: "goldah", label: "Auction house" }, { id: "repairs", label: "Repairs" }] },
  ],
  professions: [
    { title: "Fastest skill-up", boards: [{ id: "prof300", label: "To 300" }, { id: "prof225", label: "To 225" }, { id: "prof150", label: "To 150" }] },
    { title: "Youngest Artisan", boards: [{ id: "youngartisan", label: "" }] },
    { title: "Gathering and crafting", boards: [{ id: "gathered", label: "Gathered" }, { id: "crafted", label: "Crafted" }] },
  ],
  world: [
    { title: "Most time in a zone", boards: [{ id: "zonetime", label: "" }] },
    { title: "Farthest travelled", boards: [{ id: "distance", label: "On foot" }, { id: "flown", label: "Flown" }] },
    { title: "Most zones visited", boards: [{ id: "zones", label: "" }] },
  ],
  dungeons: [
    { title: "Fastest run", boards: [{ id: "dungeonrun", label: "" }] },
    { title: "Lowest level run", boards: [{ id: "youngclear", label: "" }] },
    { title: "Most runs and epics", boards: [{ id: "runs", label: "Runs" }, { id: "epics", label: "Epics" }] },
  ],
  pvp: [
    { title: "Battlegrounds", boards: [{ id: "hk", label: "Honorable kills" }, { id: "bgwins", label: "Wins" }] },
    { title: "Best win rate", boards: [{ id: "winrate", label: "" }] },
    { title: "Most duels won", boards: [{ id: "duels", label: "" }] },
  ],
};

export const MILESTONES = ["10", "20", "30", "40", "50"];
export const GOLD_LEVELS = ["20", "30", "40", "50", "60"];
export const ONE_LEVELS = Array.from({ length: 59 }, (_, i) => String(i + 1));

// The params a board can take, when they're a fixed list.
export function fixedParams(kind: ParamKind | undefined): string[] | undefined {
  if (kind === "milestone") return MILESTONES;
  if (kind === "goldLevel") return GOLD_LEVELS;
  if (kind === "level") return ONE_LEVELS;
  return undefined;
}

export function boardTitle(b: BoardDef, param: string): string {
  return b.title.replace("{p}", param);
}

// One number for one board. t (0 to 1) breaks ties, lower first.
export interface BoardEntry {
  b: string;
  p: string;
  v: number;
  t?: number;
}

// ---------------------------------------------------------------- display

export function formatValue(fmt: Fmt, v: number): string {
  switch (fmt) {
    case "duration": {
      const d = Math.floor(v / 86400), h = Math.floor((v % 86400) / 3600), m = Math.floor((v % 3600) / 60), s = Math.floor(v % 60);
      if (d) return `${d}d ${h}h ${String(m).padStart(2, "0")}m`;
      if (h) return `${h}h ${String(m).padStart(2, "0")}m`;
      return `${m}m ${String(s).padStart(2, "0")}s`;
    }
    case "date":
      return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" }).format(new Date(v * 1000));
    case "gold":
      return `${Math.floor(v / 10000).toLocaleString("en-US")}g`;
    case "goldHour":
      return `${Math.floor(v / 10000).toLocaleString("en-US")}g/h`;
    case "xp":
      return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v));
    case "distance":
      return `${(v / 1093.6133).toLocaleString("en-US", { maximumFractionDigits: 1 })} km`;
    case "percent":
      return `${v.toFixed(1)}%`;
    case "level":
      return `Level ${v}`;
    case "deaths":
      return v === 1 ? "1 death" : `${v} deaths`;
    default:
      return Math.round(v).toLocaleString("en-US");
  }
}
