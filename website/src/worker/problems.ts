// The site's problems (lib/problems.ts): stored when they're reported, listed
// on the admin Problems page, and closed from there, which can leave a note
// for every player who hit the problem.

import { KEEP_ANONYMOUS, KEEP_DAYS, KEEP_PER_ACCOUNT, PROBLEM_STATUSES, type ProblemKind, type ProblemStatus } from "../lib/problems";
import type { Env, User } from "./env";
import { HttpError, json, now, sha256 } from "./http";

export interface NewProblem {
  kind: ProblemKind;
  key: string; // lib/problems.ts groupKey
  title: string;
  userId: string | null;
  t?: number; // when it happened, when not now (addon errors)
  detail: Record<string, unknown>;
}

// Stores one case of a problem. Returns its group's status, so a problem
// marked as noise isn't sent to the alerts again. Never throws: storing a
// report mustn't be what breaks a request.
// Past this many open problems, a new one is folded into one "too many"
// problem per kind, so a flood of made-up reports can't grow the table.
export const MAX_OPEN_GROUPS = 500;

export async function recordProblem(env: Env, p: NewProblem): Promise<ProblemStatus | undefined> {
  if (!env.DB) return undefined;
  try {
    let id = (await sha256(p.key)).slice(0, 32);
    let title = p.title;
    if (!(await env.DB.prepare("SELECT 1 FROM problem_groups WHERE id = ?").bind(id).first())) {
      const open = (await env.DB.prepare("SELECT COUNT(*) AS n FROM problem_groups WHERE status = 'open'").first<{ n: number }>())?.n ?? 0;
      if (open >= MAX_OPEN_GROUPS) {
        id = (await sha256(`overflow|${p.kind}`)).slice(0, 32);
        title = `Too many different ${p.kind} problems. Newest: ${p.title}`;
      }
    }
    const time = now();
    const t = p.t && p.t > 0 && p.t <= time + 86400 ? p.t : time;
    const cutoff = time - KEEP_DAYS * 86400;
    if (t < cutoff) return undefined;
    // An addon error comes with every upload until the addon forgets it.
    if (p.t && p.userId) {
      const had = await env.DB.prepare("SELECT 1 FROM site_problems WHERE group_id = ? AND user_id = ? AND t = ?").bind(id, p.userId, t).first();
      if (had) return undefined;
    }
    await env.DB.prepare(
      `INSERT INTO problem_groups (id, kind, title, status, first_t, last_t, count) VALUES (?, ?, ?, 'open', ?, ?, 1)
       ON CONFLICT (id) DO UPDATE SET count = count + 1, last_t = MAX(last_t, excluded.last_t), title = excluded.title,
         status = CASE WHEN status = 'fixed' AND excluded.last_t > COALESCE(fixed_at, 0) THEN 'open' ELSE status END`,
    )
      .bind(id, p.kind, title.slice(0, 300), t, t)
      .run();
    await env.DB.prepare("INSERT INTO site_problems (group_id, user_id, t, detail) VALUES (?, ?, ?, ?)")
      .bind(id, p.userId, t, JSON.stringify(p.detail).slice(0, 2000))
      .run();
    await env.DB.batch([
      env.DB.prepare("DELETE FROM site_problems WHERE t < ?").bind(cutoff),
      p.userId
        ? env.DB.prepare(
            `DELETE FROM site_problems WHERE user_id = ?1 AND id NOT IN
               (SELECT id FROM site_problems WHERE user_id = ?1 ORDER BY t DESC, id DESC LIMIT ${KEEP_PER_ACCOUNT})`,
          ).bind(p.userId)
        : env.DB.prepare(
            `DELETE FROM site_problems WHERE user_id IS NULL AND id NOT IN
               (SELECT id FROM site_problems WHERE user_id IS NULL ORDER BY id DESC LIMIT ${KEEP_ANONYMOUS})`,
          ),
      // Open groups nobody has hit in that time have no cases left, so they
      // go; fixed and hidden ones stay twice as long, for their notes.
      env.DB.prepare("DELETE FROM problem_groups WHERE status = 'open' AND last_t < ?").bind(cutoff),
      env.DB.prepare("DELETE FROM problem_groups WHERE status != 'open' AND last_t < ?").bind(time - 2 * KEEP_DAYS * 86400),
    ]);
    const g = await env.DB.prepare("SELECT status FROM problem_groups WHERE id = ?").bind(id).first<{ status: ProblemStatus }>();
    return g?.status;
  } catch (err) {
    console.log("Couldn't store a problem", String(err));
    return undefined;
  }
}

// ---------------------------------------------------------------- admin page

export interface ProblemCase {
  t: number;
  battletag: string | null;
  signedIn: boolean;
  detail: Record<string, unknown>;
}

export interface ProblemGroup {
  id: string;
  kind: string;
  title: string;
  status: ProblemStatus;
  firstT: number;
  lastT: number;
  count: number;
  players: number;
  fixedAt: number | null;
  note: string | null;
  cases: ProblemCase[];
}

// GET /api/admin/problems?status=open|fixed|hidden|all
export async function listProblems(env: Env, url: URL): Promise<Response> {
  const want = url.searchParams.get("status") ?? "open";
  const status = want === "all" ? null : PROBLEM_STATUSES.find((s) => s === want) ?? "open";
  const groups = await env.DB.prepare(
    `SELECT g.*, (SELECT COUNT(DISTINCT user_id) FROM site_problems p WHERE p.group_id = g.id) AS players
     FROM problem_groups g ${status ? "WHERE g.status = ?" : ""} ORDER BY g.last_t DESC LIMIT 100`,
  )
    .bind(...(status ? [status] : []))
    .all<{ id: string; kind: string; title: string; status: ProblemStatus; first_t: number; last_t: number; count: number; fixed_at: number | null; note: string | null; players: number }>();
  const out: ProblemGroup[] = [];
  for (const g of groups.results) {
    const cases = await env.DB.prepare(
      `SELECT p.t, p.detail, p.user_id, u.battletag FROM site_problems p LEFT JOIN users u ON u.id = p.user_id
       WHERE p.group_id = ? ORDER BY p.t DESC LIMIT 20`,
    )
      .bind(g.id)
      .all<{ t: number; detail: string; user_id: string | null; battletag: string | null }>();
    out.push({
      id: g.id,
      kind: g.kind,
      title: g.title,
      status: g.status,
      firstT: g.first_t,
      lastT: g.last_t,
      count: g.count,
      players: g.players,
      fixedAt: g.fixed_at,
      note: g.note,
      cases: cases.results.map((c) => ({ t: c.t, battletag: c.battletag, signedIn: !!c.user_id, detail: parseDetail(c.detail) })),
    });
  }
  const week = now() - 7 * 86400;
  const count = async (sql: string, ...args: unknown[]) => (await env.DB.prepare(sql).bind(...args).first<{ n: number }>())?.n ?? 0;
  const counts = {
    open: await count("SELECT COUNT(*) AS n FROM problem_groups WHERE status = 'open'"),
    fixed: await count("SELECT COUNT(*) AS n FROM problem_groups WHERE status = 'fixed'"),
    hidden: await count("SELECT COUNT(*) AS n FROM problem_groups WHERE status = 'hidden'"),
    playersWeek: await count(
      "SELECT COUNT(DISTINCT p.user_id) AS n FROM site_problems p JOIN problem_groups g ON g.id = p.group_id WHERE p.t >= ? AND g.status != 'hidden'",
      week,
    ),
    uploadersWeek: await count("SELECT COUNT(*) AS n FROM users WHERE last_upload_at >= ?", week),
    signinWeek: await count(
      "SELECT COUNT(*) AS n FROM site_problems p JOIN problem_groups g ON g.id = p.group_id WHERE g.kind = 'signin' AND p.t >= ?",
      week,
    ),
  };
  return json({ groups: out, counts });
}

function parseDetail(text: string): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(text);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// POST /api/admin/problems/<id> { action: fix | hide | reopen, note? }
// Fixing with a note leaves it for every signed-in player who hit it.
export async function problemAction(env: Env, admin: User, id: string, body: unknown): Promise<Response> {
  const b = body as { action?: unknown; note?: unknown };
  const action = b?.action;
  if (action !== "fix" && action !== "hide" && action !== "reopen") throw new HttpError(400, "Send fix, hide or reopen");
  const g = await env.DB.prepare("SELECT id, kind FROM problem_groups WHERE id = ?").bind(id).first<{ id: string; kind: string }>();
  if (!g) throw new HttpError(404, "No such problem");
  const time = now();
  const by = admin.battletag ?? admin.id;
  let notified = 0;
  if (action === "fix") {
    const note = typeof b.note === "string" ? b.note.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 500) : "";
    await env.DB.prepare("UPDATE problem_groups SET status = 'fixed', fixed_at = ?, note = ?, updated_by = ? WHERE id = ?")
      .bind(time, note || null, by, id)
      .run();
    if (note) {
      await env.DB.prepare(
        `INSERT INTO problem_notices (user_id, group_id, kind, note, hit_at, created_at)
         SELECT user_id, group_id, ?, ?, MAX(t), ? FROM site_problems WHERE group_id = ? AND user_id IS NOT NULL GROUP BY user_id
         ON CONFLICT (user_id, group_id) DO UPDATE SET note = excluded.note, hit_at = excluded.hit_at, created_at = excluded.created_at`,
      )
        .bind(g.kind, note, time, id)
        .run();
      notified =
        (await env.DB.prepare("SELECT COUNT(*) AS n FROM problem_notices WHERE group_id = ? AND created_at = ?").bind(id, time).first<{ n: number }>())?.n ?? 0;
    }
  } else {
    await env.DB.prepare("UPDATE problem_groups SET status = ?, updated_by = ? WHERE id = ?")
      .bind(action === "hide" ? "hidden" : "open", by, id)
      .run();
  }
  return json({ ok: true, notified });
}

// For the nav: problems open now.
export async function openProblemCount(env: Env): Promise<number> {
  return (await env.DB.prepare("SELECT COUNT(*) AS n FROM problem_groups WHERE status = 'open'").first<{ n: number }>())?.n ?? 0;
}

// ---------------------------------------------------------------- players

export interface ProblemNotice {
  id: string;
  kind: string;
  note: string;
  hitAt: number;
}

export async function noticesFor(env: Env, userId: string): Promise<ProblemNotice[]> {
  const rows = await env.DB.prepare("SELECT group_id, kind, note, hit_at FROM problem_notices WHERE user_id = ? ORDER BY created_at DESC LIMIT 3")
    .bind(userId)
    .all<{ group_id: string; kind: string; note: string; hit_at: number }>();
  return rows.results.map((r) => ({ id: r.group_id, kind: r.kind, note: r.note, hitAt: r.hit_at }));
}

// DELETE /api/notices/<id>
export async function dismissNotice(env: Env, user: User, id: string): Promise<Response> {
  await env.DB.prepare("DELETE FROM problem_notices WHERE user_id = ? AND group_id = ?").bind(user.id, id).run();
  return json({ ok: true });
}
