// Map art tiles: the Forever client's own BLP textures, listed in
// map-data.json. Each one is copied from wago.tools into R2 the first time
// someone asks for it, then served from R2. Only listed tiles are fetched,
// so this can't be used to pull arbitrary files through the Worker.

import data from "../lib/map-data.json";
import type { Env } from "./env";
import { HttpError } from "./http";

const TILES = new Set<number>(data.zones.flatMap((z) => z.art?.tiles.map((t) => t[2]) ?? []));
const MAX_TILE = 2_000_000;

export async function handleMapTile(env: Env, url: URL): Promise<Response> {
  const m = /^\/maps\/(\d+)\.blp$/.exec(url.pathname);
  const id = m ? Number(m[1]) : NaN;
  if (!TILES.has(id)) throw new HttpError(404, "Not found");
  const key = `maps/${data.build}/${id}.blp`;
  const headers = { "content-type": "application/octet-stream", "cache-control": "public, max-age=31536000, immutable" };

  const obj = await env.FILES.get(key);
  if (obj) return new Response(obj.body, { headers });

  const res = await fetch(`https://wago.tools/api/casc/${id}?download&build=${data.build}`, {
    headers: { "user-agent": "journey-forever (github.com/anom0ly/Journey-forever)" },
  }).catch(() => undefined);
  if (!res?.ok) throw new HttpError(502, "Map art isn't available right now");
  const body = await res.arrayBuffer();
  if (body.byteLength > MAX_TILE || new TextDecoder().decode(body.slice(0, 4)) !== "BLP2") {
    throw new HttpError(502, "Map art isn't available right now");
  }
  await env.FILES.put(key, body, { httpMetadata: { contentType: "application/octet-stream" } });
  return new Response(body, { headers });
}
