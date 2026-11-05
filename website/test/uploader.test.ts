import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { connectPort } from "../src/lib/uploader";
import { returnPath } from "../src/worker/auth";
import type { Env } from "../src/worker/env";
import { sha256 } from "../src/worker/http";
import worker from "../src/worker/index";
import { keyAllows } from "../src/worker/uploader";

// D1, enough of it for these routes, over Node's SQLite with every migration.
function fakeD1(): D1Database {
  const db = new DatabaseSync(":memory:");
  const dir = join(import.meta.dirname, "..", "migrations");
  for (const f of readdirSync(dir).sort()) db.exec(readFileSync(join(dir, f), "utf8"));
  const stmt = (sql: string, args: unknown[] = []) => {
    const params = args.map((a) => (a === undefined ? null : typeof a === "boolean" ? Number(a) : a)) as (string | number | null)[];
    return {
      bind: (...a: unknown[]) => stmt(sql, a),
      first: async () => (db.prepare(sql).get(...params) as unknown) ?? null,
      all: async () => ({ results: db.prepare(sql).all(...params) }),
      run: async () => {
        db.prepare(sql).run(...params);
        return { success: true };
      },
    };
  };
  return {
    prepare: (sql: string) => stmt(sql),
    batch: async (list: { run: () => Promise<unknown> }[]) => {
      const out = [];
      for (const s of list) out.push(await (s as unknown as { all: () => Promise<unknown> }).all());
      return out;
    },
  } as unknown as D1Database;
}

function fakeR2(): R2Bucket {
  const m = new Map<string, ArrayBuffer>();
  return {
    put: async (k: string, v: ArrayBuffer) => void m.set(k, v),
    get: async (k: string) => (m.has(k) ? { body: m.get(k), httpMetadata: {} } : null),
    head: async (k: string) => (m.has(k) ? { size: m.get(k)!.byteLength } : null),
    delete: async (k: string | string[]) => [k].flat().forEach((x) => m.delete(x)),
    list: async () => ({ objects: [], truncated: false }),
  } as unknown as R2Bucket;
}

const ORIGIN = "https://jf.example";

async function setup() {
  const env = { DB: fakeD1(), FILES: fakeR2(), ADMIN_BNET_IDS: "111" } as unknown as Env;
  for (const [id, bnet] of [["admin", "111"], ["player", "222"]]) {
    await env.DB.prepare("INSERT INTO users (id, bnet_id, battletag, created_at) VALUES (?, ?, ?, 0)").bind(id, bnet, `${id}#1`).run();
    await env.DB.prepare("INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, 0, 9999999999)").bind(await sha256(`tok-${id}`), id).run();
  }
  const call = async (path: string, o: { method?: string; body?: unknown; session?: string; key?: string } = {}) => {
    const headers: Record<string, string> = { "x-journey-forever": "1" };
    if (o.session) headers.cookie = `jf_session=tok-${o.session}`;
    if (o.key) headers.authorization = `Bearer ${o.key}`;
    if (o.body !== undefined) headers["content-type"] = "application/json";
    const res = await worker.fetch(new Request(ORIGIN + path, { method: o.method ?? "GET", headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) }), env);
    return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, unknown> };
  };
  const connect = async (verifier = "a-secret-only-the-pc-knows") => {
    const r = await call("/api/uploader/connect", { method: "POST", session: "admin", body: { name: "DESKTOP-JUSTIN", challenge: await sha256(verifier) } });
    expect(r.status).toBe(200);
    return r.body.code as string;
  };
  return { env, call, connect };
}

describe("auto-uploader keys", () => {
  it("connects a PC only with the secret from its own connect link", async () => {
    const { call, connect } = await setup();
    const code = await connect();
    expect((await call("/api/uploader/claim", { method: "POST", body: { code, verifier: "a guess" } })).status).toBe(400);
    // A code is good for one try.
    expect((await call("/api/uploader/claim", { method: "POST", body: { code, verifier: "a-secret-only-the-pc-knows" } })).status).toBe(400);
    const ok = await call("/api/uploader/claim", { method: "POST", body: { code: await connect(), verifier: "a-secret-only-the-pc-knows" } });
    expect(ok.status).toBe(200);
    expect(ok.body.key).toMatch(/^jfu_/);
    expect(ok.body.battletag).toBe("admin#1");
  });

  it("lets a key upload and nothing else", async () => {
    const { call, connect } = await setup();
    const { key } = (await call("/api/uploader/claim", { method: "POST", body: { code: await connect(), verifier: "a-secret-only-the-pc-knows" } })).body as { key: string };
    expect((await call("/api/characters", { key })).status).toBe(200);
    expect((await call("/api/uploader/settings", { key })).body).toEqual({ shots: true, notify: true, addon: true });
    expect((await call("/api/account", { key })).status).toBe(403);
    expect((await call("/api/account", { key, method: "DELETE", body: { confirm: "admin#1" } })).status).toBe(403);
    expect((await call("/api/characters/Adom-Toretto", { key, method: "PATCH", body: { isPublic: true } })).status).toBe(403);
    expect((await call("/api/uploader/settings", { key, method: "PATCH", body: { shots: false } })).status).toBe(403);
    expect((await call("/api/uploader", { key })).status).toBe(403);

    const s = await call("/api/uploader/status", { key, method: "POST", body: { ok: true, message: "Adom uploaded, 4 screenshots", uploaded: true, appVersion: "1.0.0", addonVersion: "1.1.0" } });
    expect(s.status).toBe(200);
    const page = (await call("/api/uploader", { session: "admin" })).body as { pcs: { id: string; name: string; ok: boolean; message: string; addonVersion: string; lastUploadAt: number }[] };
    expect(page.pcs).toHaveLength(1);
    expect(page.pcs[0]).toMatchObject({ name: "DESKTOP-JUSTIN", ok: true, message: "Adom uploaded, 4 screenshots", addonVersion: "1.1.0" });
    expect(page.pcs[0].lastUploadAt).toBeGreaterThan(0);

    // Disconnect on the Account page: the key stops at once.
    await call(`/api/uploader/pcs/${page.pcs[0].id}`, { method: "DELETE", session: "admin" });
    expect((await call("/api/characters", { key })).status).toBe(401);
  });

  it("keeps the switches the Account page sets", async () => {
    const { call } = await setup();
    expect((await call("/api/uploader/settings", { method: "PATCH", session: "admin", body: { shots: false, addon: "yes" } })).body).toEqual({ shots: false, notify: true, addon: true });
    expect(((await call("/api/uploader", { session: "admin" })).body.settings as Record<string, boolean>).shots).toBe(false);
  });

  it("is admin only", async () => {
    const { env, call, connect } = await setup();
    expect((await call("/api/uploader", { session: "player" })).status).toBe(404);
    expect((await call("/api/uploader/connect", { method: "POST", session: "player", body: { challenge: "0".repeat(64) } })).status).toBe(404);
    const { key } = (await call("/api/uploader/claim", { method: "POST", body: { code: await connect(), verifier: "a-secret-only-the-pc-knows" } })).body as { key: string };
    // No longer an admin: the key stops working too.
    (env as { ADMIN_BNET_IDS: string }).ADMIN_BNET_IDS = "333";
    expect((await call("/api/characters", { key })).status).toBe(404);
  });

  it("removes a PC's key when the uploader is removed, and with the account", async () => {
    const { env, call, connect } = await setup();
    const { key } = (await call("/api/uploader/claim", { method: "POST", body: { code: await connect(), verifier: "a-secret-only-the-pc-knows" } })).body as { key: string };
    expect((await call("/api/uploader/self", { key, method: "DELETE" })).status).toBe(200);
    expect((await call("/api/characters", { key })).status).toBe(401);
    await connect();
    await call("/api/account", { method: "DELETE", session: "admin", body: { confirm: "admin#1" } });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM upload_codes").first()).toEqual({ n: 0 });
  });

  it("stops a key that hasn't been used for 60 days, and keeps a used one alive", async () => {
    const { env, call, connect } = await setup();
    const { key } = (await call("/api/uploader/claim", { method: "POST", body: { code: await connect(), verifier: "a-secret-only-the-pc-knows" } })).body as { key: string };
    const old = Math.floor(Date.now() / 1000) - 59 * 86400;
    await env.DB.prepare("UPDATE upload_keys SET created_at = ?, last_seen_at = NULL").bind(old).run();
    expect((await call("/api/uploader/settings", { key })).status).toBe(200);
    const seen = (await env.DB.prepare("SELECT last_seen_at AS t FROM upload_keys").first()) as { t: number };
    expect(seen.t).toBeGreaterThan(old);
    await env.DB.prepare("UPDATE upload_keys SET last_seen_at = ?").bind(old - 2 * 86400).run();
    expect((await call("/api/uploader/settings", { key })).status).toBe(401);
  });

  it("knows which routes a key may use", () => {
    expect(keyAllows("PUT", "/api/characters/Adom-Toretto/screenshots/0123456789abcdef/thumb")).toBe(true);
    expect(keyAllows("DELETE", "/api/characters/Adom-Toretto/screenshots/0123456789abcdef")).toBe(false);
    expect(keyAllows("DELETE", "/api/characters/Adom-Toretto")).toBe(false);
    expect(keyAllows("GET", "/api/review")).toBe(false);
  });

  it("only returns to the connect page after sign-in, and only takes real ports", () => {
    expect(returnPath("/connect?port=47213&challenge=ab12&pc=DESKTOP-1")).toBe("/connect?port=47213&challenge=ab12&pc=DESKTOP-1");
    expect(returnPath("https://evil.example/connect")).toBeUndefined();
    expect(returnPath("//evil.example")).toBeUndefined();
    expect(returnPath("/account")).toBeUndefined();
    expect(connectPort("47213")).toBe(47213);
    expect(connectPort("80")).toBeUndefined();
    expect(connectPort("47213.5")).toBeUndefined();
  });
});
