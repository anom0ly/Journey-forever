import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanReport } from "../src/lib/errorReport";
import { readUpload } from "../src/lib/parse/upload";
import { addToShape, emptyShape, pickProblem } from "../src/lib/pick";
import { browserOf, groupKey, interferenceOf, noticeTitle } from "../src/lib/problems";
import type { Env } from "../src/worker/env";
import { sha256 } from "../src/worker/http";
import worker from "../src/worker/index";

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
    batch: async (list: { all: () => Promise<unknown> }[]) => {
      const out = [];
      for (const s of list) out.push(await s.all());
      return out;
    },
  } as unknown as D1Database;
}

const ORIGIN = "https://jf.example";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";

async function setup() {
  const env = { DB: fakeD1(), ADMIN_BNET_IDS: "111", BNET_CLIENT_ID: "id", BNET_CLIENT_SECRET: "s" } as unknown as Env;
  for (const [id, bnet] of [["admin", "111"], ["billy", "222"], ["other", "333"]]) {
    await env.DB.prepare("INSERT INTO users (id, bnet_id, battletag, created_at) VALUES (?, ?, ?, 0)").bind(id, bnet, `${id}#1`).run();
    await env.DB.prepare("INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, 0, 9999999999)").bind(await sha256(`tok-${id}`), id).run();
  }
  const call = async (path: string, o: { method?: string; body?: unknown; session?: string; headers?: Record<string, string> } = {}) => {
    const headers: Record<string, string> = { "x-journey-forever": "1", "user-agent": UA, ...o.headers };
    if (o.session) headers.cookie = `jf_session=tok-${o.session}`;
    if (o.body !== undefined) headers["content-type"] = "application/json";
    const res = await worker.fetch(new Request(ORIGIN + path, { method: o.method ?? "GET", headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) }), env);
    return { status: res.status, location: res.headers.get("location"), body: (await res.json().catch(() => null)) as Record<string, unknown> };
  };
  return { env, call };
}

const saveFail = (extra: Record<string, unknown> = {}) => ({
  kind: "upload", step: "save", message: "TypeError: Failed to fetch", network: true, blocked: ["inline", "local.adguard.org"], char: "Donq", size: 1400000, ...extra,
});

describe("problem reports", () => {
  afterEach(() => vi.restoreAllMocks());

  it("keeps the new fields, checked", () => {
    expect(cleanReport(saveFail())).toEqual({
      kind: "upload", step: "save", message: "TypeError: Failed to fetch", network: true, blocked: ["inline", "local.adguard.org"], char: "Donq", size: 1400000,
    });
    expect(cleanReport({ kind: "upload", message: "x", blocked: ["<script>", "Not A Host", 3], char: "<b>x</b>" })).toEqual({ kind: "upload", message: "x" });
    expect(cleanReport({ kind: "addon", message: "Shots.lua:131: boom", at: 1794800000, times: 3, addon: "1.3.0" })).toEqual({
      kind: "addon", message: "Shots.lua:131: boom", at: 1794800000, times: 3, addon: "1.3.0",
    });
  });

  it("groups the same problem whatever its numbers", () => {
    expect(groupKey("upload", "save", "HTTP 413 at 1234 bytes")).toBe(groupKey("upload", "save", "HTTP 500 at 99 bytes"));
    expect(groupKey("upload", "save", "a")).not.toBe(groupKey("upload", "read", "a"));
  });

  it("names browsers and ad blockers", () => {
    expect(browserOf(UA)).toBe("Chrome 142 · Windows");
    expect(browserOf("Mozilla/5.0 (Windows NT 10.0; rv:145.0) Gecko/20100101 Firefox/145.0")).toBe("Firefox 145 · Windows");
    expect(interferenceOf(["inline", "static.cloudflareinsights.com"])).toBeUndefined();
    expect(interferenceOf(["inline", "local.adguard.org"])).toEqual({ name: "AdGuard", host: "local.adguard.org" });
    expect(interferenceOf(["cdn.someextension.io"])).toEqual({ host: "cdn.someextension.io" });
    expect(noticeTitle("upload", Date.UTC(2026, 10, 16) / 1000)).toBe("Fixed: the upload problem you hit on Nov 16");
  });

  it("says which folder was wrong", () => {
    const shape = (...paths: string[]) => {
      const s = emptyShape();
      for (const p of paths) addToShape(s, p, /\.jpg$/.test(p));
      return s;
    };
    expect(pickProblem(shape("_forever_/Interface/AddOns/JourneyForever/Core.lua", "_forever_/Interface/AddOns/RoadToSixty/RoadToSixty.lua"))).toBe("addons-folder");
    expect(pickProblem(shape("RoadToSixty.lua.bak"))).toBe("backups");
    expect(pickProblem(shape("Account/X/Realm/Char/SavedVariables/Details.lua"))).toBe("no-addon-files");
    expect(pickProblem(shape("WTF/Config.wtf"))).toBe("wtf-root");
    expect(pickProblem(shape("Screenshots/WoWScrnShot_111626_090501.jpg"))).toBe("images-only");
  });

  it("reads the errors our addon kept", () => {
    const text = `JourneyForeverDB = { ["schemaVersion"] = 1, ["addon"] = "1.3.0", ["char"] = { ["name"] = "Donq", ["realm"] = "R" },
      ["errors"] = { { ["t"] = 1794800000, ["msg"] = "PLAYER_LEVEL_UP: Shots.lua:131: boom", ["n"] = 3, ["v"] = "1.3.0" }, { ["msg"] = "no time" } } }`;
    const r = readUpload([{ path: "WTF/Account/A/R/Donq/SavedVariables/JourneyForever.lua", text }]);
    expect(r.addonErrors).toEqual([{ t: 1794800000, message: "PLAYER_LEVEL_UP: Shots.lua:131: boom", count: 3, version: "1.3.0", character: "Donq" }]);
  });

  it("stores reports, groups them and lists them for admins only", async () => {
    const { call } = await setup();
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await call("/api/errors", { method: "POST", session: "billy", body: saveFail() })).status).toBe(200);
    expect((await call("/api/errors", { method: "POST", session: "billy", body: saveFail() })).status).toBe(200);
    expect((await call("/api/errors", { method: "POST", session: "other", body: saveFail({ blocked: [] }) })).status).toBe(200);
    expect(log).toHaveBeenCalledTimes(3);

    expect((await call("/api/admin/problems", { session: "billy" })).status).toBe(404);
    const list = await call("/api/admin/problems", { session: "admin" });
    const groups = list.body.groups as { id: string; count: number; players: number; kind: string; cases: { battletag: string; detail: Record<string, unknown> }[] }[];
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ kind: "upload", count: 3, players: 2 });
    expect(groups[0].cases[2]).toMatchObject({ battletag: "billy#1", detail: { char: "Donq", browser: "Chrome 142 · Windows", blocked: ["inline", "local.adguard.org"] } });
    expect((await call("/api/me", { session: "admin" })).body.problemCount).toBe(1);
  });

  it("tells players when it's fixed, and reopens if it happens again", async () => {
    const { call } = await setup();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await call("/api/errors", { method: "POST", session: "billy", body: saveFail() });
    const id = ((await call("/api/admin/problems", { session: "admin" })).body.groups as { id: string }[])[0].id;
    const fixed = await call(`/api/admin/problems/${id}`, { method: "POST", session: "admin", body: { action: "fix", note: "Uploads work with AdGuard now." } });
    expect(fixed.body).toEqual({ ok: true, notified: 1 });

    const me = await call("/api/me", { session: "billy" });
    expect(me.body.notices).toEqual([{ id, kind: "upload", note: "Uploads work with AdGuard now.", hitAt: expect.any(Number) }]);
    expect((await call("/api/me", { session: "other" })).body.notices).toEqual([]);
    expect((await call(`/api/notices/${id}`, { method: "DELETE", session: "billy" })).status).toBe(200);
    expect((await call("/api/me", { session: "billy" })).body.notices).toEqual([]);

    expect(((await call("/api/admin/problems?status=open", { session: "admin" })).body.groups as unknown[]).length).toBe(0);
    vi.useFakeTimers({ now: Date.now() + 5000, toFake: ["Date"] });
    await call("/api/errors", { method: "POST", session: "other", body: saveFail() });
    vi.useRealTimers();
    expect(((await call("/api/admin/problems?status=open", { session: "admin" })).body.groups as unknown[]).length).toBe(1);
  });

  it("only logs, not alerts, a problem marked as noise", async () => {
    const { call } = await setup();
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const info = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await call("/api/errors", { method: "POST", session: "billy", body: { kind: "crash", message: "ResizeObserver loop completed" } });
    const id = ((await call("/api/admin/problems", { session: "admin" })).body.groups as { id: string }[])[0].id;
    await call(`/api/admin/problems/${id}`, { method: "POST", session: "admin", body: { action: "hide" } });
    await call("/api/errors", { method: "POST", session: "billy", body: { kind: "crash", message: "ResizeObserver loop completed" } });
    expect(err).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledTimes(1);
  });

  it("keeps an addon error once however often it's uploaded", async () => {
    const { call } = await setup();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const at = Math.floor(Date.now() / 1000) - 3600;
    const body = { kind: "addon", message: "Shots.lua:131: boom", at, times: 2, addon: "1.3.0" };
    await call("/api/errors", { method: "POST", session: "billy", body });
    await call("/api/errors", { method: "POST", session: "billy", body });
    const groups = (await call("/api/admin/problems", { session: "admin" })).body.groups as { kind: string; count: number }[];
    expect(groups).toEqual([expect.objectContaining({ kind: "addon", count: 1 })]);
  });

  it("records why a Battle.net sign-in failed", async () => {
    const { call } = await setup();
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    // Nothing from Battle.net: a bot or a bookmark, not recorded.
    expect((await call("/auth/callback")).location).toBe(`${ORIGIN}/?signin=failed`);
    // No state cookie: took too long, or cookies blocked.
    expect((await call("/auth/callback?code=c&state=s")).location).toBe(`${ORIGIN}/?signin=failed&why=expired`);
    // Battle.net refusing the code (the wrong callback address).
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ error: "invalid_grant", error_description: "Invalid grant type or callback URL" }), { status: 400 }));
    const r = await call("/auth/callback?code=c&state=s", { headers: { cookie: "jf_oauth_state=s" } });
    expect(r.location).toBe(`${ORIGIN}/?signin=failed&why=token`);
    expect(err).toHaveBeenCalledTimes(1);

    const groups = (await call("/api/admin/problems", { session: "admin" })).body.groups as { kind: string; title: string; cases: { detail: Record<string, unknown> }[] }[];
    const token = groups.find((g) => g.title.startsWith("Battle.net refused"))!;
    expect(token.title).toBe("Battle.net refused the code (400 invalid_grant), via jf.example");
    expect(token.cases[0].detail).toMatchObject({ why: "token", status: 400, bnet: "invalid_grant", callback: `${ORIGIN}/auth/callback`, browser: "Chrome 142 · Windows" });
    expect(groups.some((g) => g.kind === "signin" && g.title.startsWith("Sign-in cookie missing"))).toBe(true);
  });
});
