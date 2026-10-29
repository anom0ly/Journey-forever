// Zones of the Forever client with their world rectangles, from
// map-data.json (scripts/fetch-map-data.ts writes it from wago.tools).

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
}

export const MAPS: MapInfo[] = data.zones;
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

// 0-1 coordinates on a zone's map to world yards: map x runs east (world y
// falls from maxY), map y runs south (world x falls from maxX).
export function mapToWorld(mapID: unknown, mx: number, my: number): { c: number; x: number; y: number } | undefined {
  const m = mapInfo(mapID);
  if (!m || m.type !== 3) return undefined;
  return { c: m.c, x: Math.round(m.maxX - my * (m.maxX - m.minX)), y: Math.round(m.maxY - mx * (m.maxY - m.minY)) };
}
