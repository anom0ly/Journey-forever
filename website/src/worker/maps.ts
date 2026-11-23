// Map art tiles (base art and explored-area overlays): the Forever client's
// own BLP textures, listed in
// map-data.json. Each one is copied from wago.tools into R2 the first time
// someone asks for it, then served from R2. Only listed tiles are fetched,
// so this can't be used to pull arbitrary files through the Worker.
//
// A weekly job (refillMapTiles, the cron in wrangler.jsonc) also copies any
// listed tile that isn't in R2 yet, so players don't depend on wago.tools
// answering at the moment they open a map. Stored tiles are never fetched
// again: a tile is a file of one game build, and a new build gets new keys.

import data from "../lib/map-data.json";
import type { Env } from "./env";
import { HttpError } from "./http";

export const TILES = new Set<number>(
  data.zones.flatMap((z) => [
    ...(z.art?.tiles.map((t) => t[2]) ?? []),
    ...(z.art?.overlays?.flatMap((o) => o.tiles.map((t) => t[2])) ?? []),
  ]),
);
const MAX_TILE = 2_000_000;
const PREFIX = `maps/${data.build}/`;
// Pause before the one retry when wago.tools refuses a tile.
export const RETRY_MS = 800;
// Tiles the weekly job copies per run. Kept under the free plan's 50
// outside requests per run (each tile is at most 2 fetches with its retry).
export const REFILL_PER_RUN = 24;

export async function handleMapTile(env: Env, url: URL): Promise<Response> {
  const m = /^\/maps\/(\d+)\.blp$/.exec(url.pathname);
  const id = m ? Number(m[1]) : NaN;
  if (!TILES.has(id)) throw new HttpError(404, "Not found");
  const headers = { "content-type": "application/octet-stream", "cache-control": "public, max-age=31536000, immutable" };

  const obj = await env.FILES.get(PREFIX + id + ".blp");
  if (obj) return new Response(obj.body, { headers });

  const got = await copyTile(env, id);
  if (typeof got === "string") {
    // The message carries wago's answer, so the alert says why.
    throw new HttpError(502, "Map art isn't available right now", `tile ${id}: ${got}`);
  }
  return new Response(got, { headers });
}

// Fetches one tile from wago.tools (retrying once) and stores it in R2.
// Returns the file, or what went wrong ("wago 429", "network", "not a BLP").
async function copyTile(env: Env, id: number): Promise<ArrayBuffer | string> {
  let why = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, RETRY_MS));
    const res = await fetch(`https://wago.tools/api/casc/${id}?download&build=${data.build}`, {
      headers: { "user-agent": "journey-forever (github.com/anom0ly/Journey-forever)" },
    }).catch(() => undefined);
    if (!res) {
      why = "network";
      continue;
    }
    if (!res.ok) {
      why = `wago ${res.status}`;
      // A missing file won't appear on a second try.
      if (res.status === 404) break;
      continue;
    }
    const body = await res.arrayBuffer();
    if (body.byteLength > MAX_TILE || new TextDecoder().decode(body.slice(0, 4)) !== "BLP2") {
      why = "not a BLP";
      break;
    }
    await env.FILES.put(PREFIX + id + ".blp", body, { httpMetadata: { contentType: "application/octet-stream" } });
    return body;
  }
  return why;
}

// The weekly job: finds listed tiles that aren't in R2 and copies up to
// REFILL_PER_RUN of them. Logs what it did; an error only if a tile failed.
export async function refillMapTiles(env: Env): Promise<{ missing: number; copied: number; failed: string[] }> {
  const stored = new Set<number>();
  let cursor: string | undefined;
  do {
    const page = await env.FILES.list({ prefix: PREFIX, cursor, limit: 1000 });
    for (const o of page.objects) stored.add(Number(o.key.slice(PREFIX.length, -".blp".length)));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  const missing = [...TILES].filter((id) => !stored.has(id));
  let copied = 0;
  const failed: string[] = [];
  for (const id of missing.slice(0, REFILL_PER_RUN)) {
    const got = await copyTile(env, id);
    if (typeof got === "string") failed.push(`${id}: ${got}`);
    else copied++;
  }
  const result = { missing: missing.length, copied, failed };
  const line = `Map art refill: ${missing.length} missing of ${TILES.size}, copied ${copied}`;
  if (failed.length) console.error(new Error(`${line}, ${failed.length} failed`), JSON.stringify(failed));
  else console.log(line);
  return result;
}
