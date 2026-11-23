import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/worker/env";
import worker from "../src/worker/index";
import { REFILL_PER_RUN, refillMapTiles, TILES } from "../src/worker/maps";

const BLP = new TextEncoder().encode("BLP2....tile").buffer;
const ids = [...TILES];

function fakeR2(keys: string[] = []) {
  const store = new Map<string, ArrayBuffer>(keys.map((k) => [k, BLP]));
  const r2 = {
    get: async (k: string) => (store.has(k) ? { body: store.get(k) } : null),
    put: async (k: string, v: ArrayBuffer) => void store.set(k, v),
    list: async ({ prefix, cursor }: { prefix: string; cursor?: string }) => {
      const all = [...store.keys()].filter((k) => k.startsWith(prefix)).sort();
      const start = Number(cursor ?? 0);
      const page = all.slice(start, start + 1000);
      const truncated = start + 1000 < all.length;
      return { objects: page.map((key) => ({ key })), truncated, cursor: truncated ? String(start + 1000) : undefined };
    },
  };
  return { store, env: { FILES: r2 } as unknown as Env };
}

// wago.tools answers in this order, then 200 for everything after.
function wago(...statuses: number[]) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (u: string) => {
    calls.push(u);
    const status = statuses.shift() ?? 200;
    return new Response(status === 200 ? BLP : "no", { status });
  });
  return calls;
}

const get = (env: Env, id: number) => worker.fetch(new Request(`https://jf.example/maps/${id}.blp`), env);

afterEach(() => vi.unstubAllGlobals());

describe("map tiles", () => {
  it("retries once when wago refuses, then stores the tile", async () => {
    const { store, env } = fakeR2();
    const calls = wago(429);
    const res = await get(env, ids[0]);
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(2);
    expect(store.size).toBe(1);
  });

  it("logs wago's answer when both tries fail", async () => {
    const { env } = fakeR2();
    wago(503, 503);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await get(env, ids[0]);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Map art isn't available right now" });
    expect(String(log.mock.calls[0][1])).toContain(`tile ${ids[0]}: wago 503`);
    log.mockRestore();
  });

  it("doesn't retry a 404", async () => {
    const { env } = fakeR2();
    const calls = wago(404);
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await get(env, ids[0])).status).toBe(502);
    expect(calls).toHaveLength(1);
    vi.restoreAllMocks();
  });

  it("serves a stored tile without asking wago", async () => {
    const { env } = fakeR2();
    await get(env, ids[0]);
    const calls = wago();
    expect((await get(env, ids[0])).status).toBe(200);
    expect(calls).toHaveLength(0);
  });
});

describe("weekly refill", () => {
  it("copies only missing tiles, a batch per run", async () => {
    const { store, env } = fakeR2();
    await get(env, ids[0]);
    const before = store.size;
    const calls = wago();
    vi.spyOn(console, "log").mockImplementation(() => {});
    const r = await refillMapTiles(env);
    expect(r).toEqual({ missing: TILES.size - before, copied: REFILL_PER_RUN, failed: [] });
    expect(calls).toHaveLength(REFILL_PER_RUN);
    expect(calls.some((u) => u.includes(`/${ids[0]}?`))).toBe(false);
    expect(store.size).toBe(before + REFILL_PER_RUN);
    vi.restoreAllMocks();
  });

  it("does nothing when every tile is stored", async () => {
    const { env, store } = fakeR2();
    const prefix = [...(await (async () => (await get(env, ids[0]), store.keys()))())][0].replace(/\d+\.blp$/, "");
    for (const id of ids) store.set(`${prefix}${id}.blp`, BLP);
    const calls = wago();
    vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await refillMapTiles(env)).toEqual({ missing: 0, copied: 0, failed: [] });
    expect(calls).toHaveLength(0);
    vi.restoreAllMocks();
  });
});
