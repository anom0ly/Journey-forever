import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/worker/env";
import { FASTEST_60, serverChecks } from "../src/worker/boards";
import { sha256 } from "../src/worker/http";
import worker from "../src/worker/index";

function fakeD1(): { d1: D1Database; db: DatabaseSync } {
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
  const d1 = {
    prepare: (sql: string) => stmt(sql),
    batch: async (list: { all: () => Promise<unknown> }[]) => {
      const out = [];
      for (const s of list) out.push(await s.all());
      return out;
    },
  } as unknown as D1Database;
  return { d1, db };
}

const ORIGIN = "https://jf.example";
const PEOPLE = ["ann", "bob", "cat", "dan", "eve", "boss"];
const HOUR = 3600;
const DAY = 86400;

async function setup() {
  const { d1, db } = fakeD1();
  const files = { head: async () => null, delete: async () => undefined, list: async () => ({ objects: [], truncated: false }) };
  const env = { DB: d1, FILES: files, ADMIN_BNET_IDS: "boss" } as unknown as Env;
  const t = Math.floor(Date.now() / 1000);
  for (const id of PEOPLE) {
    db.prepare("INSERT INTO users (id, bnet_id, battletag, created_at, last_upload_at) VALUES (?, ?, ?, 0, ?)").run(id, id, `${id}#1`, t);
    db.prepare("INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, 0, 9999999999)").run(await sha256(`tok-${id}`), id);
    db.prepare("INSERT INTO characters (user_id, key, name, realm, is_public, slug, summary, updated_at, first_upload_at) VALUES (?, ?, ?, 'R', 1, ?, ?, 0, 0)").run(
      id, `${id}-R`, id, id, JSON.stringify({ level: 60, className: "WARRIOR", race: "Human", played: 30 * DAY }),
    );
  }
  const call = async (path: string, session: string | null, method = "GET", body?: unknown) => {
    const headers: Record<string, string> = { "x-journey-forever": "1" };
    if (session) headers.cookie = `jf_session=tok-${session}`;
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await worker.fetch(new Request(ORIGIN + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env);
    return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, any> };
  };
  // A character's time to 60 (and nothing else).
  const to60 = (who: string, v: number, checks: string[] = []) => call(`/api/characters/${who}-R/boards`, who, "PUT", { entries: [{ b: "to60", v }], checks, version: 6 });
  const board = async (who: string | null) => (await call("/api/boards/to60", who)).body;
  const names = async (who: string | null = null) => (await board(who)).rows.map((r: { name: string }) => r.name);
  const places = async () => (await call("/api/review/places", "boss")).body.items as { slug: string; places: { value: number; rank: number }[] }[];
  const decide = (slug: string, action: string) => call(`/api/review/places/${slug}`, "boss", "POST", { action });
  return { db, call, to60, board, names, places, decide };
}

describe("held top places", () => {
  it("holds a new top-3 time until it's approved, and shows it only to its owner", async () => {
    const { to60, board, names, places, decide, call } = await setup();
    expect((await to60("ann", 6 * DAY)).body.held).toBe(1);
    expect(await names()).toEqual([]);
    const pub = await board(null);
    expect(pub.waiting).toBe(1);
    expect(pub.mineWaiting).toEqual([]);
    const own = await board("ann");
    expect(own.mineWaiting.map((r: { name: string; rank: number }) => [r.name, r.rank])).toEqual([["ann", 1]]);
    // Not in public ranks; first among the owner's chips.
    expect((await call("/api/public/ann/ranks", null)).body.ranks).toEqual([]);
    expect((await call("/api/characters/ann-R/ranks", "ann")).body.ranks[0]).toMatchObject({ board: "to60", rank: 1, waiting: true });

    expect((await places()).map((i) => i.slug)).toEqual(["ann"]);
    expect((await call("/api/me", "boss")).body.reviewCount).toBe(1);
    await decide("ann", "approve");
    expect(await names()).toEqual(["ann"]);
    expect((await board(null)).waiting).toBe(0);
    expect(await places()).toEqual([]);
  });

  it("an approval covers that time or slower; a faster one waits while the approved one stays listed", async () => {
    const { to60, names, board, decide } = await setup();
    await to60("ann", 6 * DAY);
    await decide("ann", "approve");
    expect((await to60("ann", 7 * DAY)).body.held).toBe(0);
    expect((await board(null)).rows[0].value).toBe(7 * DAY);
    expect((await to60("ann", 5 * DAY)).body.held).toBe(1);
    const b = await board(null);
    expect(b.rows.map((r: { value: number }) => r.value)).toEqual([6 * DAY]);
    expect(b.waiting).toBe(1);
    await decide("ann", "approve");
    expect((await board(null)).rows[0].value).toBe(5 * DAY);
    expect(await names()).toEqual(["ann"]);
  });

  it("only holds the top 3, and lists a waiting time once 3 listed times are faster", async () => {
    const { to60, names, decide, board } = await setup();
    for (const [who, d] of [["ann", 5], ["bob", 6], ["cat", 7]] as const) {
      await to60(who, d * DAY);
      await decide(who, "approve");
    }
    // Fourth place goes straight on.
    expect((await to60("dan", 8 * DAY)).body.held).toBe(0);
    // Eve would be third: she waits.
    expect((await to60("eve", 6.5 * DAY)).body.held).toBe(1);
    expect(await names()).toEqual(["ann", "bob", "cat", "dan"]);
    // Dan gets faster than Eve (and is held himself, as 3rd)...
    expect((await to60("dan", 6.2 * DAY)).body.held).toBe(1);
    await decide("dan", "approve");
    // ...which pushes Eve to 4th: listed with no review.
    expect(await names()).toEqual(["ann", "bob", "dan", "eve", "cat"]);
    expect((await board(null)).waiting).toBe(0);
  });

  it("turning a time down keeps it off quietly until a faster one comes", async () => {
    const { to60, names, places, decide, board } = await setup();
    await to60("ann", 6 * DAY);
    await decide("ann", "decline");
    expect(await places()).toEqual([]);
    expect(await names()).toEqual([]);
    expect((await board(null)).waiting).toBe(0);
    // Still waiting, for its owner.
    expect((await board("ann")).mineWaiting).toHaveLength(1);
    // Same time again: still quiet. Faster: back on the review page.
    expect((await to60("ann", 6 * DAY)).body.held).toBe(0);
    expect(await places()).toEqual([]);
    expect((await to60("ann", 5.5 * DAY)).body.held).toBe(1);
    expect((await places())[0].places[0].value).toBe(5.5 * DAY);
  });

  it("keeps waiting times when the character is saved again, and drops them with the character", async () => {
    const { db, to60, call } = await setup();
    await to60("ann", 6 * DAY);
    const first = db.prepare("SELECT created_at FROM board_held").get() as { created_at: number };
    await to60("ann", 6 * DAY);
    expect(db.prepare("SELECT created_at FROM board_held").get()).toEqual(first);
    expect((await call("/api/characters/ann-R", "ann", "DELETE")).status).toBe(200);
    expect(db.prepare("SELECT COUNT(*) AS n FROM board_held").get()).toEqual({ n: 0 });
  });

  it("only an admin can see or decide", async () => {
    const { call, to60 } = await setup();
    await to60("ann", 6 * DAY);
    expect((await call("/api/review/places", "bob")).status).toBe(404);
    expect((await call("/api/review/places/ann", "bob", "POST", { action: "approve" })).status).toBe(404);
  });

  it("server check lines are stored even when the browser sends none", async () => {
    const { db, to60 } = await setup();
    await to60("ann", 2 * DAY, []);
    const checks = JSON.parse((db.prepare("SELECT checks FROM characters WHERE user_id = 'ann'").get() as { checks: string }).checks);
    expect(checks[0]).toMatch(/faster than any known speedrun/);
  });
});

describe("server checks", () => {
  it("flags impossible to-60 and level times", () => {
    expect(serverChecks([{ b: "to60", v: FASTEST_60 + 1 }], { played: 10 * DAY })).toEqual([]);
    expect(serverChecks([{ b: "to60", v: FASTEST_60 - HOUR }], { played: 10 * DAY })[0]).toMatch(/speedrun/);
    expect(serverChecks([{ b: "levelfast", p: "30", v: 20 * 60 }], {})).toEqual(["Level 30 took 20 minutes of played time."]);
    expect(serverChecks([{ b: "levelfast", p: "5", v: 60 }], {})).toEqual([]);
  });

  it("flags times longer than the character has played", () => {
    expect(serverChecks([{ b: "tolevel", p: "30", v: 50 * HOUR }], { played: 40 * HOUR })[0]).toMatch(/Level 30 was reached in 50 hours/);
    const levels = Array.from({ length: 20 }, (_, i) => ({ b: "levelfast", p: String(i + 10), v: 3 * HOUR }));
    expect(serverChecks(levels, { played: 40 * HOUR }).at(-1)).toMatch(/add up to 60 hours/);
    expect(serverChecks(levels, { played: 70 * HOUR })).toEqual([]);
    expect(serverChecks(levels, {})).toEqual([]);
  });
});

describe("established reporters", () => {
  it("count by what the server saw, not by played time", async () => {
    const { db, call } = await setup();
    const t = Math.floor(Date.now() / 1000);
    // Bob: an old account whose character the site first saw yesterday, claiming lots of played time.
    db.prepare("UPDATE users SET created_at = ? WHERE id IN ('bob', 'cat')").run(t - 30 * DAY);
    db.prepare("UPDATE characters SET first_upload_at = ? WHERE user_id = 'bob'").run(t - DAY);
    db.prepare("UPDATE characters SET first_upload_at = ? WHERE user_id = 'cat'").run(t - 5 * DAY);
    await call("/api/public/ann/report", "bob", "POST", { reason: "impossible" });
    await call("/api/public/ann/report", "cat", "POST", { reason: "impossible" });
    const items = (await call("/api/review?status=open", "boss")).body.items as { reports: { battletag: string; established: boolean }[] }[];
    const est = Object.fromEntries(items[0].reports.map((r) => [r.battletag, r.established]));
    expect(est).toEqual({ "bob#1": false, "cat#1": true });
  });
});

describe("review badge", () => {
  it("matches the Waiting list when an item's only check line has gone away", async () => {
    const { to60, decide, call } = await setup();
    await to60("ann", 6 * DAY);
    await decide("ann", "approve");
    await to60("ann", 7 * DAY, ["Level 46 took 17 minutes of played time."]);
    expect((await call("/api/review?status=open", "boss")).body.items.length).toBe(1);
    expect((await call("/api/me", "boss")).body.reviewCount).toBe(1);
    // A new upload drops the line: the item stays open in the table but
    // has nothing new, so the Waiting list skips it and so must the badge.
    await to60("ann", 7 * DAY, []);
    expect((await call("/api/review?status=open", "boss")).body.items.length).toBe(0);
    expect((await call("/api/me", "boss")).body.reviewCount).toBe(0);
  });
});
