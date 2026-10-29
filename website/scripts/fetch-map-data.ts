// Fetches the Forever client's zone list and world bounds from wago.tools
// (the UiMap and UiMapAssignment tables) into src/lib/map-data.json, which
// the replay draws zone outlines and names from.
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
  });
}
zones.sort((a, b) => a.id - b.id);
const out = join(dirname(new URL(import.meta.url).pathname), "..", "src", "lib", "map-data.json");
writeFileSync(out, JSON.stringify({ source: `wago.tools UiMap and UiMapAssignment, build ${build}`, zones }, null, 1) + "\n");
console.log(`Wrote ${zones.length} maps from build ${build} to ${out}`);
