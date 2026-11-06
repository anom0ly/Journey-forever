import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import { connectPort } from "../src/lib/uploader";
import { returnPath } from "../src/worker/auth";
import type { Env } from "../src/worker/env";
import { sha256 } from "../src/worker/http";
import worker from "../src/worker/index";
import { githubBuilds, keyAllows } from "../src/worker/uploader";

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
  const connect = async (verifier = "a-secret-only-the-pc-knows", session = "admin") => {
    const r = await call("/api/uploader/connect", { method: "POST", session, body: { name: "DESKTOP-JUSTIN", challenge: await sha256(verifier) } });
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
    expect((await call("/api/uploader/settings", { key })).body).toEqual({ shots: true, manualShots: false, notify: true, addon: true, update: true, reports: true });
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
    expect((await call("/api/uploader/settings", { method: "PATCH", session: "admin", body: { shots: false, addon: "yes" } })).body).toEqual({ shots: false, manualShots: false, notify: true, addon: true, update: true, reports: true });
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

  it("keeps each PC's last 10 problems for the health page, admins only", async () => {
    const { env, call, connect } = await setup();
    const { key } = (await call("/api/uploader/claim", { method: "POST", body: { code: await connect(), verifier: "a-secret-only-the-pc-knows" } })).body as { key: string };
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    for (let i = 0; i < 12; i++) {
      const r = await call("/api/errors", { key, method: "POST", body: { kind: "uploader", area: "upload", message: `failure ${i}`, app: "1.2.0", os: "10.0.26100" } });
      expect(r.status).toBe(200);
    }
    await call("/api/errors", { key, method: "POST", body: { kind: "uploader", area: "update", security: true, message: "checksum mismatch" } });
    // Without a PC's key an uploader report is refused, so nobody can fake one (or a "security" one).
    expect((await call("/api/errors", { method: "POST", body: { kind: "uploader", area: "update", security: true, message: "boom" } })).status).toBe(401);
    expect((await call("/api/errors", { method: "POST", session: "admin", body: { kind: "uploader", area: "crash", message: "boom" } })).status).toBe(401);
    // A page's own report needs no sign-in.
    expect((await call("/api/errors", { method: "POST", body: { kind: "crash", message: "boom" } })).status).toBe(200);
    expect(((await env.DB.prepare("SELECT COUNT(*) AS n FROM upload_errors").first()) as { n: number }).n).toBe(10);

    expect((await call("/api/admin/uploader", { session: "player" })).status).toBe(404);
    expect((await call("/api/admin/uploader", { key })).status).toBe(403);
    const h = (await call("/api/admin/uploader", { session: "admin" })).body as { pcs: { id: string; battletag: string; osVersion: string; appVersion: string; weekErrors: number; lastError: { area: string; message: string } }[] };
    expect(h.pcs).toHaveLength(1);
    expect(h.pcs[0]).toMatchObject({ battletag: "admin#1", osVersion: "10.0.26100", appVersion: "1.2.0", weekErrors: 10, lastError: { area: "update-security", message: "checksum mismatch" } });
    const list = (await call(`/api/admin/uploader/${h.pcs[0].id}/errors`, { session: "admin" })).body as { errors: { message: string }[] };
    expect(list.errors).toHaveLength(10);
    expect(list.errors[0].message).toBe("checksum mismatch");
    expect(list.errors[9].message).toBe("failure 3");
    // Disconnecting the PC takes its problems with it.
    await call(`/api/uploader/pcs/${h.pcs[0].id}`, { method: "DELETE", session: "admin" });
    expect(((await env.DB.prepare("SELECT COUNT(*) AS n FROM upload_errors").first()) as { n: number }).n).toBe(0);
  });

  it("updates PCs only to a build an admin approved, with GitHub's checksum at that moment", async () => {
    const { call, connect } = await setup();
    const { key } = (await call("/api/uploader/claim", { method: "POST", body: { code: await connect(), verifier: "a-secret-only-the-pc-knows" } })).body as { key: string };
    const bot = { login: "github-actions[bot]" };
    let digest = "a".repeat(64);
    const release = (v: string, more = {}) => ({
      tag_name: `uploader-v${v}`, draft: false, prerelease: false, published_at: "2026-11-06T10:00:00Z", author: bot,
      assets: [{ name: "JourneyForeverUploader.exe", size: 1000, digest: `sha256:${digest}`, uploader: bot,
        browser_download_url: `https://github.com/anom0ly/Journey-forever/releases/download/uploader-v${v}/JourneyForeverUploader.exe` }],
      ...more,
    });
    const github = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json([release("1.3.0"), release("1.2.0"), release("1.4.0", { author: { login: "someone" } }), { ...release("1.1.0"), tag_name: "addon-v1.1.0" }]),
    );

    expect((await call("/api/uploader/latest", { key })).body).toEqual({ version: null });
    const list = (await call("/api/admin/uploader/releases", { session: "admin" })).body as { builds: { version: string; sha256: string | null }[] };
    expect(list.builds.map((b) => [b.version, !!b.sha256])).toEqual([["1.4.0", false], ["1.3.0", true], ["1.2.0", true]]);

    // Players, keys and other people's builds can't approve.
    expect((await call("/api/admin/uploader/releases/1.3.0", { method: "POST", session: "player" })).status).toBe(404);
    expect((await call("/api/admin/uploader/releases/1.3.0", { method: "POST", key })).status).toBe(403);
    expect((await call("/api/admin/uploader/releases/1.4.0", { method: "POST", session: "admin" })).status).toBe(400);

    expect((await call("/api/admin/uploader/releases/1.3.0", { method: "POST", session: "admin" })).status).toBe(200);
    expect((await call("/api/uploader/latest", { key })).body).toEqual({ version: "1.3.0", sha256: digest, size: 1000 });

    // GitHub's file replaced after approval: shown as changed, and PCs still get the approved checksum.
    digest = "b".repeat(64);
    const after = (await call("/api/admin/uploader/releases", { session: "admin" })).body as { builds: { version: string; changed: boolean }[] };
    expect(after.builds.find((b) => b.version === "1.3.0")!.changed).toBe(true);
    expect(((await call("/api/uploader/latest", { key })).body as { sha256: string }).sha256).toBe("a".repeat(64));

    // Withdrawn: no build is offered.
    expect((await call("/api/admin/uploader/releases/1.3.0", { method: "DELETE", session: "admin" })).status).toBe(200);
    expect((await call("/api/uploader/latest", { key })).body).toEqual({ version: null });
    github.mockRestore();
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

describe("uploader Beta switches", () => {
  const claim = async (call: Awaited<ReturnType<typeof setup>>["call"], code: string) =>
    (await call("/api/uploader/claim", { method: "POST", body: { code, verifier: "a-secret-only-the-pc-knows" } })).body as { key: string };

  it("only admins can flip the switches", async () => {
    const { call } = await setup();
    expect((await call("/api/admin/uploader/switches", { session: "admin" })).body).toEqual({ beta: false, connect: true, minVersion: null });
    expect((await call("/api/admin/uploader/switches", { session: "player" })).status).toBe(404);
    expect((await call("/api/admin/uploader/switches", { method: "PATCH", session: "player", body: { beta: true } })).status).toBe(404);
    expect((await call("/api/admin/uploader/switches", { method: "PATCH", session: "admin", body: { beta: true } })).body).toMatchObject({ beta: true });
  });

  it("opens the uploader to every account in Beta, up to 3 PCs each", async () => {
    const { call, connect } = await setup();
    expect(((await call("/api/me", { session: "player" })).body.user as { uploader: unknown }).uploader).toEqual({ allowed: false, beta: false, pcs: 0 });
    await call("/api/admin/uploader/switches", { method: "PATCH", session: "admin", body: { beta: true } });
    const { key } = await claim(call, await connect(undefined, "player"));
    expect((await call("/api/characters", { key })).status).toBe(200);
    expect(((await call("/api/me", { session: "player" })).body.user as { uploader: unknown }).uploader).toEqual({ allowed: true, beta: true, pcs: 1 });
    await claim(call, await connect(undefined, "player"));
    await claim(call, await connect(undefined, "player"));
    const fourth = await call("/api/uploader/connect", { method: "POST", session: "player", body: { challenge: "0".repeat(64) } });
    expect(fourth.status).toBe(413);
    // Closing the Beta stops the player's PCs too.
    await call("/api/admin/uploader/switches", { method: "PATCH", session: "admin", body: { beta: false } });
    expect((await call("/api/characters", { key })).status).toBe(404);
  });

  it("can stop new PCs connecting while connected ones keep working", async () => {
    const { call, connect } = await setup();
    await call("/api/admin/uploader/switches", { method: "PATCH", session: "admin", body: { beta: true } });
    const { key } = await claim(call, await connect(undefined, "player"));
    const pending = await connect(undefined, "player");
    await call("/api/admin/uploader/switches", { method: "PATCH", session: "admin", body: { connect: false } });
    expect((await call("/api/uploader/connect", { method: "POST", session: "player", body: { challenge: "0".repeat(64) } })).status).toBe(403);
    // A code made just before the switch can't be claimed either.
    expect((await call("/api/uploader/claim", { method: "POST", body: { code: pending, verifier: "a-secret-only-the-pc-knows" } })).status).toBe(403);
    expect((await call("/api/characters", { key })).status).toBe(200);
    // Admins can still connect, to test.
    await connect();
  });

  it("lets an outdated uploader only update itself", async () => {
    const { env, call, connect } = await setup();
    const { key } = await claim(call, await connect());
    await call("/api/uploader/status", { key, method: "POST", body: { ok: true, appVersion: "1.2.0" } });
    // The minimum has to be an approved build.
    expect((await call("/api/admin/uploader/switches", { method: "PATCH", session: "admin", body: { minVersion: "1.3.0" } })).status).toBe(400);
    await env.DB.prepare("INSERT INTO uploader_releases (version, sha256, size, approved_at, approved_by) VALUES ('1.3.0', ?, 1000, 1, 'admin')").bind("a".repeat(64)).run();
    expect((await call("/api/admin/uploader/switches", { method: "PATCH", session: "admin", body: { minVersion: "1.3.0" } })).body).toMatchObject({ minVersion: "1.3.0" });
    expect((await call("/api/characters", { key })).status).toBe(426);
    expect((await call("/api/uploader/latest", { key })).body).toMatchObject({ version: "1.3.0" });
    expect((await call("/api/uploader/status", { key, method: "POST", body: { ok: true, appVersion: "1.3.0" } })).status).toBe(200);
    expect((await call("/api/characters", { key })).status).toBe(200);
    // Withdrawing that build clears the minimum.
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json([]));
    await call("/api/admin/uploader/releases/1.3.0", { method: "DELETE", session: "admin" });
    expect((await call("/api/admin/uploader/switches", { session: "admin" })).body).toMatchObject({ minVersion: null });
    vi.restoreAllMocks();
  });

  it("tells the download page what to offer, without sign-in", async () => {
    const { env, call } = await setup();
    expect((await call("/api/uploader/download")).body).toEqual({ beta: false, connect: true, version: null });
    await env.DB.prepare("INSERT INTO uploader_releases (version, sha256, size, approved_at, approved_by) VALUES ('1.3.0', ?, 116000000, 1, 'admin')").bind("b".repeat(64)).run();
    expect((await call("/api/uploader/download")).body).toEqual({ beta: false, connect: true, version: "1.3.0", sha256: "b".repeat(64), size: 116000000 });
  });
});

describe("GitHub release list", () => {
  it("sends the site's token, and says what to do when GitHub limits the shared address", async () => {
    const seen: (string | null)[] = [];
    const get = (async (_u: string, init: RequestInit) => {
      seen.push(new Headers(init.headers).get("authorization"));
      return Response.json([]);
    }) as unknown as typeof fetch;
    await githubBuilds("tok", get);
    expect(seen).toEqual(["Bearer tok"]);
    const limited = (async () => new Response("rate limited", { status: 403 })) as unknown as typeof fetch;
    await expect(githubBuilds(undefined, limited)).rejects.toThrow(/GITHUB_TOKEN/);
  });
});
