// The site's JSON API. The browser reads the saved files and builds each
// journey itself (parsing tens of MB would blow a Worker's CPU limit), then
// sends the finished journey (gzipped JSON, stored in R2 untouched) and a
// small summary (checked and kept in D1). Raw saved files are never sent:
// they hold other players' names.

import type { CharacterSummary } from "../lib/journey";
import { requireUser } from "./auth";
import type { Env, User } from "./env";
import { HttpError, json, now, readBody, sha256 } from "./http";

const JOURNEY_LIMIT = 60e6;
const IMAGE_LIMIT = 25e6;
const THUMB_LIMIT = 2e6;
const SUMMARY_LIMIT = 32e3;
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
}

interface ShotRow {
  id: string;
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
  };
}

function shotOut(r: ShotRow) {
  return {
    id: r.id, t: r.t, kind: r.kind, label: r.label, file: r.file, width: r.width, height: r.height,
    url: `/media/${r.id}`, thumb: `/media/${r.id}/thumb`,
  };
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

async function listShots(env: Env, userId: string, key: string) {
  const { results } = await env.DB.prepare(
    "SELECT id, char_key, t, kind, label, file, width, height FROM screenshots WHERE user_id = ? AND char_key = ? ORDER BY t",
  )
    .bind(userId, key)
    .all<ShotRow>();
  return results.map(shotOut);
}

export async function handleApi(req: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname.replace(/^\/api/, "");
  const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
  const m = req.method;

  // Public journeys need no sign-in.
  if (parts[0] === "public" && parts[1] && m === "GET") {
    const row = await env.DB.prepare("SELECT * FROM characters WHERE slug = ? AND is_public = 1").bind(parts[1]).first<
      CharacterRow & { user_id: string }
    >();
    if (!row) throw new HttpError(404, "This journey is private or doesn't exist");
    if (parts[2] === "journey") return serveJourney(env, row.user_id, row.key, "public, max-age=60");
    return json({ character: characterOut(row), screenshots: await listShots(env, row.user_id, row.key) });
  }

  const user = await requireUser(req, env);

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
        // The summary, sent after the journey itself.
        const summary = checkSummary(new TextDecoder().decode(await readBody(req, SUMMARY_LIMIT)), key);
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
        const body = (await req.json()) as { isPublic?: unknown };
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
          env.DB.prepare("DELETE FROM characters WHERE user_id = ? AND key = ?").bind(user.id, key),
        ]);
        return json({ ok: true });
      }
    }

    if (parts[2] === "journey" && parts.length === 3) {
      if (m === "GET") return serveJourney(env, user.id, key, "private, no-store");
      if (m === "PUT") {
        if (req.headers.get("content-encoding") !== "gzip" && req.headers.get("x-content-encoding") !== "gzip") {
          throw new HttpError(415, "Send the journey gzipped");
        }
        const body = await readBody(req, JOURNEY_LIMIT);
        await env.FILES.put(await journeyObject(user.id, key), body, {
          httpMetadata: { contentType: "application/json", contentEncoding: "gzip" },
        });
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
        await env.FILES.put(shotObject(user.id, id, false), body, { httpMetadata: { contentType: type } });
        const text = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : null);
        const int = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);
        await env.DB.prepare(
          `INSERT INTO screenshots (user_id, id, char_key, t, kind, label, file, width, height, size, content_type, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (user_id, id) DO UPDATE SET char_key = excluded.char_key, t = excluded.t, kind = excluded.kind, label = excluded.label`,
        )
          .bind(user.id, id, key, Math.round(meta.t), meta.kind.slice(0, 24), text(meta.label, 200), text(meta.file, 120),
            int(meta.width), int(meta.height), body.byteLength, type, now())
          .run();
        return json({ ok: true });
      }
      if (parts.length === 5 && parts[4] === "thumb" && m === "PUT") {
        const type = req.headers.get("content-type") ?? "";
        if (!IMAGE_TYPES.has(type)) throw new HttpError(415, "Thumbnails must be JPEG, PNG or WebP");
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
  const [, , id, thumb] = url.pathname.split("/");
  if (!id || !/^[0-9a-f]{16,64}$/.test(id)) throw new HttpError(404, "Not found");
  const user = await userOf(req);
  const row = await env.DB.prepare(
    `SELECT s.user_id, c.is_public FROM screenshots s JOIN characters c ON c.user_id = s.user_id AND c.key = s.char_key
     WHERE s.id = ? AND (c.is_public = 1 OR s.user_id = ?) LIMIT 1`,
  )
    .bind(id, user?.id ?? "")
    .first<{ user_id: string; is_public: number }>();
  if (!row) throw new HttpError(404, "Not found");
  let obj = await env.FILES.get(shotObject(row.user_id, id, thumb === "thumb"));
  if (!obj && thumb === "thumb") obj = await env.FILES.get(shotObject(row.user_id, id, false));
  if (!obj) throw new HttpError(404, "Not found");
  return new Response(obj.body, {
    headers: {
      "content-type": obj.httpMetadata?.contentType ?? "image/jpeg",
      "cache-control": row.is_public ? "public, max-age=86400" : "private, max-age=3600",
    },
  });
}
