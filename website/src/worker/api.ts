// The site's JSON API. The browser reads the saved files and builds each
// journey itself (parsing tens of MB would blow a Worker's CPU limit), then
// sends the finished journey (gzipped JSON, stored in R2 untouched) and a
// small summary (checked and kept in D1). Raw saved files are never sent:
// they hold other players' names.

import { searchPattern } from "../lib/search";
import type { CharacterSummary } from "../lib/journey";
import { clearSessionCookie, currentUser, requireUser } from "./auth";
import { forgetFriends, friendsOf, saveFriends, setFriendsVisible } from "./friends";
import { board, boardsMeta, ignoreReporter, isAdmin, myReport, publicRanks, ranksOf, refreshFlag, report, reportedBy, reviewAction, reviewList, saveBoards } from "./boards";
import type { Env, User } from "./env";
import { summaryProblem } from "../lib/checks";
import { HttpError, json, now, readBody, sha256 } from "./http";

const JOURNEY_LIMIT = 30e6;
const IMAGE_LIMIT = 25e6;
const THUMB_LIMIT = 2e6;
const SUMMARY_LIMIT = 32e3;
// What one account can keep. A full account (every character to 60, with
// screenshots) is far under these; they're here so one account can't fill
// the bucket.
export const MAX_CHARACTERS = 50;
export const MAX_SCREENSHOTS = 2000;
export const MAX_ACCOUNT_BYTES = 2e9;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

interface CharacterRow {
  key: string;
  name: string;
  realm: string;
  summary: string;
  is_public: number;
  slug: string | null;
  journey_size: number | null;
  updated_at: number;
  board_state?: number;
  boards_version?: number | null;
}

interface ShotRow {
  id: string;
  pid: string | null;
  char_key: string;
  t: number;
  kind: string;
  label: string | null;
  file: string | null;
  width: number | null;
  height: number | null;
}

function characterOut(r: CharacterRow) {
  return {
    key: r.key,
    summary: JSON.parse(r.summary) as CharacterSummary,
    isPublic: !!r.is_public,
    slug: r.slug,
    updatedAt: r.updated_at,
    hasJourney: !!r.journey_size,
    boardState: r.board_state ?? 0,
    boardsVersion: r.boards_version ?? null,
  };
}

function shotOut(r: ShotRow & { pid: string }) {
  return {
    id: r.id, t: r.t, kind: r.kind, label: r.label, file: r.file, width: r.width, height: r.height,
    url: `/media/${r.pid}`, thumb: `/media/${r.pid}/thumb`,
  };
}

// A screenshot's public ID, in its /media link. The browser names a shot by
// the hash of its bytes, so two accounts can send the same ID; this one is
// unique to the account, so nobody can put their image under someone else's link.
export async function shotPublicId(userId: string, id: string): Promise<string> {
  return (await sha256(`${userId}:${id}`)).slice(0, 32);
}

// Bytes an account keeps: journeys and screenshots (thumbnails are small and
// capped per screenshot).
async function accountBytes(env: Env, userId: string): Promise<number> {
  const r = await env.DB.prepare(
    `SELECT (SELECT COALESCE(SUM(journey_size), 0) FROM characters WHERE user_id = ?1)
          + (SELECT COALESCE(SUM(size), 0) FROM screenshots WHERE user_id = ?1) AS bytes`,
  )
    .bind(userId)
    .first<{ bytes: number }>();
  return r?.bytes ?? 0;
}

function checkRoom(used: number, replacing: number, adding: number): void {
  if (used - replacing + adding > MAX_ACCOUNT_BYTES) {
    throw new HttpError(413, `Your account is full (${Math.round(MAX_ACCOUNT_BYTES / 1e9)} GB). Delete some screenshots or characters first.`);
  }
}

async function journeyObject(userId: string, key: string): Promise<string> {
  return `journeys/${userId}/${(await sha256(key)).slice(0, 40)}.json.gz`;
}

function shotObject(userId: string, id: string, thumb: boolean): string {
  return `shots/${userId}/${id}${thumb ? ".thumb" : ""}`;
}

function checkKey(key: string): string {
  if (!key || key.length > 128 || /[\u0000-\u001f]/.test(key)) throw new HttpError(400, "Bad character key");
  return key;
}

function checkSummary(text: string, key: string): CharacterSummary {
  if (text.length > SUMMARY_LIMIT) throw new HttpError(413, "Summary too large");
  let s: CharacterSummary;
  try {
    s = JSON.parse(text);
  } catch {
    throw new HttpError(400, "Summary isn't JSON");
  }
  const short = (v: unknown, n = 64) => typeof v === "string" && v.length > 0 && v.length <= n;
  if (!s || s.key !== key || !short(s.name) || !short(s.realm) || typeof s.level !== "number") {
    throw new HttpError(400, "Summary is missing its character");
  }
  const problem = summaryProblem(s);
  if (problem) throw new HttpError(400, problem);
  return s;
}

function slugify(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

async function freeSlug(env: Env, name: string, realm: string): Promise<string> {
  const base = slugify(name) || "journey";
  const candidates = [base, `${base}-${slugify(realm)}`];
  for (let i = 2; i < 6; i++) candidates.push(`${base}-${slugify(realm)}-${i}`);
  for (const c of candidates) {
    const taken = await env.DB.prepare("SELECT 1 FROM characters WHERE slug = ?").bind(c).first();
    if (!taken) return c;
  }
  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}

async function ownCharacter(env: Env, user: User, key: string): Promise<CharacterRow> {
  const row = await env.DB.prepare("SELECT * FROM characters WHERE user_id = ? AND key = ?").bind(user.id, key).first<CharacterRow>();
  if (!row) throw new HttpError(404, "No such character");
  return row;
}

// A stored journey, served as the gzipped JSON it was uploaded as.
async function serveJourney(env: Env, userId: string, key: string, cache: string): Promise<Response> {
  const obj = await env.FILES.get(await journeyObject(userId, key));
  if (!obj) throw new HttpError(404, "No journey uploaded yet");
  return new Response(obj.body, {
    headers: { "content-type": "application/json", "content-encoding": "gzip", "cache-control": cache },
    encodeBody: "manual",
  });
}

// Every R2 object under a prefix, in pages of up to 1000 (one delete call each).
async function deletePrefix(env: Env, prefix: string): Promise<number> {
  let count = 0;
  let cursor: string | undefined;
  do {
    const page = await env.FILES.list({ prefix, cursor });
    if (page.objects.length) await env.FILES.delete(page.objects.map((o) => o.key));
    count += page.objects.length;
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return count;
}

// What the account page shows, and what deleting the account removes.
async function accountSummary(env: Env, user: User) {
  const [account, chars, shots] = await env.DB.batch([
    env.DB.prepare("SELECT created_at FROM users WHERE id = ?").bind(user.id),
    env.DB.prepare("SELECT name, slug, is_public FROM characters WHERE user_id = ? ORDER BY updated_at DESC").bind(user.id),
    env.DB.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS bytes FROM screenshots WHERE user_id = ?").bind(user.id),
  ]);
  const created = (account.results[0] as { created_at: number } | undefined)?.created_at ?? null;
  const rows = chars.results as { name: string; slug: string | null; is_public: number }[];
  const s = shots.results[0] as { n: number; bytes: number };
  return {
    battletag: user.battletag,
    createdAt: created,
    lastUploadAt: user.last_upload_at,
    characters: rows.map((r) => r.name),
    publicLinks: rows.filter((r) => r.is_public && r.slug).map((r) => r.slug!),
    screenshots: s.n,
    screenshotBytes: s.bytes,
  };
}

// Public characters whose name starts with q (any realm), for the compare
// picker. Only what the picker shows goes out: never the owner or the key.
async function searchPublic(env: Env, q: string) {
  const pattern = searchPattern(q);
  if (!pattern) return [];
  const { results } = await env.DB.prepare(
    "SELECT name, realm, slug, summary FROM characters WHERE is_public = 1 AND slug IS NOT NULL AND name LIKE ? ESCAPE '\\' ORDER BY name COLLATE NOCASE, realm LIMIT 10",
  )
    .bind(pattern)
    .all<{ name: string; realm: string; slug: string; summary: string }>();
  return results.map((r) => {
    const s = JSON.parse(r.summary) as CharacterSummary;
    return { name: r.name, realm: r.realm, slug: r.slug, level: s.level, className: s.className, race: s.race };
  });
}

async function listShots(env: Env, userId: string, key: string) {
  const { results } = await env.DB.prepare(
    "SELECT id, pid, char_key, t, kind, label, file, width, height FROM screenshots WHERE user_id = ? AND char_key = ? ORDER BY t",
  )
    .bind(userId, key)
    .all<ShotRow>();
  // Shots uploaded before public IDs existed get theirs the first time they're listed.
  const missing = results.filter((r) => !r.pid);
  if (missing.length) {
    const update = env.DB.prepare("UPDATE screenshots SET pid = ? WHERE user_id = ? AND id = ?");
    const stmts = [];
    for (const r of missing) {
      r.pid = await shotPublicId(userId, r.id);
      stmts.push(update.bind(r.pid, userId, r.id));
    }
    await env.DB.batch(stmts);
  }
  return results.map((r) => shotOut(r as ShotRow & { pid: string }));
}

export async function handleApi(req: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname.replace(/^\/api/, "");
  const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
  const m = req.method;

  // Public journeys need no sign-in. "Public" means anyone can find a
  // character by name here, and open its journey.
  if (parts[0] === "public" && parts.length === 1 && m === "GET") return json({ results: await searchPublic(env, url.searchParams.get("q") ?? "") });
  // Leaderboards are public too; signed in, your own characters are marked.
  if (parts[0] === "boards" && m === "GET") {
    if (parts.length === 1) return boardsMeta(env);
    if (parts.length === 2) return board(env, url, parts[1], await currentUser(req, env));
  }
  if (parts[0] === "public" && parts[1] && parts[2] === "ranks" && m === "GET") return publicRanks(env, parts[1]);
  if (parts[0] === "public" && parts[1] && parts[2] === "report") {
    const reporter = await requireUser(req, env);
    if (m === "GET") return myReport(env, reporter, parts[1]);
    if (m === "POST") return report(env, reporter, parts[1], await req.json().catch(() => null));
  }
  if (parts[0] === "public" && parts[1] && m === "GET") {
    const row = await env.DB.prepare("SELECT * FROM characters WHERE slug = ? AND is_public = 1").bind(parts[1]).first<
      CharacterRow & { user_id: string }
    >();
    if (!row) throw new HttpError(404, "This journey is private or doesn't exist");
    if (parts[2] === "journey") return serveJourney(env, row.user_id, row.key, "public, max-age=60");
    return json({ character: characterOut(row), screenshots: await listShots(env, row.user_id, row.key) });
  }

  const user = await requireUser(req, env);

  // The review page: only for the accounts in ADMIN_BNET_IDS. Anyone else
  // gets the same "Not found" as a page that doesn't exist.
  if (parts[0] === "review") {
    if (!isAdmin(env, user)) throw new HttpError(404, "Not found");
    if (parts.length === 1 && m === "GET") return reviewList(env, url);
    if (parts.length === 3 && parts[1] === "reporters" && m === "POST") return ignoreReporter(env, parts[2], await req.json().catch(() => null));
    if (parts.length === 2 && m === "POST") return reviewAction(env, parts[1], await req.json().catch(() => null));
    throw new HttpError(404, "Not found");
  }

  if (parts[0] === "friends" && parts.length === 1) {
    if (m === "GET") return friendsOf(env, user);
    if (m === "PUT") return saveFriends(env, user, await req.json().catch(() => null));
    if (m === "PATCH") return setFriendsVisible(env, user, await req.json().catch(() => null));
    if (m === "DELETE") return forgetFriends(env, user);
  }

  if (parts[0] === "account" && parts.length === 1) {
    if (m === "GET") return json(await accountSummary(env, user));
    if (m === "DELETE") {
      // The page asks for the BattleTag to be typed; checking it here too
      // means a stray request can't wipe an account.
      const body = (await req.json().catch(() => ({}))) as { confirm?: unknown };
      if (body.confirm !== (user.battletag ?? "DELETE")) throw new HttpError(400, "Type your BattleTag to confirm");
      // Files first, rows last: if this stops halfway the account still
      // exists and can be deleted again. Only this user's own prefixes;
      // shared map tiles live under maps/.
      await deletePrefix(env, `journeys/${user.id}/`);
      await deletePrefix(env, `shots/${user.id}/`);
      const reported = await reportedBy(env, user.id);
      await env.DB.batch([
        env.DB.prepare("DELETE FROM board_entries WHERE user_id = ?").bind(user.id),
        env.DB.prepare("DELETE FROM reports WHERE reporter_id = ? OR user_id = ?").bind(user.id, user.id),
        env.DB.prepare("DELETE FROM flags WHERE user_id = ?").bind(user.id),
        env.DB.prepare("DELETE FROM ignored_reporters WHERE reporter_id = ?").bind(user.id),
        env.DB.prepare("DELETE FROM friend_tags WHERE user_id = ?").bind(user.id),
        env.DB.prepare("DELETE FROM screenshots WHERE user_id = ?").bind(user.id),
        env.DB.prepare("DELETE FROM characters WHERE user_id = ?").bind(user.id),
        env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.id),
        env.DB.prepare("DELETE FROM users WHERE id = ?").bind(user.id),
      ]);
      // Characters this account reported may no longer have enough reports.
      for (const t of reported) if (t.user_id !== user.id) await refreshFlag(env, t.user_id, t.key);
      return json({ ok: true }, { headers: { "set-cookie": clearSessionCookie(url) } });
    }
  }

  if (parts[0] === "characters") {
    if (parts.length === 1 && m === "GET") {
      const { results } = await env.DB.prepare("SELECT * FROM characters WHERE user_id = ? ORDER BY updated_at DESC")
        .bind(user.id)
        .all<CharacterRow>();
      return json({ characters: results.map(characterOut), lastUploadAt: user.last_upload_at });
    }
    const key = checkKey(parts[1] ?? "");

    if (parts.length === 2) {
      if (m === "GET") return json(characterOut(await ownCharacter(env, user, key)));
      if (m === "PUT") {
        // The summary, sent before the journey itself (which needs the row).
        const summary = checkSummary(new TextDecoder().decode(await readBody(req, SUMMARY_LIMIT)), key);
        const exists = await env.DB.prepare("SELECT 1 FROM characters WHERE user_id = ? AND key = ?").bind(user.id, key).first();
        if (!exists) {
          const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM characters WHERE user_id = ?").bind(user.id).first<{ n: number }>();
          if ((n?.n ?? 0) >= MAX_CHARACTERS) throw new HttpError(413, `You can keep up to ${MAX_CHARACTERS} characters. Delete one first.`);
        }
        const head = await env.FILES.head(await journeyObject(user.id, key));
        const t = now();
        await env.DB.batch([
          env.DB.prepare(
            `INSERT INTO characters (user_id, key, name, realm, summary, journey_size, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (user_id, key) DO UPDATE SET name = excluded.name, realm = excluded.realm,
               summary = excluded.summary, journey_size = excluded.journey_size, updated_at = excluded.updated_at`,
          ).bind(user.id, key, summary.name, summary.realm, JSON.stringify(summary), head?.size ?? null, t),
          env.DB.prepare("UPDATE users SET last_upload_at = ? WHERE id = ?").bind(t, user.id),
        ]);
        return json(characterOut(await ownCharacter(env, user, key)));
      }
      if (m === "PATCH") {
        const row = await ownCharacter(env, user, key);
        const body = (await req.json().catch(() => ({}))) as { isPublic?: unknown };
        if (typeof body.isPublic !== "boolean") throw new HttpError(400, "Send isPublic");
        const slug = row.slug ?? (body.isPublic ? await freeSlug(env, row.name, row.realm) : null);
        await env.DB.prepare("UPDATE characters SET is_public = ?, slug = ? WHERE user_id = ? AND key = ?")
          .bind(body.isPublic ? 1 : 0, slug, user.id, key)
          .run();
        return json(characterOut(await ownCharacter(env, user, key)));
      }
      if (m === "DELETE") {
        await ownCharacter(env, user, key);
        const { results } = await env.DB.prepare("SELECT id FROM screenshots WHERE user_id = ? AND char_key = ?")
          .bind(user.id, key)
          .all<{ id: string }>();
        const objects = [await journeyObject(user.id, key), ...results.flatMap((r) => [shotObject(user.id, r.id, false), shotObject(user.id, r.id, true)])];
        for (let i = 0; i < objects.length; i += 1000) await env.FILES.delete(objects.slice(i, i + 1000));
        await env.DB.batch([
          env.DB.prepare("DELETE FROM screenshots WHERE user_id = ? AND char_key = ?").bind(user.id, key),
          env.DB.prepare("DELETE FROM board_entries WHERE user_id = ? AND char_key = ?").bind(user.id, key),
          env.DB.prepare("DELETE FROM reports WHERE user_id = ? AND char_key = ?").bind(user.id, key),
          env.DB.prepare("DELETE FROM flags WHERE user_id = ? AND char_key = ?").bind(user.id, key),
          env.DB.prepare("DELETE FROM characters WHERE user_id = ? AND key = ?").bind(user.id, key),
        ]);
        return json({ ok: true });
      }
    }

    if (parts[2] === "boards" && parts.length === 3 && m === "PUT") {
      const text = new TextDecoder().decode(await readBody(req, 256e3));
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        throw new HttpError(400, "Boards aren't JSON");
      }
      return saveBoards(env, user, key, body);
    }
    if (parts[2] === "ranks" && parts.length === 3 && m === "GET") {
      const row = await ownCharacter(env, user, key);
      const listed = row.is_public && row.slug && !row.board_state;
      return json({ ranks: listed ? await ranksOf(env, user.id, key) : [] });
    }

    if (parts[2] === "journey" && parts.length === 3) {
      if (m === "GET") return serveJourney(env, user.id, key, "private, no-store");
      if (m === "PUT") {
        if (req.headers.get("content-encoding") !== "gzip" && req.headers.get("x-content-encoding") !== "gzip") {
          throw new HttpError(415, "Send the journey gzipped");
        }
        const row = await ownCharacter(env, user, key);
        const body = await readBody(req, JOURNEY_LIMIT);
        checkRoom(await accountBytes(env, user.id), row.journey_size ?? 0, body.byteLength);
        await env.FILES.put(await journeyObject(user.id, key), body, {
          httpMetadata: { contentType: "application/json", contentEncoding: "gzip" },
        });
        await env.DB.prepare("UPDATE characters SET journey_size = ? WHERE user_id = ? AND key = ?").bind(body.byteLength, user.id, key).run();
        return json({ ok: true, size: body.byteLength });
      }
    }

    if (parts[2] === "screenshots") {
      if (parts.length === 3 && m === "GET") return json({ screenshots: await listShots(env, user.id, key) });
      const id = parts[3] ?? "";
      if (!/^[0-9a-f]{16,64}$/.test(id)) throw new HttpError(400, "Bad screenshot id");
      if (parts.length === 4 && m === "PUT") {
        // The image; its details come in x-shot as JSON.
        const type = req.headers.get("content-type") ?? "";
        if (!IMAGE_TYPES.has(type)) throw new HttpError(415, "Screenshots must be JPEG, PNG or WebP");
        let meta: { t?: unknown; kind?: unknown; label?: unknown; file?: unknown; width?: unknown; height?: unknown };
        try {
          meta = JSON.parse(req.headers.get("x-shot") ?? "{}");
        } catch {
          throw new HttpError(400, "Bad x-shot header");
        }
        if (typeof meta.t !== "number" || typeof meta.kind !== "string") throw new HttpError(400, "x-shot needs t and kind");
        await ownCharacter(env, user, key);
        const body = await readBody(req, IMAGE_LIMIT);
        const old = await env.DB.prepare("SELECT size FROM screenshots WHERE user_id = ? AND id = ?").bind(user.id, id).first<{ size: number | null }>();
        if (!old) {
          const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM screenshots WHERE user_id = ?").bind(user.id).first<{ n: number }>();
          if ((n?.n ?? 0) >= MAX_SCREENSHOTS) throw new HttpError(413, `You can keep up to ${MAX_SCREENSHOTS} screenshots. Delete some first.`);
        }
        checkRoom(await accountBytes(env, user.id), old?.size ?? 0, body.byteLength);
        await env.FILES.put(shotObject(user.id, id, false), body, { httpMetadata: { contentType: type } });
        const text = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : null);
        const int = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);
        await env.DB.prepare(
          `INSERT INTO screenshots (user_id, id, char_key, t, kind, label, file, width, height, size, content_type, created_at, pid)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (user_id, id) DO UPDATE SET char_key = excluded.char_key, t = excluded.t, kind = excluded.kind, label = excluded.label,
             size = excluded.size, content_type = excluded.content_type, pid = excluded.pid`,
        )
          .bind(user.id, id, key, Math.round(meta.t), meta.kind.slice(0, 24), text(meta.label, 200), text(meta.file, 120),
            int(meta.width), int(meta.height), body.byteLength, type, now(), await shotPublicId(user.id, id))
          .run();
        return json({ ok: true });
      }
      if (parts.length === 5 && parts[4] === "thumb" && m === "PUT") {
        const type = req.headers.get("content-type") ?? "";
        if (!IMAGE_TYPES.has(type)) throw new HttpError(415, "Thumbnails must be JPEG, PNG or WebP");
        // Only for a screenshot that's already stored (sent just before it).
        const shot = await env.DB.prepare("SELECT 1 FROM screenshots WHERE user_id = ? AND id = ? AND char_key = ?").bind(user.id, id, key).first();
        if (!shot) throw new HttpError(404, "Send the screenshot before its thumbnail");
        const body = await readBody(req, THUMB_LIMIT);
        await env.FILES.put(shotObject(user.id, id, true), body, { httpMetadata: { contentType: type } });
        return json({ ok: true });
      }
      if (parts.length === 4 && m === "DELETE") {
        await env.FILES.delete([shotObject(user.id, id, false), shotObject(user.id, id, true)]);
        await env.DB.prepare("DELETE FROM screenshots WHERE user_id = ? AND id = ?").bind(user.id, id).run();
        return json({ ok: true });
      }
    }
  }

  throw new HttpError(404, "Not found");
}

// /media/<id> and /media/<id>/thumb: a screenshot, for its owner or anyone
// when its character's journey is public.
export async function handleMedia(req: Request, env: Env, url: URL, userOf: (r: Request) => Promise<User | null>): Promise<Response> {
  const [, , pid, thumb] = url.pathname.split("/");
  if (!pid || !/^[0-9a-f]{32}$/.test(pid)) throw new HttpError(404, "Not found");
  const user = await userOf(req);
  const row = await env.DB.prepare(
    `SELECT s.user_id, s.id, c.is_public FROM screenshots s JOIN characters c ON c.user_id = s.user_id AND c.key = s.char_key
     WHERE s.pid = ? AND (c.is_public = 1 OR s.user_id = ?)`,
  )
    .bind(pid, user?.id ?? "")
    .first<{ user_id: string; id: string; is_public: number }>();
  if (!row) throw new HttpError(404, "Not found");
  let obj = await env.FILES.get(shotObject(row.user_id, row.id, thumb === "thumb"));
  if (!obj && thumb === "thumb") obj = await env.FILES.get(shotObject(row.user_id, row.id, false));
  if (!obj) throw new HttpError(404, "Not found");
  return new Response(obj.body, {
    headers: {
      "content-type": obj.httpMetadata?.contentType ?? "image/jpeg",
      // Short for private shots, so making a character private takes effect soon.
      "cache-control": row.is_public ? "public, max-age=3600" : "private, max-age=300",
    },
  });
}
