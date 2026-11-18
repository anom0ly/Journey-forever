import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { readJsonCapped } from "../src/lib/send";
import { MAX_ACCOUNT_BYTES, MAX_CHARACTERS } from "../src/worker/api";
import type { Env } from "../src/worker/env";
import { sniffImage } from "../src/worker/files";
import { sha256 } from "../src/worker/http";
import worker from "../src/worker/index";

const MIGRATIONS = join(import.meta.dirname, "..", "migrations");

// D1 over Node's SQLite, with run() reporting changes like D1 does.
function fakeD1(db: DatabaseSync): D1Database {
  const stmt = (sql: string, args: unknown[] = []) => {
    const params = args.map((a) => (a === undefined ? null : typeof a === "boolean" ? Number(a) : a)) as (string | number | null)[];
    return {
      bind: (...a: unknown[]) => stmt(sql, a),
      first: async () => (db.prepare(sql).get(...params) as unknown) ?? null,
      all: async () => ({ results: db.prepare(sql).all(...params) }),
      run: async () => ({ success: true, meta: { changes: Number(db.prepare(sql).run(...params).changes) } }),
    };
  };
  return {
    prepare: (sql: string) => stmt(sql),
    batch: async (list: { run: () => Promise<unknown> }[]) => {
      const out = [];
      for (const s of list) out.push(await s.run());
      return out;
    },
  } as unknown as D1Database;
}

function fakeR2(): R2Bucket & { m: Map<string, ArrayBuffer> } {
  const m = new Map<string, ArrayBuffer>();
  return {
    m,
    put: async (k: string, v: ArrayBuffer) => void m.set(k, v),
    get: async (k: string) => (m.has(k) ? { body: m.get(k), httpMetadata: {} } : null),
    head: async (k: string) => (m.has(k) ? { size: m.get(k)!.byteLength } : null),
    delete: async (k: string | string[]) => [k].flat().forEach((x) => m.delete(x)),
    list: async () => ({ objects: [], truncated: false }),
  } as unknown as R2Bucket & { m: Map<string, ArrayBuffer> };
}

const ORIGIN = "https://jf.example";

function migrate(db: DatabaseSync, upTo = Infinity) {
  for (const f of readdirSync(MIGRATIONS).sort()) if (Number(f.slice(0, 4)) <= upTo) db.exec(readFileSync(join(MIGRATIONS, f), "utf8"));
}

async function setup(db = new DatabaseSync(":memory:"), migrated = false) {
  if (!migrated) migrate(db);
  const files = fakeR2();
  const env = { DB: fakeD1(db), FILES: files, ADMIN_BNET_IDS: "111" } as unknown as Env;
  for (const [id, bnet] of [["admin", "111"], ["player", "222"], ["other", "333"]]) {
    await env.DB.prepare("INSERT OR IGNORE INTO users (id, bnet_id, battletag, created_at) VALUES (?, ?, ?, 0)").bind(id, bnet, `${id}#1`).run();
    await env.DB.prepare("INSERT OR IGNORE INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, 0, 9999999999)").bind(await sha256(`tok-${id}`), id).run();
  }
  const call = async (path: string, o: { method?: string; json?: unknown; body?: BodyInit; headers?: Record<string, string>; as?: string } = {}) => {
    const headers: Record<string, string> = { "x-journey-forever": "1", cookie: `jf_session=tok-${o.as ?? "player"}`, ...o.headers };
    let body = o.body;
    if (o.json !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(o.json);
    }
    const res = await worker.fetch(new Request(ORIGIN + path, { method: o.method ?? "GET", headers, body }), env);
    return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, unknown> };
  };
  const summary = (key: string, name = "Domonip", realm = "Doomhowl") => ({
    key, name, realm, level: 20, played: 1, quests: 1, distance: 1, deaths: 0, startedAt: 1, lastSeenAt: 2,
  });
  const upload = (key: string, as = "player", name = "Domonip", realm = "Doomhowl") =>
    call(`/api/characters/${encodeURIComponent(key)}`, { method: "PUT", json: summary(key, name, realm), as });
  const makePublic = (key: string, as = "player") => call(`/api/characters/${encodeURIComponent(key)}`, { method: "PATCH", json: { isPublic: true }, as });
  const state = async (userId: string, key: string) =>
    (await env.DB.prepare("SELECT board_state FROM characters WHERE user_id = ? AND key = ?").bind(userId, key).first<{ board_state: number }>())?.board_state;
  return { env, db, files, call, upload, makePublic, state };
}

const GUID = "Player-5000-0A1B2C3D";
const journeyGz = (extra = {}) => gzipSync(JSON.stringify({ format: 1, character: { key: GUID, name: "Domonip" }, events: [], ...extra }));
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);

describe("a reviewer's Hide", () => {
  async function hidden() {
    const t = await setup();
    expect((await t.upload(GUID)).status).toBe(200);
    const slug = (await t.makePublic(GUID)).body.slug as string;
    expect((await t.call(`/api/review/${slug}`, { method: "POST", json: { action: "hide" }, as: "admin" })).status).toBe(200);
    expect(await t.state("player", GUID)).toBe(2);
    return t;
  }

  it("stays after the character is deleted and uploaded again", async () => {
    const t = await hidden();
    expect((await t.call(`/api/characters/${GUID}`, { method: "DELETE" })).status).toBe(200);
    expect(await t.state("player", GUID)).toBeUndefined();
    await t.upload(GUID);
    expect(await t.state("player", GUID)).toBe(2);
    // and the review page lists it as hidden again
    const list = await t.call("/api/review?status=hidden", { as: "admin" });
    expect((list.body.items as unknown[]).length).toBe(1);
  });

  it("follows the character to another account, by its key or by name and realm", async () => {
    const t = await hidden();
    await t.upload(GUID, "other");
    expect(await t.state("other", GUID)).toBe(2);
    await t.upload("Domonip-Doomhowl", "admin");
    expect(await t.state("admin", "Domonip-Doomhowl")).toBe(2);
    // a different character on the same account isn't touched
    await t.upload("Player-5000-FFFFFFFF", "player", "Someone", "Doomhowl");
    expect(await t.state("player", "Player-5000-FFFFFFFF")).toBe(0);
  });

  it("stays when board numbers are saved", async () => {
    const t = await hidden();
    await t.call(`/api/characters/${GUID}/boards`, { method: "PUT", json: { entries: [], checks: [] } });
    expect(await t.state("player", GUID)).toBe(2);
  });

  it("is gone once the reviewer clears it", async () => {
    const t = await hidden();
    const slug = (await t.call(`/api/characters/${GUID}`)).body.slug as string;
    expect((await t.call(`/api/review/${slug}`, { method: "POST", json: { action: "clear" }, as: "admin" })).status).toBe(200);
    expect(await t.state("player", GUID)).toBe(0);
    await t.call(`/api/characters/${GUID}`, { method: "DELETE" });
    await t.upload(GUID);
    expect(await t.state("player", GUID)).toBe(0);
    expect(t.db.prepare("SELECT COUNT(*) AS n FROM moderation").get()).toEqual({ n: 0 });
  });

  it("migration copies today's Hides", async () => {
    const db = new DatabaseSync(":memory:");
    migrate(db, 11);
    db.exec(`INSERT INTO users (id, created_at) VALUES ('u', 0);
      INSERT INTO characters (user_id, key, name, realm, summary, updated_at, board_state) VALUES ('u', 'k', 'Domonip', 'Doomhowl', '{}', 0, 2);
      INSERT INTO flags (user_id, char_key, status, opened_at, updated_at) VALUES ('u', 'k', 'hidden', 1, 5);`);
    for (const f of readdirSync(MIGRATIONS).sort()) if (Number(f.slice(0, 4)) >= 12) db.exec(readFileSync(join(MIGRATIONS, f), "utf8"));
    expect(db.prepare("SELECT user_id, char_key, name, realm, hidden_at FROM moderation").all()).toEqual([
      { user_id: "u", char_key: "k", name: "Domonip", realm: "Doomhowl", hidden_at: 5 },
    ]);
  });
});

describe("journey uploads", () => {
  const put = (t: Awaited<ReturnType<typeof setup>>, body: BodyInit) =>
    t.call(`/api/characters/${GUID}/journey`, { method: "PUT", body, headers: { "x-content-encoding": "gzip", "content-type": "application/octet-stream" } });

  it("stores a real journey", async () => {
    const t = await setup();
    await t.upload(GUID);
    expect((await put(t, journeyGz())).status).toBe(200);
  });

  it("refuses what isn't gzip, isn't a journey, or says it unpacks past 200 MB", async () => {
    const t = await setup();
    await t.upload(GUID);
    expect((await put(t, new TextEncoder().encode('{"format":1}'))).status).toBe(400);
    expect((await put(t, gzipSync('{"hello":"world"}'))).status).toBe(400);
    const big = journeyGz();
    new DataView(big.buffer, big.byteOffset, big.byteLength).setUint32(big.byteLength - 4, 250e6, true);
    expect((await put(t, big)).status).toBe(413);
    expect(t.files.m.size).toBe(0);
  });

  it("checks the account's room as part of the write", async () => {
    const t = await setup();
    await t.upload(GUID);
    t.db.prepare("INSERT INTO characters (user_id, key, name, realm, summary, journey_size, updated_at) VALUES ('player', 'x', 'X', 'Y', '{}', ?, 0)").run(MAX_ACCOUNT_BYTES - 10);
    expect((await put(t, journeyGz())).status).toBe(413);
    expect(t.db.prepare("SELECT journey_size FROM characters WHERE key = ?").get(GUID)).toEqual({ journey_size: null });
  });
});

describe("screenshots", () => {
  const shot = (t: Awaited<ReturnType<typeof setup>>, id: string, body: BodyInit, type = "image/jpeg") =>
    t.call(`/api/characters/${GUID}/screenshots/${id}`, { method: "PUT", body, headers: { "content-type": type, "x-shot": JSON.stringify({ t: 1, kind: "manual" }) } });
  const thumb = (t: Awaited<ReturnType<typeof setup>>, id: string, body: BodyInit) =>
    t.call(`/api/characters/${GUID}/screenshots/${id}/thumb`, { method: "PUT", body, headers: { "content-type": "image/jpeg" } });

  it("must be images, and are stored as what their bytes are", async () => {
    const t = await setup();
    await t.upload(GUID);
    expect((await shot(t, "a".repeat(16), new TextEncoder().encode("<html>not an image</html>"))).status).toBe(415);
    expect((await shot(t, "b".repeat(16), PNG, "image/jpeg")).status).toBe(200);
    expect(t.db.prepare("SELECT content_type FROM screenshots").get()).toEqual({ content_type: "image/png" });
    expect((await thumb(t, "b".repeat(16), new TextEncoder().encode("nope"))).status).toBe(415);
  });

  it("count their thumbnails toward the account's room", async () => {
    const t = await setup();
    await t.upload(GUID);
    expect((await shot(t, "c".repeat(16), JPEG)).status).toBe(200);
    expect((await thumb(t, "c".repeat(16), JPEG)).status).toBe(200);
    expect(t.db.prepare("SELECT size, thumb_size FROM screenshots").get()).toEqual({ size: JPEG.length, thumb_size: JPEG.length });
    t.db.prepare("UPDATE characters SET journey_size = ? WHERE key = ?").run(MAX_ACCOUNT_BYTES - 2 * JPEG.length - 5, GUID);
    expect((await thumb(t, "c".repeat(16), new Uint8Array([...JPEG, 0, 0, 0, 0, 0, 0]))).status).toBe(413);
    expect((await shot(t, "d".repeat(16), JPEG)).status).toBe(413);
    expect(t.db.prepare("SELECT COUNT(*) AS n FROM screenshots").get()).toEqual({ n: 1 });
  });
});

describe("limits", () => {
  it("a new character only while there's room for one", async () => {
    const t = await setup();
    for (let i = 0; i < MAX_CHARACTERS; i++) {
      t.db.prepare("INSERT INTO characters (user_id, key, name, realm, summary, updated_at) VALUES ('player', ?, 'X', 'Y', '{}', 0)").run(`k${i}`);
    }
    expect((await t.upload(GUID)).status).toBe(413);
    expect((await t.upload("k3", "player", "Again", "Doomhowl")).status).toBe(200);
  });

  it("knows image types by their first bytes", () => {
    expect(sniffImage(JPEG.buffer)).toBe("image/jpeg");
    expect(sniffImage(PNG.buffer)).toBe("image/png");
    expect(sniffImage(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 ").buffer)).toBe("image/webp");
    expect(sniffImage(new TextEncoder().encode("GIF89a").buffer)).toBeNull();
  });

  it("viewer pages stop reading a journey past the limit", async () => {
    const big = new Response(new ReadableStream({
      pull(c) {
        c.enqueue(new Uint8Array(1000));
      },
    }));
    await expect(readJsonCapped(big, 10_000)).rejects.toThrow(/too large/);
    expect(await readJsonCapped(new Response('{"a":1}'), 100)).toEqual({ a: 1 });
  });
});
