import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { hashTag } from "../src/lib/friendTags";
import type { Env } from "../src/worker/env";
import { keyHash, MAX_CHANGES_PER_DAY, UNMATCHED_SECONDS } from "../src/worker/friends";
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
const PEOPLE = ["ann", "bob", "cat", "dan"];
const tag = (id: string) => `${id[0].toUpperCase()}${id.slice(1)}#1`;

async function setup(key: string | undefined = "test-key") {
  const { d1, db } = fakeD1();
  const env = { DB: d1, FRIENDS_KEY: key } as unknown as Env;
  for (const id of PEOPLE) {
    db.prepare("INSERT INTO users (id, bnet_id, battletag, created_at, last_upload_at) VALUES (?, ?, ?, 0, ?)").run(id, id, tag(id), Math.floor(Date.now() / 1000));
    db.prepare("INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, 0, 9999999999)").run(await sha256(`tok-${id}`), id);
    db.prepare("INSERT INTO characters (user_id, key, name, realm, is_public, slug, summary, updated_at) VALUES (?, ?, ?, 'R', 1, ?, ?, 0)").run(
      id, `${id}-R`, id, `${id}-r`, JSON.stringify({ level: 10, className: "Warrior", race: "Human" }),
    );
  }
  const call = async (path: string, session: string, method = "GET", body?: unknown) => {
    const headers: Record<string, string> = { "x-journey-forever": "1", cookie: `jf_session=tok-${session}` };
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await worker.fetch(new Request(ORIGIN + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env);
    return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, any> };
  };
  const list = async (who: string, friends: string[], source = "jf") =>
    call("/api/friends", who, "PUT", { [source]: await Promise.all(friends.map((f) => hashTag(tag(f)))) });
  return { env, db, call, list };
}

const names = (r: { body: Record<string, any> }) => (r.body.friends as { characters: { name: string }[] }[]).map((f) => f.characters[0].name).sort();

describe("friends on the server", () => {
  it("matches only friends who list each other", async () => {
    const { call, list } = await setup();
    await list("ann", ["bob", "cat"]);
    await list("bob", ["ann"]);
    // Dan lists Ann but Ann doesn't list Dan: the old lookup trick.
    await list("dan", ["ann"]);
    expect(names(await call("/api/friends", "ann"))).toEqual(["bob"]);
    expect(names(await call("/api/friends", "bob"))).toEqual(["ann"]);
    expect(names(await call("/api/friends", "dan"))).toEqual([]);
    expect(names(await call("/api/friends", "cat"))).toEqual([]);
  });

  it("stores only keyed hashes, never the plain ones the browser sends", async () => {
    const { db, list, env } = await setup();
    const plain = await hashTag(tag("bob"));
    await list("ann", ["bob"]);
    const stored = db.prepare("SELECT tag_hash FROM friend_keys").all().map((r: any) => r.tag_hash);
    expect(stored).toEqual([await keyHash(env, plain)]);
    expect(stored).not.toContain(plain);
    const own = db.prepare("SELECT tag_key AS tag_hash FROM users WHERE id = 'bob'").get() as { tag_hash: string };
    expect(own.tag_hash).toBe(await keyHash(env, plain));
    expect(await keyHash({ FRIENDS_KEY: "other" } as Env, plain)).not.toBe(own.tag_hash);
  });

  it("keys lists stored before the key, so highlights carry on", async () => {
    const { db, call } = await setup();
    // As the old code leaves them: plain hashes in friend_tags and users.tag_hash.
    for (const [u, f] of [["ann", "bob"], ["bob", "ann"], ["ann", "zed"]]) {
      db.prepare("INSERT INTO friend_tags (user_id, source, tag_hash) VALUES (?, 'jf', ?)").run(u, await hashTag(tag(f)));
    }
    db.prepare("UPDATE users SET tag_hash = 'plain'").run();
    expect(names(await call("/api/friends", "ann"))).toEqual(["bob"]);
    expect((db.prepare("SELECT COUNT(*) AS n FROM friend_tags").get() as { n: number }).n).toBe(0);
    expect((db.prepare("SELECT COUNT(*) AS n FROM users WHERE tag_hash IS NOT NULL").get() as { n: number }).n).toBe(0);
    expect((db.prepare("SELECT COUNT(*) AS n FROM friend_keys").get() as { n: number }).n).toBe(3);
  });

  it("drops hashes matching nobody 60 days after the owner's last upload", async () => {
    const { db, list } = await setup();
    await list("ann", ["bob", "zed"]);
    await list("cat", ["zed"]);
    const old = Math.floor(Date.now() / 1000) - UNMATCHED_SECONDS - 60;
    db.prepare("UPDATE users SET last_upload_at = ?, friends_at = ? WHERE id = 'ann'").run(old, old);
    // Any later save runs the clean-up.
    await list("dan", ["ann"]);
    const left = db.prepare("SELECT user_id, tag_hash FROM friend_keys ORDER BY user_id").all() as { user_id: string }[];
    // Ann keeps Bob (a user) and loses Zed; Cat uploaded recently and keeps Zed.
    expect(left.map((r) => r.user_id)).toEqual(["ann", "cat", "dan"]);
  });

  it("limits list changes per day, but an unchanged list is free", async () => {
    const { list } = await setup();
    for (let i = 0; i < 20; i++) expect((await list("ann", ["bob"])).body.notSaved).toBeUndefined();
    const others = ["cat", "dan"];
    let r;
    for (let i = 1; i < MAX_CHANGES_PER_DAY; i++) r = await list("ann", [others[i % 2]]);
    expect(r!.body.notSaved).toBeUndefined();
    r = await list("ann", ["bob", "cat", "dan"]);
    expect(r.status).toBe(200);
    expect(r.body.notSaved).toBe("limited");
    expect(r.body.counts.total).toBe(1);
  });

  it("stores and matches nothing without the key", async () => {
    const { db, list, call } = await setup("");
    const first = await list("ann", ["bob"]);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.notSaved).toBe("off");
    await list("bob", ["ann"]);
    expect((db.prepare("SELECT COUNT(*) AS n FROM friend_keys").get() as { n: number }).n).toBe(0);
    expect(names(await call("/api/friends", "ann"))).toEqual([]);
  });
});
