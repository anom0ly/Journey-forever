// Leaderboards, reports and the review page. The board numbers are worked
// out in the owner's browser (lib/boards.ts) and only sorted here. Only
// public characters with board_state 0 are ranked: 1 is held off the boards
// by 10+ reports from different accounts, 2 hidden by the reviewer.

import { BOARD_BY_ID, BOARDS_VERSION, fixedParams, HELD_BOARDS, HELD_TOP, type BoardEntry } from "../lib/boardDefs";
import type { CharacterSummary } from "../lib/journey";
import { isFreeParam, knownParam, NEW_PARAM_ACCOUNTS, paramLooksRight, paramsPerCharacter, valueInRange } from "../lib/checks";
import type { Env, User } from "./env";
import { friendIds } from "./friends";
import { HttpError, json, now } from "./http";

const ENTRIES_LIMIT = 1500;
const CHECKS_LIMIT = 20;
const PAGE = 50;
export const HOLD_REPORTS = 10;
// Only reports from established accounts count toward a hold: the account
// was at least 3 days old when it reported, and the site first saw one of
// its characters at least 2 days before the report. Both are things the
// server saw itself, not numbers the reporter's browser sent. Every report
// still reaches the review page.
export const ESTABLISHED_AGE = 3 * 86400;
export const ESTABLISHED_UPLOAD = 2 * 86400;
const ESTABLISHED = `EXISTS (SELECT 1 FROM users ru WHERE ru.id = r.reporter_id AND ru.created_at <= r.created_at - ${ESTABLISHED_AGE})
  AND EXISTS (SELECT 1 FROM characters rc WHERE rc.user_id = r.reporter_id AND rc.first_upload_at <= r.created_at - ${ESTABLISHED_UPLOAD})`;
export const DAILY_REPORTS = 5;
export const REASONS: Record<string, string> = {
  impossible: "The numbers look impossible",
  edited: "The journey looks edited or made up",
  name: "Offensive name",
  other: "Something else",
};

// Listed on the boards: public, with a link, not held or hidden.
const LISTED = "c.is_public = 1 AND c.slug IS NOT NULL AND c.board_state = 0";

function score(boardId: string, value: number, tie: number | undefined): number {
  const def = BOARD_BY_ID.get(boardId)!;
  const t = typeof tie === "number" && Number.isFinite(tie) ? Math.min(0.999, Math.max(0, tie)) : 0;
  return (def.dir === "asc" ? value : -value) + t;
}

export function isAdmin(env: Env, user: User | null): boolean {
  if (!user?.bnet_id) return false;
  const ids = (env.ADMIN_BNET_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return ids.includes(user.bnet_id);
}

// ---------------------------------------------------------------- storing

// The owner's browser sends the board numbers and the automatic checks
// after each upload (and when the numbers' version changes). An admin's
// browser sends them too when it recalculates every public character.
export async function saveBoards(env: Env, userId: string, key: string, body: unknown): Promise<Response> {
  const b = body as { entries?: unknown; checks?: unknown; version?: unknown };
  if (!Array.isArray(b?.entries) || b.entries.length > ENTRIES_LIMIT) throw new HttpError(400, "Send entries");
  const entries: BoardEntry[] = [];
  const seen = new Set<string>();
  const perKind = new Map<string, Set<string>>();
  for (const e of b.entries as BoardEntry[]) {
    const def = e && typeof e.b === "string" ? BOARD_BY_ID.get(e.b) : undefined;
    if (!def || typeof e.v !== "number" || !valueInRange(def.fmt, e.v)) continue;
    const p = typeof e.p === "string" ? e.p : "";
    if (def.param ? !p : p) continue;
    const fixed = fixedParams(def.param);
    if (fixed && !fixed.includes(p)) continue;
    if (isFreeParam(def.param)) {
      // Zones, dungeons and professions are names from the game: anything
      // else is dropped, and one character can only have so many.
      if (!paramLooksRight(p)) continue;
      const names = perKind.get(def.param) ?? new Set<string>();
      if (!names.has(p) && names.size >= paramsPerCharacter(def.param)) continue;
      names.add(p);
      perKind.set(def.param, names);
    }
    const id = `${e.b}\u0000${p}`;
    if (seen.has(id)) continue;
    seen.add(id);
    entries.push({ b: e.b, p, v: e.v, t: e.t });
  }
  const sent = Array.isArray(b.checks) ? b.checks.filter((c): c is string => typeof c === "string").slice(0, CHECKS_LIMIT).map((c) => c.slice(0, 200)) : [];
  const row = await env.DB.prepare("SELECT name, realm, summary FROM characters WHERE user_id = ? AND key = ?")
    .bind(userId, key)
    .first<{ name: string; realm: string; summary: string }>();
  if (!row) throw new HttpError(404, "No such character");
  // The server's own lines go in whatever the browser sent, so leaving
  // checks out of the request doesn't hide them.
  const checks = [...new Set([...serverChecks(entries, JSON.parse(row.summary) as CharacterSummary), ...sent])].slice(0, CHECKS_LIMIT);
  // A character the reviewer hid stays hidden, even if it was deleted and
  // uploaded again since (the summary upload checks this too).
  await applyModeration(env, userId, key, row.name, row.realm);

  const scored: Scored[] = entries.map((e) => ({ b: e.b, p: e.p ?? "", v: e.v, s: score(e.b, e.v, e.t), t: e.t }));
  const { listed, held } = await holdTopPlaces(env, userId, key, scored);
  const stmts = [
    env.DB.prepare("DELETE FROM board_entries WHERE user_id = ? AND char_key = ?").bind(userId, key),
    env.DB.prepare("DELETE FROM board_held WHERE user_id = ? AND char_key = ?").bind(userId, key),
    env.DB.prepare("UPDATE characters SET checks = ?, boards_version = ? WHERE user_id = ? AND key = ?").bind(
      checks.length ? JSON.stringify(checks) : null, typeof b.version === "number" ? b.version : BOARDS_VERSION, userId, key,
    ),
  ];
  const insert = env.DB.prepare("INSERT INTO board_entries (user_id, char_key, board, param, value, score) VALUES (?, ?, ?, ?, ?, ?)");
  for (const e of listed) stmts.push(insert.bind(userId, key, e.b, e.p, e.v, e.s));
  const hold = env.DB.prepare("INSERT INTO board_held (user_id, char_key, board, param, value, score, declined, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  for (const h of held) stmts.push(hold.bind(userId, key, h.b, h.p, h.v, h.s, h.declined ? 1 : 0, h.createdAt));
  await env.DB.batch(stmts);
  // This character's new times may push someone's waiting time out of the top places.
  await releaseHeld(env, scored.filter((e) => HELD_BOARDS.has(e.b)).map((e) => [e.b, e.p]));
  await openForChecks(env, userId, key, checks);
  return json({ ok: true, entries: entries.length, held: held.filter((h) => !h.declined).length });
}

// ---------------------------------------------------------------- held top places

interface Scored {
  b: string;
  p: string;
  v: number;
  s: number;
  t?: number;
}

interface Held extends Scored {
  declined: boolean;
  createdAt: number;
}

// Splits a character's new numbers into the ones listed now and the ones
// that wait for the reviewer: a time on a held board that would be in the
// top places among listed characters and isn't covered by an approval
// (that time or slower). While a time waits, the character's last approved
// time on that board is listed instead, if there is one.
export async function holdTopPlaces(env: Env, userId: string, key: string, entries: Scored[]): Promise<{ listed: Scored[]; held: Held[] }> {
  const candidates = entries.filter((e) => HELD_BOARDS.has(e.b));
  if (!candidates.length) return { listed: entries, held: [] };
  const id = (b: string, p: string) => `${b}\u0000${p}`;
  const [approvals, before] = await env.DB.batch([
    env.DB.prepare("SELECT board, param, approved, declined FROM board_approvals WHERE user_id = ? AND char_key = ?").bind(userId, key),
    env.DB.prepare("SELECT board, param, value, created_at FROM board_held WHERE user_id = ? AND char_key = ?").bind(userId, key),
  ]);
  const decided = new Map(
    (approvals.results as { board: string; param: string; approved: number | null; declined: number | null }[]).map((a) => [id(a.board, a.param), a]),
  );
  const waited = new Map((before.results as { board: string; param: string; value: number; created_at: number }[]).map((h) => [id(h.board, h.param), h]));
  const unapproved = candidates.filter((e) => {
    const a = decided.get(id(e.b, e.p));
    return !(a?.approved != null && e.v >= a.approved);
  });
  if (!unapproved.length) return { listed: entries, held: [] };

  // How many listed characters are ahead of each time, in one query.
  const { results } = await env.DB.prepare(
    `SELECT CAST(j.key AS INTEGER) AS i,
       (SELECT COUNT(*) FROM board_entries o JOIN characters c ON c.user_id = o.user_id AND c.key = o.char_key
        WHERE o.board = json_extract(j.value, '$.b') AND o.param = json_extract(j.value, '$.p') AND o.score < json_extract(j.value, '$.s')
          AND NOT (o.user_id = ? AND o.char_key = ?) AND ${LISTED}) AS ahead
     FROM json_each(?) j`,
  )
    .bind(userId, key, JSON.stringify(unapproved.map((e) => ({ b: e.b, p: e.p, s: e.s }))))
    .all<{ i: number; ahead: number }>();
  const top = new Set(results.filter((r) => r.ahead < HELD_TOP).map((r) => unapproved[r.i]));

  const time = now();
  const listed: Scored[] = [];
  const held: Held[] = [];
  for (const e of entries) {
    if (!top.has(e)) {
      listed.push(e);
      continue;
    }
    const a = decided.get(id(e.b, e.p));
    const old = waited.get(id(e.b, e.p));
    held.push({ ...e, declined: a?.declined != null && e.v >= a.declined, createdAt: old && old.value === e.v ? old.created_at : time });
    if (a?.approved != null) listed.push({ b: e.b, p: e.p, v: a.approved, s: score(e.b, a.approved, e.t) });
  }
  return { listed, held };
}

// Lists waiting times that are no longer in the top places (others got
// faster), on the given boards or on all of them. Listing one can push
// another out, so it goes round until nothing moves.
export async function releaseHeld(env: Env, boards?: [string, string][]): Promise<number> {
  if (boards && !boards.length) return 0;
  let released = 0;
  for (let pass = 0; pass < 5; pass++) {
    const { results } = await env.DB.prepare(
      `SELECT h.user_id, h.char_key, h.board, h.param, h.value, h.score FROM board_held h
       WHERE (?1 IS NULL OR EXISTS (SELECT 1 FROM json_each(?1) j WHERE json_extract(j.value, '$[0]') = h.board AND json_extract(j.value, '$[1]') = h.param))
         AND (SELECT COUNT(*) FROM board_entries o JOIN characters c ON c.user_id = o.user_id AND c.key = o.char_key
              WHERE o.board = h.board AND o.param = h.param AND o.score < h.score AND NOT (o.user_id = h.user_id AND o.char_key = h.char_key) AND ${LISTED}) >= ?2`,
    )
      .bind(boards ? JSON.stringify(boards) : null, HELD_TOP)
      .all<{ user_id: string; char_key: string; board: string; param: string; value: number; score: number }>();
    if (!results.length) break;
    released += results.length;
    await env.DB.batch(results.flatMap((h) => listHeld(env, h)));
  }
  return released;
}

// Moves a waiting time onto its board, replacing the approved one shown meanwhile.
function listHeld(env: Env, h: { user_id: string; char_key: string; board: string; param: string; value: number; score: number }) {
  return [
    env.DB.prepare(
      `INSERT INTO board_entries (user_id, char_key, board, param, value, score) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id, char_key, board, param) DO UPDATE SET value = excluded.value, score = excluded.score`,
    ).bind(h.user_id, h.char_key, h.board, h.param, h.value, h.score),
    env.DB.prepare("DELETE FROM board_held WHERE user_id = ? AND char_key = ? AND board = ? AND param = ?").bind(h.user_id, h.char_key, h.board, h.param),
  ];
}

// Lines the server adds to a character's checks from the numbers it was
// sent and the stored summary, whatever checks the browser sent.
export const FASTEST_60 = 3 * 86400;
export function serverChecks(entries: { b: string; p?: string; v: number }[], summary: Pick<CharacterSummary, "played">): string[] {
  const out: string[] = [];
  const played = typeof summary.played === "number" && summary.played > 0 ? summary.played : undefined;
  const hours = (s: number) => `${Math.round(s / 3600)} hours`;
  let levelSum = 0;
  for (const e of entries) {
    if (e.b === "to60" && e.v < FASTEST_60) out.push(`Level 1 to 60 in ${hours(e.v)} of played time, faster than any known speedrun.`);
    if (e.b === "levelfast") {
      levelSum += e.v;
      const level = Number(e.p);
      if (level >= 10 && e.v < level * 60) out.push(`Level ${level} took ${Math.round(e.v / 60)} minutes of played time.`);
    }
    if (played !== undefined && (e.b === "to60" || e.b === "tolevel") && e.v > played + 3600) {
      out.push(`${e.b === "to60" ? "Level 60" : `Level ${e.p}`} was reached in ${hours(e.v)} of played time, more than the character's ${hours(played)} in total.`);
    }
  }
  if (played !== undefined && levelSum > played + 3600) out.push(`Its level times add up to ${hours(levelSum)}, more than the character's ${hours(played)} of played time.`);
  return out;
}

// GET /api/review/places: characters with top places waiting, oldest first.
export async function placesList(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT h.user_id, h.char_key, h.board, h.param, h.value, h.score, h.created_at, c.name, c.realm, c.slug, c.summary, c.checks, c.updated_at,
       (SELECT COUNT(*) FROM board_entries o JOIN characters oc ON oc.user_id = o.user_id AND oc.key = o.char_key
        WHERE o.board = h.board AND o.param = h.param AND o.score < h.score AND NOT (o.user_id = h.user_id AND o.char_key = h.char_key) AND ${LISTED.replaceAll("c.", "oc.")}) + 1 AS rank
     FROM board_held h JOIN characters c ON c.user_id = h.user_id AND c.key = h.char_key
     WHERE h.declined = 0 AND ${LISTED} ORDER BY h.created_at, h.board, h.param LIMIT 300`,
  ).all<{
    user_id: string; char_key: string; board: string; param: string; value: number; score: number; created_at: number;
    name: string; realm: string; slug: string; summary: string; checks: string | null; updated_at: number; rank: number;
  }>();
  const items = new Map<string, ReturnType<typeof placeItem>>();
  for (const r of results) {
    const k = `${r.user_id}\u0000${r.char_key}`;
    if (!items.has(k)) items.set(k, placeItem(r, [...parseLines(r.checks), ...(await relativeChecks(env, r.user_id, r.char_key))]));
    const { results: top } = await env.DB.prepare(
      `SELECT e.value, c.name FROM board_entries e JOIN characters c ON c.user_id = e.user_id AND c.key = e.char_key
       WHERE e.board = ? AND e.param = ? AND ${LISTED} ORDER BY e.score LIMIT ${HELD_TOP}`,
    )
      .bind(r.board, r.param)
      .all<{ value: number; name: string }>();
    items.get(k)!.places.push({ board: r.board, param: r.param, value: r.value, rank: r.rank, top });
  }
  return json({ items: [...items.values()] });
}

function placeItem(r: { slug: string; name: string; realm: string; summary: string; updated_at: number; created_at: number }, checks: string[]) {
  const s = JSON.parse(r.summary) as CharacterSummary;
  return {
    slug: r.slug, name: r.name, realm: r.realm, level: s.level, className: s.className, race: s.race,
    uploadedAt: r.updated_at, waitingSince: r.created_at, checks,
    places: [] as { board: string; param: string; value: number; rank: number; top: { value: number; name: string }[] }[],
  };
}

// POST /api/review/places/:slug { action: "approve" | "decline" }. Approve
// lists every waiting time the character has; decline keeps them off
// quietly until a faster time comes.
export async function placesAction(env: Env, slug: string, body: unknown): Promise<Response> {
  const action = (body as { action?: unknown })?.action;
  if (action !== "approve" && action !== "decline") throw new HttpError(400, "Send approve or decline");
  const c = await env.DB.prepare("SELECT user_id, key FROM characters WHERE slug = ?").bind(slug).first<Target>();
  if (!c) throw new HttpError(404, "No such character");
  const { results } = await env.DB.prepare(
    "SELECT user_id, char_key, board, param, value, score FROM board_held WHERE user_id = ? AND char_key = ? AND declined = 0",
  )
    .bind(c.user_id, c.key)
    .all<{ user_id: string; char_key: string; board: string; param: string; value: number; score: number }>();
  const time = now();
  const stmts = [];
  for (const h of results) {
    if (action === "approve") {
      stmts.push(
        env.DB.prepare(
          `INSERT INTO board_approvals (user_id, char_key, board, param, approved, updated_at) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (user_id, char_key, board, param) DO UPDATE SET approved = excluded.approved, declined = NULL, updated_at = excluded.updated_at`,
        ).bind(h.user_id, h.char_key, h.board, h.param, h.value, time),
        ...listHeld(env, h),
      );
    } else {
      stmts.push(
        env.DB.prepare(
          `INSERT INTO board_approvals (user_id, char_key, board, param, declined, updated_at) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (user_id, char_key, board, param) DO UPDATE SET declined = excluded.declined, updated_at = excluded.updated_at`,
        ).bind(h.user_id, h.char_key, h.board, h.param, h.value, time),
        env.DB.prepare("UPDATE board_held SET declined = 1 WHERE user_id = ? AND char_key = ? AND board = ? AND param = ?").bind(h.user_id, h.char_key, h.board, h.param),
      );
    }
  }
  if (stmts.length) await env.DB.batch(stmts);
  if (action === "approve") await releaseHeld(env);
  return json({ ok: true, places: results.length });
}

// GET /api/review/boards: the public characters an admin can recalculate.
export async function recalcList(env: Env): Promise<Response> {
  const rows = await env.DB.prepare(
    "SELECT slug, name, boards_version FROM characters WHERE is_public = 1 AND slug IS NOT NULL AND journey_size IS NOT NULL ORDER BY name COLLATE NOCASE",
  ).all<{ slug: string; name: string; boards_version: number | null }>();
  return json({ characters: rows.results.map((r) => ({ slug: r.slug, name: r.name, boardsVersion: r.boards_version })) });
}

// PUT /api/review/boards/<slug>: an admin's recalculated numbers for a
// public character, stored as if its owner had sent them.
export async function recalcSave(env: Env, slug: string, body: unknown): Promise<Response> {
  const row = await env.DB.prepare("SELECT user_id, key FROM characters WHERE slug = ? AND is_public = 1").bind(slug).first<{ user_id: string; key: string }>();
  if (!row) throw new HttpError(404, "No such public character");
  return saveBoards(env, row.user_id, row.key, body);
}

// ---------------------------------------------------------------- boards

interface RankRow {
  value: number;
  score: number;
  name: string;
  realm: string;
  slug: string;
  summary: string;
  user_id: string;
}

function rowOut(r: RankRow, rank: number, viewer: User | null, friends?: Set<string>) {
  const s = JSON.parse(r.summary) as CharacterSummary;
  const mine = !!viewer && r.user_id === viewer.id;
  return {
    rank, value: r.value, name: r.name, realm: r.realm, slug: r.slug, level: s.level, className: s.className, race: s.race,
    mine, friend: !mine && !!friends?.has(r.user_id),
  };
}

// The filters a board can be narrowed by.
function filters(url: URL, viewer: User | null, friends: string[] = [], withShow = true): { sql: string; args: unknown[] } {
  const parts: string[] = [];
  const args: unknown[] = [];
  const realm = url.searchParams.get("realm");
  if (realm) {
    parts.push("c.realm = ?");
    args.push(realm);
  }
  const cls = url.searchParams.get("class");
  if (cls) {
    parts.push("json_extract(c.summary, '$.className') = ?");
    args.push(cls);
  }
  const show = withShow ? url.searchParams.get("show") : null;
  if (show === "mine") {
    parts.push("c.user_id = ?");
    args.push(viewer?.id ?? "");
  } else if (show === "friends") {
    // You and your friends.
    parts.push("c.user_id IN (SELECT value FROM json_each(?))");
    args.push(JSON.stringify(viewer ? [viewer.id, ...friends] : []));
  }
  return { sql: parts.map((p) => ` AND ${p}`).join(""), args };
}

// GET /api/boards: the realms and classes to filter by.
export async function boardsMeta(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT c.realm AS realm, json_extract(c.summary, '$.className') AS cls, COUNT(DISTINCT c.user_id) AS users FROM characters c
     WHERE ${LISTED} GROUP BY c.realm, cls`,
  ).all<{ realm: string; cls: string | null; users: number }>();
  // A realm is offered once characters from several accounts are on it, so
  // one account can't fill the list with names of its own.
  const realmUsers = new Map<string, number>();
  for (const r of results) realmUsers.set(r.realm, (realmUsers.get(r.realm) ?? 0) + r.users);
  const realms = [...realmUsers].filter(([, n]) => n >= NEW_PARAM_ACCOUNTS).map(([r]) => r).sort();
  const classes = [...new Set(results.map((r) => r.cls).filter((c): c is string => !!c))].sort();
  return json({ realms, classes }, { headers: { "cache-control": "public, max-age=60" } });
}

// GET /api/boards/:board?param=&realm=&class=&show=&limit=&offset=
export async function board(env: Env, url: URL, id: string, viewer: User | null): Promise<Response> {
  const def = BOARD_BY_ID.get(id);
  if (!def) throw new HttpError(404, "No such board");
  const friendList = await friendIds(env, viewer);
  const friends = new Set(friendList);
  const show = url.searchParams.get("show");
  const f = filters(url, viewer, friendList);

  // Boards by zone, dungeon or profession offer the ones anybody has.
  let params: string[] | undefined = fixedParams(def.param);
  const free = isFreeParam(def.param) ? def.param : undefined;
  if (free) {
    // Known names, and new ones (Forever's own, other languages) once
    // several accounts have them.
    const { results } = await env.DB.prepare(
      `SELECT e.param AS param, COUNT(*) AS n, COUNT(DISTINCT e.user_id) AS users FROM board_entries e
       JOIN characters c ON c.user_id = e.user_id AND c.key = e.char_key
       WHERE e.board = ? AND ${LISTED}${f.sql} GROUP BY e.param ORDER BY n DESC, e.param LIMIT 400`,
    )
      .bind(id, ...f.args)
      .all<{ param: string; users: number }>();
    params = results.filter((r) => knownParam(free, r.param) || r.users >= NEW_PARAM_ACCOUNTS).slice(0, 200).map((r) => r.param);
  }
  const asked = url.searchParams.get("param");
  const param = def.param ? (asked && (!free || params!.includes(asked)) ? asked : def.defaultParam || params?.[0] || "") : "";
  const limit = Math.min(PAGE, Math.max(1, Number(url.searchParams.get("limit")) || PAGE));
  const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);

  const from = `FROM board_entries e JOIN characters c ON c.user_id = e.user_id AND c.key = e.char_key WHERE e.board = ? AND e.param = ? AND ${LISTED}${f.sql}`;
  const [page, count] = await env.DB.batch([
    env.DB.prepare(`SELECT e.value, e.score, c.name, c.realm, c.slug, c.summary, c.user_id ${from} ORDER BY e.score, c.name COLLATE NOCASE LIMIT ? OFFSET ?`).bind(
      id, param, ...f.args, limit, offset,
    ),
    env.DB.prepare(`SELECT COUNT(*) AS n ${from}`).bind(id, param, ...f.args),
  ]);
  const rows = page.results as unknown as RankRow[];
  const total = (count.results[0] as { n: number }).n;

  // Ranks share a number on a tie.
  const out: ReturnType<typeof rowOut>[] = [];
  let rank = 0;
  for (let i = 0; i < rows.length; i++) {
    if (i === 0) {
      rank = offset === 0 ? 1 : await rankOf(env, id, param, rows[0].score, f);
    } else if (rows[i].score !== rows[i - 1].score) rank = offset + i + 1;
    out.push(rowOut(rows[i], rank, viewer, friends));
  }

  // The viewer's best character on this board, when it isn't on the page.
  let me;
  let best: RankRow | null = null;
  if (viewer && !out.some((r) => r.mine)) {
    best = await env.DB.prepare(`SELECT e.value, e.score, c.name, c.realm, c.slug, c.summary, c.user_id ${from} AND c.user_id = ? ORDER BY e.score LIMIT 1`)
      .bind(id, param, ...f.args, viewer.id)
      .first<RankRow>();
    if (best) me = rowOut(best, await rankOf(env, id, param, best.score, f), viewer, friends);
  }

  // Ranked among you and your friends, each row also gets its place on the
  // whole board (with the realm and class filters).
  if (show === "friends") {
    const all = filters(url, viewer, friendList, false);
    const scored: [ReturnType<typeof rowOut>, number][] = out.map((r, i) => [r, rows[i].score]);
    if (me && best) scored.push([me, best.score]);
    await Promise.all(scored.map(async ([r, sc]) => Object.assign(r, { overall: await rankOf(env, id, param, sc, all) })));
  }

  // On the whole board, up to two friends further down are added under the
  // page: the ones nearest your own place, or the best two.
  const near: ReturnType<typeof rowOut>[] = [];
  if (friendList.length && !show && offset === 0) {
    const onPage = new Set(out.map((r) => r.slug));
    const { results } = await env.DB.prepare(
      `SELECT e.value, e.score, c.name, c.realm, c.slug, c.summary, c.user_id ${from} AND c.user_id IN (SELECT value FROM json_each(?))
       ORDER BY e.score LIMIT 200`,
    )
      .bind(id, param, ...f.args, JSON.stringify(friendList))
      .all<RankRow>();
    const lower = results.filter((r) => !onPage.has(r.slug));
    const target = best?.score ?? rows.find((_, i) => out[i].mine)?.score;
    const picked = target === undefined ? lower.slice(0, 2) : [...lower].sort((x, y) => Math.abs(x.score - target) - Math.abs(y.score - target)).slice(0, 2);
    picked.sort((x, y) => x.score - y.score);
    for (const r of picked) near.push(rowOut(r, await rankOf(env, id, param, r.score, f), viewer, friends));
  }
  // Waiting top places: how many (for the public note) and, for their
  // owner, their own rows numbered where they would rank.
  let waiting = 0;
  const mineWaiting: (ReturnType<typeof rowOut> & { waiting: true })[] = [];
  if (HELD_BOARDS.has(id)) {
    const w = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM board_held h JOIN characters c ON c.user_id = h.user_id AND c.key = h.char_key
       WHERE h.board = ? AND h.param = ? AND h.declined = 0 AND ${LISTED}`,
    )
      .bind(id, param)
      .first<{ n: number }>();
    waiting = w?.n ?? 0;
    if (viewer && offset === 0) {
      const { results } = await env.DB.prepare(
        `SELECT h.value, h.score, c.name, c.realm, c.slug, c.summary, c.user_id FROM board_held h
         JOIN characters c ON c.user_id = h.user_id AND c.key = h.char_key
         WHERE h.board = ? AND h.param = ? AND h.user_id = ? AND ${LISTED}${f.sql} ORDER BY h.score`,
      )
        .bind(id, param, viewer.id, ...f.args)
        .all<RankRow>();
      for (const r of results) mineWaiting.push({ ...rowOut(r, await rankOf(env, id, param, r.score, f), viewer, friends), waiting: true });
    }
  }
  return json({ board: id, param, params, total, rows: out, me, friends: near, waiting, mineWaiting });
}

async function rankOf(env: Env, id: string, param: string, s: number, f: { sql: string; args: unknown[] }): Promise<number> {
  const r = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM board_entries e JOIN characters c ON c.user_id = e.user_id AND c.key = e.char_key
     WHERE e.board = ? AND e.param = ? AND e.score < ? AND ${LISTED}${f.sql}`,
  )
    .bind(id, param, s, ...f.args)
    .first<{ n: number }>();
  return (r?.n ?? 0) + 1;
}

// A character's places on every board, best first, among listed characters.
export async function ranksOf(env: Env, userId: string, key: string, max = 10) {
  const { results } = await env.DB.prepare(
    `SELECT e.board, e.param, e.value,
       (SELECT COUNT(*) FROM board_entries o JOIN characters c ON c.user_id = o.user_id AND c.key = o.char_key
        WHERE o.board = e.board AND o.param = e.param AND o.score < e.score AND ${LISTED}) + 1 AS rank
     FROM board_entries e WHERE e.user_id = ? AND e.char_key = ?`,
  )
    .bind(userId, key)
    .all<{ board: string; param: string; value: number; rank: number }>();
  return results.filter((r) => r.rank <= max).sort((a, b) => a.rank - b.rank || a.board.localeCompare(b.board));
}

// The owner's waiting places, numbered where they would rank on the whole
// board today, to show first among the journey page's chips.
export async function waitingRanks(env: Env, userId: string, key: string) {
  const { results } = await env.DB.prepare(
    `SELECT h.board, h.param, h.value, h.declined,
       (SELECT COUNT(*) FROM board_entries o JOIN characters c ON c.user_id = o.user_id AND c.key = o.char_key
        WHERE o.board = h.board AND o.param = h.param AND o.score < h.score AND NOT (o.user_id = h.user_id AND o.char_key = h.char_key) AND ${LISTED}) + 1 AS rank
     FROM board_held h WHERE h.user_id = ? AND h.char_key = ? ORDER BY rank, h.board`,
  )
    .bind(userId, key)
    .all<{ board: string; param: string; value: number; rank: number }>();
  return results.map((r) => ({ board: r.board, param: r.param, value: r.value, rank: r.rank, waiting: true }));
}

// GET /api/public/:slug/ranks
export async function publicRanks(env: Env, slug: string): Promise<Response> {
  const row = await env.DB.prepare(`SELECT c.user_id, c.key FROM characters c WHERE c.slug = ? AND ${LISTED}`).bind(slug).first<{ user_id: string; key: string }>();
  if (!row) return json({ ranks: [] });
  return json({ ranks: await ranksOf(env, row.user_id, row.key) }, { headers: { "cache-control": "public, max-age=60" } });
}

// ---------------------------------------------------------------- reports

interface Target {
  user_id: string;
  key: string;
}

async function publicTarget(env: Env, slug: string): Promise<Target> {
  const t = await env.DB.prepare("SELECT user_id, key FROM characters WHERE slug = ? AND is_public = 1").bind(slug).first<Target>();
  if (!t) throw new HttpError(404, "This journey is private or doesn't exist");
  return t;
}

// GET /api/public/:slug/report: the viewer's own report, to edit it.
export async function myReport(env: Env, user: User, slug: string): Promise<Response> {
  const t = await publicTarget(env, slug);
  const r = await env.DB.prepare("SELECT reason, note FROM reports WHERE reporter_id = ? AND user_id = ? AND char_key = ?")
    .bind(user.id, t.user_id, t.key)
    .first<{ reason: string; note: string | null }>();
  return json({ report: r ?? null, own: t.user_id === user.id });
}

// POST /api/public/:slug/report { reason, note }
export async function report(env: Env, user: User, slug: string, body: unknown): Promise<Response> {
  const b = body as { reason?: unknown; note?: unknown };
  if (typeof b?.reason !== "string" || !REASONS[b.reason]) throw new HttpError(400, "Pick what's wrong");
  const note = typeof b.note === "string" && b.note.trim() ? b.note.trim().slice(0, 500) : null;
  const t = await publicTarget(env, slug);
  if (t.user_id === user.id) throw new HttpError(400, "You can't report your own character");
  const uploaded = await env.DB.prepare("SELECT 1 FROM characters WHERE user_id = ? LIMIT 1").bind(user.id).first();
  if (!uploaded) throw new HttpError(403, "Upload one of your own characters before reporting others");

  const time = now();
  const existing = await env.DB.prepare("SELECT 1 FROM reports WHERE reporter_id = ? AND user_id = ? AND char_key = ?").bind(user.id, t.user_id, t.key).first();
  if (existing) {
    // A second send edits the first; it never counts again.
    await env.DB.prepare("UPDATE reports SET reason = ?, note = ?, updated_at = ? WHERE reporter_id = ? AND user_id = ? AND char_key = ?")
      .bind(b.reason, note, time, user.id, t.user_id, t.key)
      .run();
    return json({ ok: true, updated: true });
  }
  const today = await env.DB.prepare("SELECT COUNT(*) AS n FROM reports WHERE reporter_id = ? AND created_at > ?").bind(user.id, time - 86400).first<{ n: number }>();
  if ((today?.n ?? 0) >= DAILY_REPORTS) throw new HttpError(429, `You've sent ${DAILY_REPORTS} reports in the last day. You can report again tomorrow.`);
  await env.DB.prepare("INSERT INTO reports (reporter_id, user_id, char_key, reason, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(user.id, t.user_id, t.key, b.reason, note, time, time)
    .run();
  await refreshFlag(env, t.user_id, t.key);
  return json({ ok: true, updated: false });
}

interface FlagRow {
  status: "open" | "hidden" | "cleared";
  cleared_at: number | null;
}

// Reports that count: made since the flag was last cleared, by accounts
// that aren't ignored. held is the ones from established accounts.
async function activeReports(env: Env, userId: string, key: string, clearedAt: number | null): Promise<{ active: number; held: number }> {
  const r = await env.DB.prepare(
    `SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN ${ESTABLISHED} THEN 1 ELSE 0 END), 0) AS held
     FROM reports r WHERE r.user_id = ? AND r.char_key = ? AND r.created_at > ?
       AND r.reporter_id NOT IN (SELECT reporter_id FROM ignored_reporters)`,
  )
    .bind(userId, key, clearedAt ?? 0)
    .first<{ n: number; held: number }>();
  return { active: r?.n ?? 0, held: r?.held ?? 0 };
}

// Brings a character's flag and board state up to date with its reports.
export async function refreshFlag(env: Env, userId: string, key: string): Promise<void> {
  const time = now();
  let flag = await env.DB.prepare("SELECT status, cleared_at FROM flags WHERE user_id = ? AND char_key = ?").bind(userId, key).first<FlagRow>();
  const { active, held } = await activeReports(env, userId, key, flag?.cleared_at ?? null);
  if (!flag && active > 0) {
    await env.DB.prepare("INSERT INTO flags (user_id, char_key, status, opened_at, updated_at) VALUES (?, ?, 'open', ?, ?)").bind(userId, key, time, time).run();
    flag = { status: "open", cleared_at: null };
  } else if (flag?.status === "cleared" && active > 0) {
    await env.DB.prepare("UPDATE flags SET status = 'open', opened_at = ?, updated_at = ? WHERE user_id = ? AND char_key = ?").bind(time, time, userId, key).run();
    flag = { ...flag, status: "open" };
  }
  const state = flag?.status === "hidden" ? 2 : flag?.status === "open" && held >= HOLD_REPORTS ? 1 : 0;
  await env.DB.prepare("UPDATE characters SET board_state = ? WHERE user_id = ? AND key = ?").bind(state, userId, key).run();
}

// ---------------------------------------------------------------- hides

// A reviewer's Hide lives in the moderation table as well as in flags,
// because deleting a character deletes its flags row. A character matches
// a Hide by its key (the game's GUID) or by name + realm, on any account.

async function rememberHide(env: Env, userId: string, key: string, time: number): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO moderation (user_id, char_key, name, realm, hidden_at)
     SELECT user_id, key, name, realm, ? FROM characters WHERE user_id = ? AND key = ?
     ON CONFLICT (user_id, char_key) DO UPDATE SET name = excluded.name, realm = excluded.realm, hidden_at = excluded.hidden_at`,
  )
    .bind(time, userId, key)
    .run();
}

async function forgetHide(env: Env, userId: string, key: string): Promise<void> {
  await env.DB.prepare(
    `DELETE FROM moderation WHERE (user_id = ?1 AND char_key = ?2) OR char_key = ?2 OR EXISTS (
       SELECT 1 FROM characters c WHERE c.user_id = ?1 AND c.key = ?2
         AND lower(c.name) = lower(moderation.name) AND lower(c.realm) = lower(moderation.realm))`,
  )
    .bind(userId, key)
    .run();
}

// After a character's row is written: if it matches a Hide, it's hidden
// again (flags row back, off the boards). Returns whether it did.
export async function applyModeration(env: Env, userId: string, key: string, name: string, realm: string): Promise<boolean> {
  const hit = await env.DB.prepare(
    `SELECT hidden_at FROM moderation WHERE (user_id = ? AND char_key = ?) OR char_key = ? OR (lower(name) = lower(?) AND lower(realm) = lower(?))
     ORDER BY hidden_at DESC LIMIT 1`,
  )
    .bind(userId, key, key, name, realm)
    .first<{ hidden_at: number }>();
  if (!hit) return false;
  const time = now();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO flags (user_id, char_key, status, opened_at, updated_at) VALUES (?, ?, 'hidden', ?, ?)
       ON CONFLICT (user_id, char_key) DO UPDATE SET status = 'hidden'`,
    ).bind(userId, key, hit.hidden_at, time),
    env.DB.prepare(
      `INSERT INTO moderation (user_id, char_key, name, realm, hidden_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (user_id, char_key) DO UPDATE SET name = excluded.name, realm = excluded.realm`,
    ).bind(userId, key, name, realm, hit.hidden_at),
    env.DB.prepare("UPDATE characters SET board_state = 2 WHERE user_id = ? AND key = ?").bind(userId, key),
  ]);
  return true;
}

// Before an account is deleted: the characters it reported, to refresh
// once its reports are gone.
export async function reportedBy(env: Env, reporterId: string): Promise<Target[]> {
  const { results } = await env.DB.prepare("SELECT DISTINCT user_id, char_key AS key FROM reports WHERE reporter_id = ?").bind(reporterId).all<Target>();
  return results;
}

// ---------------------------------------------------------------- review

// Check lines not seen when the item was last cleared.
export function newCheckLines(checks: string[], seen: string[]): string[] {
  const had = new Set(seen);
  return checks.filter((c) => !had.has(c));
}

function parseLines(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

// After an upload: a public character with a check line nobody has seen
// gets an open review item (a new one, or its cleared one reopened). A
// check never holds or hides a character; that takes reports or you.
async function openForChecks(env: Env, userId: string, key: string, stored: string[]): Promise<void> {
  const c = await env.DB.prepare("SELECT is_public FROM characters WHERE user_id = ? AND key = ?").bind(userId, key).first<{ is_public: number }>();
  if (!c?.is_public) return;
  const checks = [...stored, ...(await relativeChecks(env, userId, key))];
  if (!checks.length) return;
  const flag = await env.DB.prepare("SELECT status, seen_checks FROM flags WHERE user_id = ? AND char_key = ?")
    .bind(userId, key)
    .first<{ status: string; seen_checks: string | null }>();
  if (flag && flag.status !== "cleared") return; // already waiting, or hidden
  if (!newCheckLines(checks, parseLines(flag?.seen_checks)).length) return;
  const time = now();
  await env.DB.prepare(
    `INSERT INTO flags (user_id, char_key, status, opened_at, updated_at, checks_opened_at) VALUES (?, ?, 'open', ?, ?, ?)
     ON CONFLICT (user_id, char_key) DO UPDATE SET status = 'open', opened_at = excluded.opened_at, updated_at = excluded.updated_at,
       checks_opened_at = excluded.checks_opened_at`,
  )
    .bind(userId, key, time, time, time)
    .run();
}

export async function reviewCount(env: Env): Promise<number> {
  const places = await env.DB.prepare(
    `SELECT COUNT(DISTINCT h.user_id || ':' || h.char_key) AS n FROM board_held h JOIN characters c ON c.user_id = h.user_id AND c.key = h.char_key
     WHERE h.declined = 0 AND ${LISTED}`,
  ).first<{ n: number }>();
  const r = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM flags f WHERE f.status = 'open' AND (f.checks_opened_at > COALESCE(f.cleared_at, 0) OR EXISTS (
       SELECT 1 FROM reports r WHERE r.user_id = f.user_id AND r.char_key = f.char_key AND r.created_at > COALESCE(f.cleared_at, 0)
         AND r.reporter_id NOT IN (SELECT reporter_id FROM ignored_reporters)))`,
  ).first<{ n: number }>();
  return (r?.n ?? 0) + (places?.n ?? 0);
}

interface ReviewFlag {
  user_id: string;
  char_key: string;
  status: string;
  opened_at: number;
  updated_at: number;
  cleared_at: number | null;
  seen_checks: string | null;
  checks_opened_at: number | null;
  name: string;
  realm: string;
  slug: string | null;
  summary: string;
  is_public: number;
  board_state: number;
  checks: string | null;
}

// GET /api/review?status=open|hidden|cleared
export async function reviewList(env: Env, url: URL): Promise<Response> {
  const status = url.searchParams.get("status") ?? "open";
  if (!["open", "hidden", "cleared"].includes(status)) throw new HttpError(400, "Bad status");
  const { results } = await env.DB.prepare(
    `SELECT f.*, c.name, c.realm, c.slug, c.summary, c.is_public, c.board_state, c.checks FROM flags f
     JOIN characters c ON c.user_id = f.user_id AND c.key = f.char_key
     WHERE f.status = ? ORDER BY c.board_state DESC, f.updated_at DESC LIMIT 100`,
  )
    .bind(status)
    .all<ReviewFlag>();
  const counts = await env.DB.prepare("SELECT status, COUNT(*) AS n FROM flags GROUP BY status").all<{ status: string; n: number }>();

  const items = [];
  for (const f of results) {
    const reports = await env.DB.prepare(
      `SELECT r.reporter_id, r.reason, r.note, r.created_at, u.battletag,
         (SELECT COUNT(*) FROM reports x WHERE x.reporter_id = r.reporter_id) AS sent,
         (SELECT COUNT(*) FROM reports x JOIN flags g ON g.user_id = x.user_id AND g.char_key = x.char_key
           WHERE x.reporter_id = r.reporter_id AND g.cleared_at IS NOT NULL AND x.created_at <= g.cleared_at) AS cleared,
         EXISTS (SELECT 1 FROM ignored_reporters i WHERE i.reporter_id = r.reporter_id) AS ignored,
         (${ESTABLISHED}) AS established
       FROM reports r JOIN users u ON u.id = r.reporter_id
       WHERE r.user_id = ? AND r.char_key = ? ORDER BY r.created_at DESC LIMIT 200`,
    )
      .bind(f.user_id, f.char_key)
      .all<{ reporter_id: string; reason: string; note: string | null; created_at: number; battletag: string | null; sent: number; cleared: number; ignored: number; established: number }>();
    const s = JSON.parse(f.summary) as CharacterSummary;
    const counted = reports.results.filter((r) => !r.ignored && r.created_at > (f.cleared_at ?? 0));
    const checks = parseLines(f.checks);
    checks.push(...(await relativeChecks(env, f.user_id, f.char_key)));
    const newChecks = newCheckLines(checks, parseLines(f.seen_checks));
    if (status === "open" && !counted.length && !newChecks.length) continue;
    const ranks = await ranksOf(env, f.user_id, f.char_key, 100000);
    items.push({
      slug: f.slug,
      name: f.name,
      realm: f.realm,
      level: s.level,
      className: s.className,
      race: s.race,
      isPublic: !!f.is_public,
      held: f.board_state === 1,
      hidden: f.board_state === 2,
      status: f.status,
      openedAt: f.opened_at,
      clearedAt: f.cleared_at,
      counted: counted.length,
      boards: ranks.length,
      bestRank: ranks[0]?.rank,
      checks,
      newChecks,
      checksOpenedAt: f.checks_opened_at,
      reports: reports.results.map((r) => ({
        reporterId: r.reporter_id,
        battletag: r.battletag,
        reason: REASONS[r.reason] ?? r.reason,
        note: r.note,
        createdAt: r.created_at,
        sent: r.sent,
        cleared: r.cleared,
        ignored: !!r.ignored,
        established: !!r.established,
        counts: !r.ignored && r.created_at > (f.cleared_at ?? 0),
      })),
    });
  }
  return json({ items, counts: Object.fromEntries(counts.results.map((c) => [c.status, c.n])) });
}

// A level done in under half the time of the fastest anybody else has
// done it, once 20 others have.
async function relativeChecks(env: Env, userId: string, key: string): Promise<string[]> {
  const { results } = await env.DB.prepare(
    `SELECT e.param, e.value,
       (SELECT MIN(o.value) FROM board_entries o WHERE o.board = 'levelfast' AND o.param = e.param AND NOT (o.user_id = e.user_id AND o.char_key = e.char_key)) AS best,
       (SELECT COUNT(*) FROM board_entries o WHERE o.board = 'levelfast' AND o.param = e.param) AS n
     FROM board_entries e WHERE e.user_id = ? AND e.char_key = ? AND e.board = 'levelfast'`,
  )
    .bind(userId, key)
    .all<{ param: string; value: number; best: number | null; n: number }>();
  const out: string[] = [];
  for (const r of results) {
    if (r.n < 21 || r.best === null || r.value >= r.best / 2) continue;
    out.push(`Level ${r.param} in ${Math.round(r.value / 60)} minutes of played time. The fastest anyone else has done it is ${Math.round(r.best / 60)} minutes.`);
  }
  return out;
}

// POST /api/review/:slug { action: "hide" | "clear" }
export async function reviewAction(env: Env, slug: string, body: unknown): Promise<Response> {
  const action = (body as { action?: unknown })?.action;
  if (action !== "hide" && action !== "clear") throw new HttpError(400, "Send hide or clear");
  const c = await env.DB.prepare("SELECT user_id, key, checks FROM characters WHERE slug = ?").bind(slug).first<Target & { checks: string | null }>();
  if (!c) throw new HttpError(404, "No such character");
  const time = now();
  if (action === "hide") {
    await env.DB.prepare(
      `INSERT INTO flags (user_id, char_key, status, opened_at, updated_at) VALUES (?, ?, 'hidden', ?, ?)
       ON CONFLICT (user_id, char_key) DO UPDATE SET status = 'hidden', updated_at = excluded.updated_at`,
    )
      .bind(c.user_id, c.key, time, time)
      .run();
    await rememberHide(env, c.user_id, c.key, time);
  } else {
    await forgetHide(env, c.user_id, c.key);
    // The check lines on the item now count as seen, along with any seen
    // before, so a line that goes away and comes back stays quiet.
    const had = await env.DB.prepare("SELECT seen_checks FROM flags WHERE user_id = ? AND char_key = ?").bind(c.user_id, c.key).first<{ seen_checks: string | null }>();
    const current = [...parseLines(c.checks), ...(await relativeChecks(env, c.user_id, c.key))];
    const seen = [...new Set([...parseLines(had?.seen_checks), ...current])].slice(-200);
    await env.DB.prepare(
      `INSERT INTO flags (user_id, char_key, status, opened_at, updated_at, cleared_at, seen_checks) VALUES (?, ?, 'cleared', ?, ?, ?, ?)
       ON CONFLICT (user_id, char_key) DO UPDATE SET status = 'cleared', updated_at = excluded.updated_at, cleared_at = excluded.cleared_at,
         seen_checks = excluded.seen_checks`,
    )
      .bind(c.user_id, c.key, time, time, time, seen.length ? JSON.stringify(seen) : null)
      .run();
  }
  await refreshFlag(env, c.user_id, c.key);
  // A character put back on the boards can push waiting times out of the top places.
  if (action === "clear") await releaseHeld(env);
  return json({ ok: true });
}

// POST /api/review/reporters/:id { ignore: boolean }
export async function ignoreReporter(env: Env, reporterId: string, body: unknown): Promise<Response> {
  const ignore = (body as { ignore?: unknown })?.ignore;
  if (typeof ignore !== "boolean") throw new HttpError(400, "Send ignore");
  if (ignore) await env.DB.prepare("INSERT OR IGNORE INTO ignored_reporters (reporter_id, created_at) VALUES (?, ?)").bind(reporterId, now()).run();
  else await env.DB.prepare("DELETE FROM ignored_reporters WHERE reporter_id = ?").bind(reporterId).run();
  for (const t of await reportedBy(env, reporterId)) await refreshFlag(env, t.user_id, t.key);
  return json({ ok: true });
}
