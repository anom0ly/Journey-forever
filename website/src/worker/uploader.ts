// The Windows auto-uploader (uploader/ in the repo): connecting a PC, its
// upload key, the Account page's list of PCs and switches, and the status
// each PC reports after an upload. Admin only for now: everyone else gets
// "Not found", as for the review page.
//
// Connecting: the uploader makes a secret, puts its SHA-256 (the challenge)
// in the /connect link and opens it. Allow (POST /api/uploader/connect)
// makes a one-time code for that challenge; the page hands the code to the
// uploader at http://127.0.0.1:<port>/connected, and the uploader swaps code
// plus secret for a key (POST /api/uploader/claim). A code sent anywhere
// else is useless without the secret, and the key never shows in a URL.

import { UPLOADER_SETTINGS_DEFAULT, type UploaderSettings } from "../lib/uploader";
import { isAdmin } from "./boards";
import type { Env, User } from "./env";
import { HttpError, json, now, randomToken, sha256 } from "./http";

const CODE_SECONDS = 600;
const MAX_PCS = 10;
const KEY_PREFIX = "jfu_";

// What a key may do: read its own characters and upload. Nothing that
// deletes, changes privacy, or reads account details.
const UPLOADER_ROUTES: [string, RegExp][] = [
  ["GET", /^\/api\/characters$/],
  ["GET", /^\/api\/characters\/[^/]+\/(journey|screenshots)$/],
  ["PUT", /^\/api\/characters\/[^/]+$/],
  ["PUT", /^\/api\/characters\/[^/]+\/(journey|boards)$/],
  ["PUT", /^\/api\/characters\/[^/]+\/screenshots\/[0-9a-f]+(\/thumb)?$/],
  ["PUT", /^\/api\/friends$/],
  ["GET", /^\/api\/uploader\/settings$/],
  ["POST", /^\/api\/uploader\/status$/],
  ["DELETE", /^\/api\/uploader\/self$/],
];

export function keyAllows(method: string, path: string): boolean {
  return UPLOADER_ROUTES.some(([m, re]) => m === method && re.test(path));
}

export function bearerKey(req: Request): string | undefined {
  const h = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(\S+)$/i.exec(h);
  return m && m[1].startsWith(KEY_PREFIX) ? m[1] : undefined;
}

// The account behind an upload key, and which PC it is.
export async function keyUser(env: Env, key: string): Promise<(User & { key_id: string }) | null> {
  const row = await env.DB.prepare(
    `SELECT u.id, u.bnet_id, u.battletag, u.last_upload_at, k.id AS key_id FROM upload_keys k JOIN users u ON u.id = k.user_id
     WHERE k.key_hash = ?`,
  )
    .bind(await sha256(key))
    .first<User & { key_id: string }>();
  return row ?? null;
}

function settingsOf(text: string | null | undefined): UploaderSettings {
  let s: Partial<UploaderSettings> = {};
  try {
    s = text ? (JSON.parse(text) as Partial<UploaderSettings>) : {};
  } catch {
    // keep the defaults
  }
  const out = { ...UPLOADER_SETTINGS_DEFAULT };
  for (const k of Object.keys(out) as (keyof UploaderSettings)[]) if (typeof s[k] === "boolean") out[k] = s[k] as boolean;
  return out;
}

async function settings(env: Env, user: User): Promise<UploaderSettings> {
  const row = await env.DB.prepare("SELECT uploader_settings FROM users WHERE id = ?").bind(user.id).first<{ uploader_settings: string | null }>();
  return settingsOf(row?.uploader_settings);
}

interface KeyRow {
  id: string;
  name: string;
  created_at: number;
  last_seen_at: number | null;
  last_upload_at: number | null;
  last_ok: number | null;
  last_message: string | null;
  app_version: string | null;
  addon_version: string | null;
}

async function pcs(env: Env, user: User) {
  const { results } = await env.DB.prepare(
    `SELECT id, name, created_at, last_seen_at, last_upload_at, last_ok, last_message, app_version, addon_version
     FROM upload_keys WHERE user_id = ? ORDER BY created_at`,
  )
    .bind(user.id)
    .all<KeyRow>();
  return results.map((r) => ({
    id: r.id,
    name: r.name,
    createdAt: r.created_at,
    lastSeenAt: r.last_seen_at,
    lastUploadAt: r.last_upload_at,
    ok: r.last_ok === null ? null : !!r.last_ok,
    message: r.last_message,
    appVersion: r.app_version,
    addonVersion: r.addon_version,
  }));
}

const text = (v: unknown, n: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);

function pcName(v: unknown): string {
  // Windows names: letters, digits, hyphens; keep it plain whatever comes.
  const name = (typeof v === "string" ? v : "").replace(/[^\w .-]/g, "").trim().slice(0, 40);
  return name || "This PC";
}

// /api/uploader/claim: no sign-in, the code and secret are the proof.
export async function claimKey(env: Env, body: unknown): Promise<Response> {
  const b = (body ?? {}) as { code?: unknown; verifier?: unknown };
  if (typeof b.code !== "string" || typeof b.verifier !== "string" || b.code.length > 100 || b.verifier.length > 200) {
    throw new HttpError(400, "Send code and verifier");
  }
  const id = await sha256(b.code);
  const row = await env.DB.prepare("SELECT user_id, name, challenge, expires_at FROM upload_codes WHERE id = ?").bind(id).first<{
    user_id: string;
    name: string;
    challenge: string;
    expires_at: number;
  }>();
  // One try per code, right or wrong.
  await env.DB.prepare("DELETE FROM upload_codes WHERE id = ? OR expires_at <= ?").bind(id, now()).run();
  if (!row || row.expires_at <= now() || (await sha256(b.verifier)) !== row.challenge) {
    throw new HttpError(400, "That connect link has expired. Start the uploader again to get a new one.");
  }
  const user = await env.DB.prepare("SELECT id, bnet_id, battletag, last_upload_at FROM users WHERE id = ?").bind(row.user_id).first<User>();
  if (!user || !isAdmin(env, user)) throw new HttpError(404, "Not found");
  const key = KEY_PREFIX + randomToken(32);
  await env.DB.prepare("INSERT INTO upload_keys (id, key_hash, user_id, name, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), await sha256(key), user.id, row.name, now())
    .run();
  return json({ key, battletag: user.battletag });
}

// Everything else under /api/uploader. keyId is set when the request came
// with an upload key (the uploader), and unset for the signed-in site.
export async function handleUploader(req: Request, env: Env, user: User, keyId: string | undefined, parts: string[]): Promise<Response> {
  if (!isAdmin(env, user)) throw new HttpError(404, "Not found");
  const m = req.method;
  const body = async () => (m === "GET" || m === "DELETE" ? null : await req.json().catch(() => null));

  if (parts.length === 2 && parts[1] === "settings") {
    if (m === "GET") return json(await settings(env, user));
    if (m === "PATCH" && !keyId) {
      const next = { ...(await settings(env, user)) };
      const b = ((await body()) ?? {}) as Partial<Record<keyof UploaderSettings, unknown>>;
      for (const k of Object.keys(next) as (keyof UploaderSettings)[]) if (typeof b[k] === "boolean") next[k] = b[k] as boolean;
      await env.DB.prepare("UPDATE users SET uploader_settings = ? WHERE id = ?").bind(JSON.stringify(next), user.id).run();
      return json(next);
    }
  }

  // The uploader saying how its last try went.
  if (parts.length === 2 && parts[1] === "status" && m === "POST" && keyId) {
    const b = ((await body()) ?? {}) as { ok?: unknown; message?: unknown; uploaded?: unknown; appVersion?: unknown; addonVersion?: unknown };
    const t = now();
    await env.DB.prepare(
      `UPDATE upload_keys SET last_seen_at = ?, last_ok = ?, last_message = ?, app_version = ?, addon_version = ?,
         last_upload_at = CASE WHEN ? THEN ? ELSE last_upload_at END WHERE id = ?`,
    )
      .bind(t, b.ok === false ? 0 : 1, text(b.message, 200), text(b.appVersion, 20), text(b.addonVersion, 20), b.uploaded === true ? 1 : 0, t, keyId)
      .run();
    return json({ ok: true });
  }

  // "Remove from this PC" in the uploader: its key goes too.
  if (parts.length === 2 && parts[1] === "self" && m === "DELETE" && keyId) {
    await env.DB.prepare("DELETE FROM upload_keys WHERE id = ? AND user_id = ?").bind(keyId, user.id).run();
    return json({ ok: true });
  }

  if (keyId) throw new HttpError(403, "The uploader can't do that");

  // The Account page.
  if (parts.length === 1 && m === "GET") return json({ pcs: await pcs(env, user), settings: await settings(env, user) });

  // Allow, on the /connect page.
  if (parts.length === 2 && parts[1] === "connect" && m === "POST") {
    const b = ((await body()) ?? {}) as { name?: unknown; challenge?: unknown };
    if (typeof b.challenge !== "string" || !/^[0-9a-f]{64}$/.test(b.challenge)) throw new HttpError(400, "This connect link is broken. Start the uploader again.");
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM upload_keys WHERE user_id = ?").bind(user.id).first<{ n: number }>();
    if ((count?.n ?? 0) >= MAX_PCS) throw new HttpError(413, `You can connect up to ${MAX_PCS} PCs. Disconnect one first.`);
    const code = randomToken(24);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM upload_codes WHERE expires_at <= ?").bind(now()),
      env.DB.prepare("INSERT INTO upload_codes (id, user_id, name, challenge, expires_at) VALUES (?, ?, ?, ?, ?)").bind(
        await sha256(code), user.id, pcName(b.name), b.challenge, now() + CODE_SECONDS,
      ),
    ]);
    return json({ code });
  }

  // Disconnect: the key stops working at once.
  if (parts.length === 3 && parts[1] === "pcs" && m === "DELETE") {
    await env.DB.prepare("DELETE FROM upload_keys WHERE id = ? AND user_id = ?").bind(parts[2], user.id).run();
    return json({ pcs: await pcs(env, user) });
  }

  throw new HttpError(404, "Not found");
}
