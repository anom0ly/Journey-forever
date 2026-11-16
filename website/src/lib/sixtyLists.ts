// Raids, their bosses and the factions, as plain lists: the leaderboards' catalogue
// (boardDefs.ts) and the Worker read them without the rest of sixty.ts.

export interface Raid {
  name: string;
  aliases: string[]; // other names the game gives the instance
  bosses: string[]; // in the usual kill order, as the game names the encounters
}

export const RAIDS: Raid[] = [
  {
    name: "Molten Core",
    aliases: [],
    bosses: ["Lucifron", "Magmadar", "Gehennas", "Garr", "Shazzrah", "Baron Geddon", "Golemagg the Incinerator", "Sulfuron Harbinger", "Majordomo Executus", "Ragnaros"],
  },
  { name: "Onyxia's Lair", aliases: [], bosses: ["Onyxia"] },
  {
    name: "Blackwing Lair",
    aliases: [],
    bosses: ["Razorgore the Untamed", "Vaelastrasz the Corrupt", "Broodlord Lashlayer", "Firemaw", "Ebonroc", "Flamegor", "Chromaggus", "Nefarian"],
  },
  {
    name: "Zul'Gurub",
    aliases: [],
    bosses: ["High Priestess Jeklik", "High Priest Venoxis", "High Priestess Mar'li", "Bloodlord Mandokir", "Edge of Madness", "Gahz'ranka", "High Priest Thekal", "High Priestess Arlokk", "Jin'do the Hexxer", "Hakkar"],
  },
  {
    name: "Ruins of Ahn'Qiraj",
    aliases: [],
    bosses: ["Kurinnaxx", "General Rajaxx", "Moam", "Buru the Gorger", "Ayamiss the Hunter", "Ossirian the Unscarred"],
  },
  {
    name: "Temple of Ahn'Qiraj",
    aliases: ["Ahn'Qiraj Temple", "Ahn'Qiraj"],
    bosses: ["The Prophet Skeram", "Silithid Royalty", "Battleguard Sartura", "Fankriss the Unyielding", "Viscidus", "Princess Huhuran", "Twin Emperors", "Ouro", "C'Thun"],
  },
  {
    name: "Naxxramas",
    aliases: [],
    bosses: [
      "Anub'Rekhan", "Grand Widow Faerlina", "Maexxna", "Noth the Plaguebringer", "Heigan the Unclean", "Loatheb", "Instructor Razuvious",
      "Gothik the Harvester", "The Four Horsemen", "Patchwerk", "Grobbulus", "Gluth", "Thaddius", "Sapphiron", "Kel'Thuzad",
    ],
  },
];

export const RAID_BOSSES = RAIDS.flatMap((r) => r.bosses);

export const FACTIONS = [
  "Argent Dawn", "Bloodsail Buccaneers", "Booty Bay", "Brood of Nozdormu", "Cenarion Circle", "Darkmoon Faire", "Darkspear Trolls",
  "Darnassus", "Everlook", "Frostwolf Clan", "Gadgetzan", "Gnomeregan", "Gnomeregan Exiles", "Hydraxian Waterlords", "Ironforge",
  "Orgrimmar", "Ratchet", "Ravenholdt", "Shen'dralar", "Silverwing Sentinels", "Stormpike Guard", "Stormwind", "The Defilers",
  "The League of Arathor", "Thorium Brotherhood", "Thunder Bluff", "Timbermaw Hold", "Undercity", "Warsong Outriders",
  "Wintersaber Trainers", "Zandalar Tribe",
];
