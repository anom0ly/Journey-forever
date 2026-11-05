// Zones of the Forever client with their world rectangles and map art,
// from map-data.json (scripts/fetch-map-data.ts writes it from wago.tools).

import data from "./map-data.json";

export interface MapInfo {
  id: number;
  name: string;
  parent: number;
  type: number; // 2 continent, 3 zone
  c: number; // the continent's instance ID world positions are given on
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  // The map's art: w x h pixels laid out from tiles of tileW x tileH,
  // each [row, column, file ID]. Covers exactly the world rectangle above.
  // The base tiles are the unexplored look; overlays (x, y, w, h on the
  // art, tiles overlayTile pixels square) fill in every explored area.
  art?: {
    w: number; h: number; tileW: number; tileH: number; tiles: number[][];
    overlays?: { x: number; y: number; w: number; h: number; tiles: number[][] }[];
    overlayTile?: number;
  };
}

export const MAPS: MapInfo[] = data.zones;
export const ART_BUILD: string = data.build;
const BY_ID = new Map(MAPS.map((m) => [m.id, m]));

export function mapInfo(id: unknown): MapInfo | undefined {
  return typeof id === "number" ? BY_ID.get(id) : undefined;
}

// The zones on a continent, largest first so small ones draw on top.
export function zonesOn(c: number): MapInfo[] {
  return MAPS.filter((m) => m.type === 3 && m.c === c).sort(
    (a, b) => (b.maxX - b.minX) * (b.maxY - b.minY) - (a.maxX - a.minX) * (a.maxY - a.minY),
  );
}

// The map of a whole continent. The client has a second, smaller one for
// each (a later overview); the first listed is the world map's.
export function continentMap(c: number): MapInfo | undefined {
  return MAPS.find((m) => m.type === 2 && m.c === c);
}

// 0-1 coordinates on a zone's map to world yards: map x runs east (world y
// falls from maxY), map y runs south (world x falls from maxX).
export function mapToWorld(mapID: unknown, mx: number, my: number): { c: number; x: number; y: number } | undefined {
  const m = mapInfo(mapID);
  if (!m || m.type !== 3) return undefined;
  return { c: m.c, x: Math.round(m.maxX - my * (m.maxX - m.minX)), y: Math.round(m.maxY - mx * (m.maxY - m.minY)) };
}

// The capital cities, each with the zone it sits in. A city's map is far
// smaller than its zone's, so the replay keeps the zone's map up and lays
// the city's over its spot. Hard-coded: the zones' world rectangles overlap
// (Undercity lies inside Silverpine's and Western Plaguelands' too).
const CITY_ZONE: Record<number, number> = {
  1453: 1429, // Stormwind City: Elwynn Forest
  1454: 1411, // Orgrimmar: Durotar
  1455: 1426, // Ironforge: Dun Morogh
  1456: 1412, // Thunder Bluff: Mulgore
  1457: 1438, // Darnassus: Teldrassil
  1458: 1420, // Undercity: Tirisfal Glades
};

export function isCity(id: number | undefined): boolean {
  return id !== undefined && id in CITY_ZONE;
}

// The zone a city sits in; any other map is its own zone.
export function homeZone(id: number): number {
  return CITY_ZONE[id] ?? id;
}

// The cities on a continent.
export function citiesOn(c: number): MapInfo[] {
  return MAPS.filter((m) => m.c === c && isCity(m.id));
}
