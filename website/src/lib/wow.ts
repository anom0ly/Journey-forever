import type { Item } from "./journey";

// Zone names by uiMapID, for the classic world as the modern client numbers
// it. Names the saved files give (Journey Tracker writes them next to map
// IDs) win over these, so Forever renaming or renumbering a zone shows right
// once a file mentions it.
export const ZONE_NAMES: Record<number, string> = {
  1411: "Durotar", 1412: "Mulgore", 1413: "The Barrens", 1414: "Kalimdor", 1415: "Eastern Kingdoms",
  1416: "Alterac Mountains", 1417: "Arathi Highlands", 1418: "Badlands", 1419: "Blasted Lands",
  1420: "Tirisfal Glades", 1421: "Silverpine Forest", 1422: "Western Plaguelands", 1423: "Eastern Plaguelands",
  1424: "Hillsbrad Foothills", 1425: "The Hinterlands", 1426: "Dun Morogh", 1427: "Searing Gorge",
  1428: "Burning Steppes", 1429: "Elwynn Forest", 1430: "Deadwind Pass", 1431: "Duskwood", 1432: "Loch Modan",
  1433: "Redridge Mountains", 1434: "Stranglethorn Vale", 1435: "Swamp of Sorrows", 1436: "Westfall",
  1437: "Wetlands", 1438: "Teldrassil", 1439: "Darkshore", 1440: "Ashenvale", 1441: "Thousand Needles",
  1442: "Stonetalon Mountains", 1443: "Desolace", 1444: "Feralas", 1445: "Dustwallow Marsh", 1446: "Tanaris",
  1447: "Azshara", 1448: "Felwood", 1449: "Un'Goro Crater", 1450: "Moonglade", 1451: "Silithus",
  1452: "Winterspring", 1453: "Stormwind City", 1454: "Orgrimmar", 1455: "Ironforge", 1456: "Thunder Bluff",
  1457: "Darnassus", 1458: "Undercity", 1459: "Alterac Valley", 1460: "Warsong Gulch", 1461: "Arathi Basin",
};

// Continents by the instance ID world positions are given on.
export const CONTINENT_NAMES: Record<number, string> = {
  0: "Eastern Kingdoms",
  1: "Kalimdor",
};

export function continentName(c: number): string {
  return CONTINENT_NAMES[c] ?? `Continent ${c}`;
}

export const QUALITY_NAMES = ["Poor", "Common", "Uncommon", "Rare", "Epic", "Legendary", "Artifact", "Heirloom"];

// Item quality colours from the game's own palette.
export const QUALITY_COLORS = ["#9d9d9d", "#ffffff", "#1eff00", "#0070dd", "#a335ee", "#ff8000", "#e6cc80", "#00ccff"];

const QUALITY_BY_HEX: Record<string, number> = {
  "9d9d9d": 0, ffffff: 1, "1eff00": 2, "0070dd": 3, a335ee: 4, ff8000: 5, e6cc80: 6, "00ccff": 7,
};

// An item from a chat link ("|cffa335ee|Hitem:12345:...|h[Name]|h|r") or an
// item string ("item:12345:..."); quality from the link's colour when given.
export function parseItem(link: unknown, quality?: unknown): Item | undefined {
  if (typeof link !== "string" && typeof link !== "number") return undefined;
  if (typeof link === "number") return { id: link };
  const item: Item = {};
  const id = /item:(\d+)/.exec(link);
  if (id) item.id = Number(id[1]);
  const name = /\|h\[([^\]]*)\]\|h/.exec(link);
  if (name) item.name = name[1];
  const color = /\|c[fF]{2}([0-9a-fA-F]{6})/.exec(link);
  if (typeof quality === "number") item.quality = quality;
  else if (color && color[1].toLowerCase() in QUALITY_BY_HEX) item.quality = QUALITY_BY_HEX[color[1].toLowerCase()];
  return item.id !== undefined || item.name !== undefined ? item : undefined;
}

export const CLASS_COLORS: Record<string, string> = {
  WARRIOR: "#C69B6D", PALADIN: "#F48CBA", HUNTER: "#AAD372", ROGUE: "#FFF468", PRIEST: "#FFFFFF",
  SHAMAN: "#0070DD", MAGE: "#3FC7EB", WARLOCK: "#8788EE", DRUID: "#FF7C0A", DEATHKNIGHT: "#C41E3A",
  MONK: "#00FF98", DEMONHUNTER: "#A330C9", EVOKER: "#33937F",
};

export function className(file?: string): string {
  if (!file) return "";
  const names: Record<string, string> = { DEATHKNIGHT: "Death Knight", DEMONHUNTER: "Demon Hunter" };
  return names[file] ?? file.charAt(0) + file.slice(1).toLowerCase();
}

export function raceName(file?: string): string {
  if (!file) return "";
  const names: Record<string, string> = {
    NightElf: "Night Elf", BloodElf: "Blood Elf", Scourge: "Undead", HighmountainTauren: "Highmountain Tauren",
    VoidElf: "Void Elf", LightforgedDraenei: "Lightforged Draenei", DarkIronDwarf: "Dark Iron Dwarf",
    MagharOrc: "Mag'har Orc", KulTiran: "Kul Tiran", ZandalariTroll: "Zandalari Troll",
  };
  return names[file] ?? file.replace(/([a-z])([A-Z])/g, "$1 $2");
}

export const STANDINGS = ["", "Hated", "Hostile", "Unfriendly", "Neutral", "Friendly", "Honored", "Revered", "Exalted"];

export const SLOT_NAMES: Record<number, string> = {
  1: "Head", 2: "Neck", 3: "Shoulder", 4: "Shirt", 5: "Chest", 6: "Waist", 7: "Legs", 8: "Feet", 9: "Wrist",
  10: "Hands", 11: "Finger", 12: "Finger", 13: "Trinket", 14: "Trinket", 15: "Back", 16: "Main hand",
  17: "Off hand", 18: "Ranged", 19: "Tabard",
};
