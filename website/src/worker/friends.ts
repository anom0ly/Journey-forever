// Battle.net friends: the hashed BattleTag lists from uploads, and who of the
// site's users they match. Friends must be mutual: you count as someone's
// friend only when each of you has the other on a list, so typing in a tag
// shows nothing unless that player listed you too. A friend who turned off
// "Show me to my Battle.net friends" is left out, and only public characters
// are ever shown as a friend's.
//
// The browser sends plain SHA-256 hashes (lib/friendTags.ts), which anyone
// could work out from a tag. Before storing, the Worker keys each one again
// with HMAC-SHA256 and the FRIENDS_KEY secret, users' own hashes too, so a
// copy of the database says nothing about whose tags are in it. Hashes that
// match nobody on the site are dropped 60 days after their owner's last upload.

import { HASH, hashTag, MAX_FRIENDS, type FriendSource } from "../lib/friendTags";
import type { CharacterSummary } from "../lib/journey";
import type { Env, User } from "./env";
import { HttpError, json, now } from "./http";

const SOURCES: FriendSource[] = ["jf", "rts"];
// Friends-list changes an account can make in a UTC day; an unchanged list
// sent again doesn't count.
export const MAX_CHANGES_PER_DAY = 10;
// Unmatched hashes are dropped this long after the owner's last upload.
export const UNMATCHED_SECONDS = 60 * 86400;
const BATCH = 500;

const keys = new Map<string, Promise<CryptoKey>>();

function hmacKey(secret: string): Promise<CryptoKey> {
  let k = keys.get(secret);
  if (!k) {
    k = crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    keys.set(secret, k);
  }
  return k;
}

// The stored form of a hash the browser sent. Undefined without the secret.
export async function keyHash(env: Env, hash: string): Promise<string | undefined> {
  if (!env.FRIENDS_KEY) return undefined;
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(env.FRIENDS_KEY), new TextEncoder().encode(hash));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// users.tag_hash for a BattleTag, keyed the same way as friends' lists.
export async function ownTagHash(env: Env, battletag: string | null): Promise<string | null> {
  return battletag ? ((await keyHash(env, await hashTag(battletag))) ?? null) : null;
}

let warned = false;
function hasKey(env: Env): boolean {
  if (env.FRIENDS_KEY) return true;
  if (!warned) console.warn("FRIENDS_KEY is not set: friends lists are not stored or matched");
  warned = true;
  return false;
}

// Users from before friends (or before the key) get their hash on first need.
// True once every user with a BattleTag has one.
async function fillTagHashes(env: Env): Promise<boolean> {
  const { results } = await env.DB.prepare(`SELECT id, battletag FROM users WHERE tag_hash IS NULL AND battletag IS NOT NULL LIMIT ${BATCH}`).all<{
    id: string;
    battletag: string;
  }>();
  if (!results.length) return true;
  const update = env.DB.prepare("UPDATE users SET tag_hash = ? WHERE id = ?");
  await env.DB.batch(await Promise.all(results.map(async (r) => update.bind(await ownTagHash(env, r.battletag), r.id))));
  return results.length < BATCH;
}

// Lists stored before the key (migration 0012) are keyed a batch at a time.
// True once none are left.
async function convertOld(env: Env): Promise<boolean> {
  const { results } = await env.DB.prepare(`SELECT rowid AS rid, user_id, source, tag_hash FROM friend_tags_old LIMIT ${BATCH}`).all<{
    rid: number;
    user_id: string;
    source: string;
    tag_hash: string;
  }>();
  if (!results.length) return true;
  const insert = env.DB.prepare("INSERT OR IGNORE INTO friend_tags (user_id, source, tag_hash) VALUES (?, ?, ?)");
  const stmts = await Promise.all(results.map(async (r) => insert.bind(r.user_id, r.source, (await keyHash(env, r.tag_hash))!)));
  stmts.push(env.DB.prepare("DELETE FROM friend_tags_old WHERE rowid IN (SELECT value FROM json_each(?))").bind(JSON.stringify(results.map((r) => r.rid))));
  await env.DB.batch(stmts);
  return results.length < BATCH;
}

// Drops hashes that match no user, from lists whose owner last uploaded
// more than 60 days ago. Only once every hash is keyed, so a user whose own
// hash isn't filled in yet can't be taken for a stranger.
async function pruneUnmatched(env: Env): Promise<void> {
  await env.DB.prepare(
    `DELETE FROM friend_tags WHERE user_id IN (
       SELECT id FROM users WHERE MAX(COALESCE(last_upload_at, 0), COALESCE(friends_at, 0)) < ?)
     AND tag_hash NOT IN (SELECT tag_hash FROM users WHERE tag_hash IS NOT NULL)`,
  )
    .bind(now() - UNMATCHED_SECONDS)
    .run();
}

async function upkeep(env: Env): Promise<boolean> {
  if (!hasKey(env)) return false;
  const filled = await fillTagHashes(env);
  const converted = await convertOld(env);
  return filled && converted;
}

// The user ids of the viewer's friends on the site (not the viewer): both
// lists must hold the other.
export async function friendIds(env: Env, viewer: User | null): Promise<string[]> {
  if (!viewer?.battletag) return [];
  await upkeep(env);
  const own = await ownTagHash(env, viewer.battletag);
  if (!own) return [];
  const { results } = await env.DB.prepare(
    `SELECT u.id FROM users u WHERE u.id != ?1 AND u.friends_hidden = 0
       AND u.tag_hash IN (SELECT tag_hash FROM friend_tags WHERE user_id = ?1)
       AND EXISTS (SELECT 1 FROM friend_tags t WHERE t.user_id = u.id AND t.tag_hash = ?2)`,
  )
    .bind(viewer.id, own)
    .all<{ id: string }>();
  return results.map((r) => r.id);
}

// PUT /api/friends { jf?: hashes, rts?: hashes }: each list sent replaces
// the stored one; a list left out is kept. Past the day's change limit, or
// without the key, nothing is stored and the answer says so.
export async function saveFriends(env: Env, user: User, body: unknown): Promise<Response> {
  const b = (body ?? {}) as Partial<Record<FriendSource, unknown>>;
  const lists = new Map<FriendSource, string[]>();
  for (const source of SOURCES) {
    const list = b[source];
    if (list === undefined) continue;
    if (!Array.isArray(list) || list.length > MAX_FRIENDS || !list.every((h) => typeof h === "string" && HASH.test(h))) {
      throw new HttpError(400, "Send lists of hashes");
    }
    lists.set(source, [...new Set(list as string[])]);
  }
  if (!lists.size) throw new HttpError(400, "Send a friends list");
  const upToDate = await upkeep(env);
  if (!env.FRIENDS_KEY) return friendsOf(env, user, "off");
  if (upToDate) await pruneUnmatched(env);

  const t = now();
  const stmts = [];
  const insert = env.DB.prepare("INSERT OR IGNORE INTO friend_tags (user_id, source, tag_hash) VALUES (?, ?, ?)");
  let changed = false;
  for (const [source, list] of lists) {
    const keyed = new Set(await Promise.all(list.map(async (h) => (await keyHash(env, h))!)));
    const { results } = await env.DB.prepare("SELECT tag_hash FROM friend_tags WHERE user_id = ? AND source = ?").bind(user.id, source).all<{ tag_hash: string }>();
    const { results: old } = await env.DB.prepare("SELECT 1 FROM friend_tags_old WHERE user_id = ? AND source = ? LIMIT 1").bind(user.id, source).all();
    const same = !old.length && results.length === keyed.size && results.every((r) => keyed.has(r.tag_hash));
    if (same) continue;
    changed = true;
    stmts.push(env.DB.prepare("DELETE FROM friend_tags WHERE user_id = ? AND source = ?").bind(user.id, source));
    stmts.push(env.DB.prepare("DELETE FROM friend_tags_old WHERE user_id = ? AND source = ?").bind(user.id, source));
    for (const h of keyed) stmts.push(insert.bind(user.id, source, h));
  }
  if (changed) {
    const day = Math.floor(t / 86400);
    const r = await env.DB.prepare("SELECT friends_day, friends_changes FROM users WHERE id = ?").bind(user.id).first<{
      friends_day: number | null;
      friends_changes: number;
    }>();
    const used = r?.friends_day === day ? r.friends_changes : 0;
    if (used >= MAX_CHANGES_PER_DAY) return friendsOf(env, user, "limited");
    stmts.push(env.DB.prepare("UPDATE users SET friends_day = ?, friends_changes = ? WHERE id = ?").bind(day, used + 1, user.id));
  }
  stmts.push(env.DB.prepare("UPDATE users SET friends_at = ? WHERE id = ?").bind(t, user.id));
  for (let i = 0; i < stmts.length; i += 500) await env.DB.batch(stmts.slice(i, i + 500));
  return friendsOf(env, user);
}

interface FriendCharRow {
  user_id: string;
  name: string;
  realm: string;
  slug: string;
  summary: string;
}

// GET /api/friends: friends' public characters, grouped by friend, and the
// account's settings.
// notSaved: why an upload's list wasn't stored ("limited": too many changes
// today; "off": the site has no FRIENDS_KEY).
export async function friendsOf(env: Env, user: User, notSaved?: "limited" | "off"): Promise<Response> {
  const ids = await friendIds(env, user);
  const [settings, counts, mine, chars] = await env.DB.batch([
    env.DB.prepare("SELECT friends_hidden, friends_at FROM users WHERE id = ?").bind(user.id),
    env.DB.prepare("SELECT source, COUNT(*) AS n FROM friend_tags WHERE user_id = ? GROUP BY source").bind(user.id),
    env.DB.prepare(
      `SELECT u.id, GROUP_CONCAT(DISTINCT t.source) AS sources FROM users u JOIN friend_tags t ON t.user_id = ? AND t.tag_hash = u.tag_hash
       WHERE u.id IN (SELECT value FROM json_each(?)) GROUP BY u.id`,
    ).bind(user.id, JSON.stringify(ids)),
    env.DB.prepare(
      `SELECT user_id, name, realm, slug, summary FROM characters WHERE is_public = 1 AND slug IS NOT NULL
       AND user_id IN (SELECT value FROM json_each(?)) ORDER BY updated_at DESC`,
    ).bind(JSON.stringify(ids)),
  ]);
  const s = settings.results[0] as { friends_hidden: number; friends_at: number | null } | undefined;
  const n = Object.fromEntries((counts.results as { source: string; n: number }[]).map((r) => [r.source, r.n]));
  const sourcesOf = new Map((mine.results as { id: string; sources: string }[]).map((r) => [r.id, r.sources.split(",")]));
  const byFriend = new Map<string, ReturnType<typeof charOut>[]>();
  for (const r of chars.results as unknown as FriendCharRow[]) byFriend.set(r.user_id, [...(byFriend.get(r.user_id) ?? []), charOut(r)]);
  const { results: distinct } = await env.DB.prepare("SELECT COUNT(DISTINCT tag_hash) AS n FROM friend_tags WHERE user_id = ?")
    .bind(user.id)
    .all<{ n: number }>();
  // Friends are told apart by position only: nothing here says who they are.
  const friends = [...byFriend.entries()].map(([id, characters]) => ({ characters, sources: sourcesOf.get(id) ?? [] }));
  const listed = friends.filter((f) => f.sources.length).length;
  return json({
    visible: !s?.friends_hidden,
    updatedAt: s?.friends_at ?? null,
    counts: { jf: n.jf ?? 0, rts: n.rts ?? 0, total: distinct[0]?.n ?? 0 },
    friends,
    notOnSite: Math.max(0, (distinct[0]?.n ?? 0) - listed),
    ...(notSaved && { notSaved }),
  });
}

function charOut(r: FriendCharRow) {
  const s = JSON.parse(r.summary) as CharacterSummary;
  return { name: r.name, realm: r.realm, slug: r.slug, level: s.level, className: s.className, race: s.race };
}

// PATCH /api/friends { visible }
export async function setFriendsVisible(env: Env, user: User, body: unknown): Promise<Response> {
  const b = body as { visible?: unknown };
  if (typeof b?.visible !== "boolean") throw new HttpError(400, "Send visible");
  await env.DB.prepare("UPDATE users SET friends_hidden = ? WHERE id = ?").bind(b.visible ? 0 : 1, user.id).run();
  return friendsOf(env, user);
}

// DELETE /api/friends: forget the lists until the next upload.
export async function forgetFriends(env: Env, user: User): Promise<Response> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM friend_tags WHERE user_id = ?").bind(user.id),
    env.DB.prepare("DELETE FROM friend_tags_old WHERE user_id = ?").bind(user.id),
    env.DB.prepare("UPDATE users SET friends_at = NULL WHERE id = ?").bind(user.id),
  ]);
  return friendsOf(env, user);
}
