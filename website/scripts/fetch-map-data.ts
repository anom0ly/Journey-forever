// Fetches the Forever client's zone list, world bounds and map art tiles
// from wago.tools (the UiMap, UiMapAssignment and UiMapArt tables) into
// src/lib/map-data.json, with the explored-area overlays (WorldMapOverlay)
// so maps show fully explored. The replay draws each map's art from those tiles,
// which the Worker copies from wago.tools into R2 on first use.
// Run: node --experimental-strip-types scripts/fetch-map-data.ts [build]
// With no build, the newest "wowf" (WoW Forever) build is used.

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

async function text(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.text();
}

// Enough CSV for these tables: quoted names may hold commas.
function rows(csv: string): Record<string, string>[] {
  const lines = csv.trim().split(/\r?\n/);
  const split = (line: string) => {
    const out: string[] = [];
    let cur = "", quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') quoted = false;
        else cur += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ",") { out.push(cur); cur = ""; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  };
  const head = split(lines[0]);
  return lines.slice(1).map((l) => Object.fromEntries(split(l).map((v, i) => [head[i], v])));
}

let build = process.argv[2];
if (!build) {
  const builds = JSON.parse(await text("https://wago.tools/api/builds")) as Record<string, { version: string }[]>;
  build = builds.wowf[0].version;
}
const maps = rows(await text(`https://wago.tools/db2/UiMap/csv?build=${build}`));
const assignments = rows(await text(`https://wago.tools/db2/UiMapAssignment/csv?build=${build}`));
const mapArt = rows(await text(`https://wago.tools/db2/UiMapXMapArt/csv?build=${build}`));
const arts = rows(await text(`https://wago.tools/db2/UiMapArt/csv?build=${build}`));
const styles = rows(await text(`https://wago.tools/db2/UiMapArtStyleLayer/csv?build=${build}`));
const artTiles = rows(await text(`https://wago.tools/db2/UiMapArtTile/csv?build=${build}`));
const overlays = rows(await text(`https://wago.tools/db2/WorldMapOverlay/csv?build=${build}`));
const overlayTiles = rows(await text(`https://wago.tools/db2/WorldMapOverlayTile/csv?build=${build}`));

// The explored areas drawn over a map's base art, which on its own is the
// unexplored look: each overlay's place and size on the art, and its tiles
// [row, column, file ID] of OVERLAY_TILE pixels each.
const OVERLAY_TILE = 256;
function overlaysOf(artID: string) {
  return overlays
    .filter((o) => o.UiMapArtID === artID && o.PlayerConditionID === "0")
    .sort((a, b) => Number(a.ID) - Number(b.ID))
    .map((o) => {
      const tiles = overlayTiles
        .filter((t) => t.WorldMapOverlayID === o.ID && t.LayerIndex === "0")
        .map((t) => [Number(t.RowIndex), Number(t.ColIndex), Number(t.FileDataID)])
        .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      return { x: Number(o.OffsetX), y: Number(o.OffsetY), w: Number(o.TextureWidth), h: Number(o.TextureHeight), tiles };
    })
    .filter((o) => o.tiles.length);
}

// A map's art: its base layer's size and the tiles it is cut into, as
// [row, column, file ID]. Tiles are BLP textures, tileW x tileH each,
// cropped to w x h once laid out.
function artOf(mapID: string) {
  const link = mapArt.find((r) => r.UiMapID === mapID && r.PhaseID === "0");
  const art = link && arts.find((r) => r.ID === link.UiMapArtID);
  const style = art && styles.find((r) => r.UiMapArtStyleID === art.UiMapArtStyleID && r.LayerIndex === "0");
  if (!link || !style) return undefined;
  const tiles = artTiles
    .filter((r) => r.UiMapArtID === link.UiMapArtID && r.LayerIndex === "0")
    .map((r) => [Number(r.RowIndex), Number(r.ColIndex), Number(r.FileDataID)])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (!tiles.length) return undefined;
  const explored = overlaysOf(link.UiMapArtID);
  return {
    w: Number(style.LayerWidth), h: Number(style.LayerHeight), tileW: Number(style.TileWidth), tileH: Number(style.TileHeight), tiles,
    ...(explored.length ? { overlays: explored, overlayTile: OVERLAY_TILE } : {}),
  };
}

// Each map's world rectangle on its continent: the assignment covering the
// whole map (0-1 on both axes). Region_0/1 are the minimum world x and y,
// Region_3/4 the maximum.
const zones = [];
for (const m of maps) {
  const type = Number(m.Type);
  if (type !== 2 && type !== 3) continue; // continents and zones
  const a = assignments
    .filter((r) => r.UiMapID === m.ID && Number(r.UiMin_0) === 0 && Number(r.UiMax_0) === 1 && Number(r.UiMin_1) === 0 && Number(r.UiMax_1) === 1)
    .sort((x, y) => Number(x.OrderIndex) - Number(y.OrderIndex))[0];
  if (!a) continue;
  const round = (v: string) => Math.round(Number(v));
  zones.push({
    id: Number(m.ID),
    name: m.Name_lang,
    parent: Number(m.ParentUiMapID),
    type,
    c: Number(a.MapID),
    minX: round(a.Region_0),
    minY: round(a.Region_1),
    maxX: round(a.Region_3),
    maxY: round(a.Region_4),
    art: artOf(m.ID),
  });
}
zones.sort((a, b) => a.id - b.id);
const out = join(dirname(new URL(import.meta.url).pathname), "..", "src", "lib", "map-data.json");
writeFileSync(out, JSON.stringify({ source: `wago.tools UiMap, UiMapAssignment, UiMapArt and WorldMapOverlay, build ${build}`, build, zones }) + "\n");
console.log(`Wrote ${zones.length} maps from build ${build} to ${out}`);
