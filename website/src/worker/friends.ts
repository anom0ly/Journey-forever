// Battle.net friends: the hashed BattleTag lists from uploads, and who of the
// site's users they match. A match goes either way (your list has them, or
// theirs has you), unless they turned off "Show me to my Battle.net friends".
// Only public characters are ever shown as a friend's.

import { HASH, hashTag, MAX_FRIENDS, type FriendSource } from "../lib/friendTags";
import type { CharacterSummary } from "../lib/journey";
import type { Env, User } from "./env";
import { HttpError, json, now } from "./http";

const SOURCES: FriendSource[] = ["jf", "rts"];

// Users from before friends get their hash on first need.
async function fillTagHashes(env: Env): Promise<void> {
  const { results } = await env.DB.prepare("SELECT id, battletag FROM users WHERE tag_hash IS NULL AND battletag IS NOT NULL LIMIT 500").all<{
    id: string;
    battletag: string;
  }>();
  if (!results.length) return;
  const update = env.DB.prepare("UPDATE users SET tag_hash = ? WHERE id = ?");
  await env.DB.batch(await Promise.all(results.map(async (r) => update.bind(await hashTag(r.battletag), r.id))));
}

// The user ids of the viewer's friends on the site (not the viewer).
export async function friendIds(env: Env, viewer: User | null): Promise<string[]> {
  if (!viewer) return [];
  await fillTagHashes(env);
  const own = viewer.battletag ? await hashTag(viewer.battletag) : "";
  const { results } = await env.DB.prepare(
    `SELECT u.id FROM users u WHERE u.id != ?1 AND u.friends_hidden = 0 AND (
       u.tag_hash IN (SELECT tag_hash FROM friend_tags WHERE user_id = ?1)
       OR (?2 != '' AND EXISTS (SELECT 1 FROM friend_tags t WHERE t.user_id = u.id AND t.tag_hash = ?2)))`,
  )
    .bind(viewer.id, own)
    .all<{ id: string }>();
  return results.map((r) => r.id);
}

// PUT /api/friends { jf?: hashes, rts?: hashes }: each list sent replaces
// the stored one; a list left out is kept.
export async function saveFriends(env: Env, user: User, body: unknown): Promise<Response> {
  const b = (body ?? {}) as Partial<Record<FriendSource, unknown>>;
  const stmts = [];
  const insert = env.DB.prepare("INSERT OR IGNORE INTO friend_tags (user_id, source, tag_hash) VALUES (?, ?, ?)");
  let sent = 0;
  for (const source of SOURCES) {
    const list = b[source];
    if (list === undefined) continue;
    if (!Array.isArray(list) || list.length > MAX_FRIENDS || !list.every((h) => typeof h === "string" && HASH.test(h))) {
      throw new HttpError(400, "Send lists of hashes");
    }
    sent++;
    stmts.push(env.DB.prepare("DELETE FROM friend_tags WHERE user_id = ? AND source = ?").bind(user.id, source));
    for (const h of new Set(list as string[])) stmts.push(insert.bind(user.id, source, h));
  }
  if (!sent) throw new HttpError(400, "Send a friends list");
  stmts.push(env.DB.prepare("UPDATE users SET friends_at = ? WHERE id = ?").bind(now(), user.id));
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
export async function friendsOf(env: Env, user: User): Promise<Response> {
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
    env.DB.prepare("UPDATE users SET friends_at = NULL WHERE id = ?").bind(user.id),
  ]);
  return friendsOf(env, user);
}
