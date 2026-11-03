// Leaderboards, reports and the review page. The board numbers are worked
// out in the owner's browser (lib/boards.ts) and only sorted here. Only
// public characters with board_state 0 are ranked: 1 is held off the boards
// by 10+ reports from different accounts, 2 hidden by the reviewer.

import { BOARD_BY_ID, BOARDS_VERSION, fixedParams, type BoardEntry } from "../lib/boardDefs";
import type { CharacterSummary } from "../lib/journey";
import { isFreeParam, knownParam, NEW_PARAM_ACCOUNTS, paramLooksRight, paramsPerCharacter, valueInRange } from "../lib/checks";
import type { Env, User } from "./env";
import { HttpError, json, now } from "./http";

const ENTRIES_LIMIT = 1500;
const CHECKS_LIMIT = 20;
const PAGE = 50;
export const HOLD_REPORTS = 10;
// Only reports from established accounts count toward a hold: the account
// was at least 3 days old when it reported, and has a character with an hour
// or more played. Every report still reaches the review page.
export const ESTABLISHED_AGE = 3 * 86400;
export const ESTABLISHED_PLAYED = 3600;
const ESTABLISHED = `EXISTS (SELECT 1 FROM users ru WHERE ru.id = r.reporter_id AND ru.created_at <= r.created_at - ${ESTABLISHED_AGE})
  AND EXISTS (SELECT 1 FROM characters rc WHERE rc.user_id = r.reporter_id AND COALESCE(json_extract(rc.summary, '$.played'), 0) >= ${ESTABLISHED_PLAYED})`;
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
// after each upload (and when the numbers' version changes).
export async function saveBoards(env: Env, user: User, key: string, body: unknown): Promise<Response> {
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
  const checks = Array.isArray(b.checks) ? b.checks.filter((c): c is string => typeof c === "string").slice(0, CHECKS_LIMIT).map((c) => c.slice(0, 200)) : [];
  const row = await env.DB.prepare("SELECT 1 FROM characters WHERE user_id = ? AND key = ?").bind(user.id, key).first();
  if (!row) throw new HttpError(404, "No such character");

  const stmts = [
    env.DB.prepare("DELETE FROM board_entries WHERE user_id = ? AND char_key = ?").bind(user.id, key),
    env.DB.prepare("UPDATE characters SET checks = ?, boards_version = ? WHERE user_id = ? AND key = ?").bind(
      checks.length ? JSON.stringify(checks) : null, typeof b.version === "number" ? b.version : BOARDS_VERSION, user.id, key,
    ),
  ];
  const insert = env.DB.prepare("INSERT INTO board_entries (user_id, char_key, board, param, value, score) VALUES (?, ?, ?, ?, ?, ?)");
  for (const e of entries) stmts.push(insert.bind(user.id, key, e.b, e.p, e.v, score(e.b, e.v, e.t)));
  await env.DB.batch(stmts);
  return json({ ok: true, entries: entries.length });
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

function rowOut(r: RankRow, rank: number, viewer: User | null) {
  const s = JSON.parse(r.summary) as CharacterSummary;
  return { rank, value: r.value, name: r.name, realm: r.realm, slug: r.slug, level: s.level, className: s.className, race: s.race, mine: !!viewer && r.user_id === viewer.id };
}

// The filters a board can be narrowed by.
function filters(url: URL, viewer: User | null): { sql: string; args: unknown[] } {
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
  if (url.searchParams.get("show") === "mine") {
    parts.push("c.user_id = ?");
    args.push(viewer?.id ?? "");
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
  const f = filters(url, viewer);

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
  const out = [];
  let rank = 0;
  for (let i = 0; i < rows.length; i++) {
    if (i === 0) {
      rank = offset === 0 ? 1 : await rankOf(env, id, param, rows[0].score, f);
    } else if (rows[i].score !== rows[i - 1].score) rank = offset + i + 1;
    out.push(rowOut(rows[i], rank, viewer));
  }

  // The viewer's best character on this board, when it isn't on the page.
  let me;
  if (viewer && !out.some((r) => r.mine)) {
    const best = await env.DB.prepare(`SELECT e.value, e.score, c.name, c.realm, c.slug, c.summary, c.user_id ${from} AND c.user_id = ? ORDER BY e.score LIMIT 1`)
      .bind(id, param, ...f.args, viewer.id)
      .first<RankRow>();
    if (best) me = rowOut(best, await rankOf(env, id, param, best.score, f), viewer);
  }
  return json({ board: id, param, params, total, rows: out, me });
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

// Before an account is deleted: the characters it reported, to refresh
// once its reports are gone.
export async function reportedBy(env: Env, reporterId: string): Promise<Target[]> {
  const { results } = await env.DB.prepare("SELECT DISTINCT user_id, char_key AS key FROM reports WHERE reporter_id = ?").bind(reporterId).all<Target>();
  return results;
}

// ---------------------------------------------------------------- review

export async function reviewCount(env: Env): Promise<number> {
  const r = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM flags f WHERE f.status = 'open' AND EXISTS (
       SELECT 1 FROM reports r WHERE r.user_id = f.user_id AND r.char_key = f.char_key AND r.created_at > COALESCE(f.cleared_at, 0)
         AND r.reporter_id NOT IN (SELECT reporter_id FROM ignored_reporters))`,
  ).first<{ n: number }>();
  return r?.n ?? 0;
}

interface ReviewFlag {
  user_id: string;
  char_key: string;
  status: string;
  opened_at: number;
  updated_at: number;
  cleared_at: number | null;
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
    if (status === "open" && !counted.length) continue;
    const ranks = await ranksOf(env, f.user_id, f.char_key, 100000);
    const checks: string[] = f.checks ? JSON.parse(f.checks) : [];
    checks.push(...(await relativeChecks(env, f.user_id, f.char_key)));
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
  const c = await env.DB.prepare("SELECT user_id, key FROM characters WHERE slug = ?").bind(slug).first<Target>();
  if (!c) throw new HttpError(404, "No such character");
  const time = now();
  if (action === "hide") {
    await env.DB.prepare(
      `INSERT INTO flags (user_id, char_key, status, opened_at, updated_at) VALUES (?, ?, 'hidden', ?, ?)
       ON CONFLICT (user_id, char_key) DO UPDATE SET status = 'hidden', updated_at = excluded.updated_at`,
    )
      .bind(c.user_id, c.key, time, time)
      .run();
  } else {
    await env.DB.prepare(
      `INSERT INTO flags (user_id, char_key, status, opened_at, updated_at, cleared_at) VALUES (?, ?, 'cleared', ?, ?, ?)
       ON CONFLICT (user_id, char_key) DO UPDATE SET status = 'cleared', updated_at = excluded.updated_at, cleared_at = excluded.cleared_at`,
    )
      .bind(c.user_id, c.key, time, time, time)
      .run();
  }
  await refreshFlag(env, c.user_id, c.key);
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
