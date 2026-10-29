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
  art?: { w: number; h: number; tileW: number; tileH: number; tiles: number[][] };
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
