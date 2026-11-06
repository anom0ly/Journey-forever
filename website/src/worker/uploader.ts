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

import { UPLOADER_EXE, UPLOADER_REPO, UPLOADER_SETTINGS_DEFAULT, type ApprovedUploader, type UploaderSettings } from "../lib/uploader";
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
  ["GET", /^\/api\/uploader\/latest$/],
  ["POST", /^\/api\/uploader\/status$/],
  ["DELETE", /^\/api\/uploader\/self$/],
  ["POST", /^\/api\/errors$/],
];

export function keyAllows(method: string, path: string): boolean {
  return UPLOADER_ROUTES.some(([m, re]) => m === method && re.test(path));
}

export function bearerKey(req: Request): string | undefined {
  const h = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(\S+)$/i.exec(h);
  return m && m[1].startsWith(KEY_PREFIX) ? m[1] : undefined;
}

// A key that hasn't been used for this long stops working (the PC was
// probably given away or wiped); connecting again makes a new one.
export const KEY_IDLE_SECONDS = 60 * 86400;

// The account behind an upload key, and which PC it is.
export async function keyUser(env: Env, key: string): Promise<(User & { key_id: string }) | null> {
  const t = now();
  const row = await env.DB.prepare(
    `SELECT u.id, u.bnet_id, u.battletag, u.last_upload_at, k.id AS key_id, COALESCE(k.last_seen_at, k.created_at) AS seen
     FROM upload_keys k JOIN users u ON u.id = k.user_id
     WHERE k.key_hash = ? AND COALESCE(k.last_seen_at, k.created_at) > ?`,
  )
    .bind(await sha256(key), t - KEY_IDLE_SECONDS)
    .first<User & { key_id: string; seen: number }>();
  if (!row) return null;
  // Being used keeps it alive (written at most hourly).
  if (t - row.seen > 3600) await env.DB.prepare("UPDATE upload_keys SET last_seen_at = ? WHERE id = ?").bind(t, row.key_id).run();
  const { seen: _seen, ...user } = row;
  return user;
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

  // The build to update to: the newest one an admin approved.
  if (parts.length === 2 && parts[1] === "latest" && m === "GET") return json(await approvedUploader(env));

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

// /api/admin/uploader: every connected PC, for the admin Uploader health
// page. Built from what each PC reports after an upload plus the problems it
// sent (errors.ts keeps the last 10 per PC).
export async function handleUploaderHealth(req: Request, env: Env, user: User, parts: string[]): Promise<Response> {
  if (!isAdmin(env, user)) throw new HttpError(404, "Not found");
  if (parts[2] === "releases") return handleReleases(req, env, user, parts);
  if (req.method !== "GET") throw new HttpError(404, "Not found");
  if (parts.length === 2) {
    const week = now() - 7 * 86400;
    const { results } = await env.DB.prepare(
      `SELECT k.id, k.name, u.battletag, k.created_at, k.last_seen_at, k.last_upload_at, k.last_ok, k.last_message,
         k.app_version, k.addon_version, k.os_version,
         (SELECT COUNT(*) FROM upload_errors e WHERE e.key_id = k.id AND e.t > ?) AS week_errors,
         e.t AS error_t, e.area AS error_area, e.message AS error_message
       FROM upload_keys k JOIN users u ON u.id = k.user_id
       LEFT JOIN upload_errors e ON e.id = (SELECT MAX(id) FROM upload_errors WHERE key_id = k.id)
       ORDER BY COALESCE(k.last_seen_at, k.created_at) DESC`,
    )
      .bind(week)
      .all<KeyRow & { battletag: string; os_version: string | null; week_errors: number; error_t: number | null; error_area: string | null; error_message: string | null }>();
    return json({
      pcs: results.map((r) => ({
        id: r.id,
        name: r.name,
        battletag: r.battletag,
        createdAt: r.created_at,
        lastSeenAt: r.last_seen_at,
        lastUploadAt: r.last_upload_at,
        ok: r.last_ok === null ? null : !!r.last_ok,
        message: r.last_message,
        appVersion: r.app_version,
        addonVersion: r.addon_version,
        osVersion: r.os_version,
        weekErrors: r.week_errors,
        lastError: r.error_t === null ? null : { t: r.error_t, area: r.error_area, message: r.error_message },
      })),
    });
  }
  if (parts.length === 4 && parts[3] === "errors") {
    const { results } = await env.DB.prepare("SELECT t, area, message, app_version FROM upload_errors WHERE key_id = ? ORDER BY id DESC")
      .bind(parts[2])
      .all<{ t: number; area: string; message: string; app_version: string | null }>();
    return json({ errors: results.map((e) => ({ t: e.t, area: e.area, message: e.message, appVersion: e.app_version })) });
  }
  throw new HttpError(404, "Not found");
}

// Approving uploader builds. The release workflow publishes each build on
// GitHub; uploaders install one only after an admin approves it here, and
// only when the file still has the SHA-256 recorded at approval. Anyone who
// can get a release onto GitHub (another workflow, a replaced file, a stolen
// GitHub sign-in) still can't reach players' PCs without this step, and
// withdrawing an approval stops a bad build from spreading.

const RELEASE_BOT = "github-actions[bot]";
const DOWNLOAD_PREFIX = `https://github.com/${UPLOADER_REPO}/releases/download/`;

interface GhAsset {
  name: string;
  browser_download_url: string;
  size?: number;
  digest?: string | null;
  uploader?: { login?: string } | null;
}
interface GhRelease {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  published_at?: string | null;
  author?: { login?: string } | null;
  assets: GhAsset[];
}

export interface UploaderBuild {
  version: string;
  publishedAt: string | null;
  sha256: string | null; // null: GitHub has no usable file for it
  size: number | null;
}

// An uploader build as GitHub lists it, checked the same way the uploader
// checks it: published by our release workflow, with a SHA-256 digest.
export function uploaderBuild(r: GhRelease): UploaderBuild | undefined {
  if (r.draft || r.prerelease || !r.tag_name.startsWith("uploader-v")) return undefined;
  const version = r.tag_name.slice("uploader-v".length);
  if (!/^\d+\.\d+\.\d+$/.test(version)) return undefined;
  const a = r.assets.find((x) => x.name === UPLOADER_EXE);
  const sha256 = /^sha256:([0-9a-f]{64})$/.exec(a?.digest ?? "")?.[1];
  const ok = !!a && !!sha256 && r.author?.login === RELEASE_BOT && a.uploader?.login === RELEASE_BOT && a.browser_download_url.startsWith(DOWNLOAD_PREFIX) && !!a.size;
  return { version, publishedAt: r.published_at ?? null, sha256: ok ? sha256! : null, size: ok ? a!.size! : null };
}

export async function githubBuilds(get: typeof fetch = fetch): Promise<UploaderBuild[]> {
  const res = await get(`https://api.github.com/repos/${UPLOADER_REPO}/releases?per_page=50`, {
    headers: { accept: "application/vnd.github+json", "user-agent": "JourneyForeverSite" },
  });
  if (!res.ok) throw new HttpError(502, `GitHub answered ${res.status}. Try again in a minute.`);
  return ((await res.json()) as GhRelease[]).map(uploaderBuild).filter((b): b is UploaderBuild => !!b);
}

function isNewerVersion(a: string, b: string): boolean {
  const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  return false;
}

export async function approvedUploader(env: Env): Promise<ApprovedUploader> {
  const row = await env.DB.prepare("SELECT version, sha256, size FROM uploader_releases ORDER BY approved_at DESC, version DESC LIMIT 1").first<{
    version: string;
    sha256: string;
    size: number;
  }>();
  return row ? { version: row.version, sha256: row.sha256, size: row.size } : { version: null };
}

async function handleReleases(req: Request, env: Env, user: User, parts: string[]): Promise<Response> {
  const m = req.method;
  const list = async () => {
    const { results } = await env.DB.prepare("SELECT version, sha256, approved_at FROM uploader_releases").all<{ version: string; sha256: string; approved_at: number }>();
    const approved = new Map(results.map((r) => [r.version, r]));
    let builds: UploaderBuild[] = [];
    let error: string | undefined;
    try {
      builds = await githubBuilds();
    } catch (e) {
      error = (e as Error).message;
    }
    const latest = await approvedUploader(env);
    const out = builds.map((b) => {
      const a = approved.get(b.version);
      return { ...b, approvedAt: a?.approved_at ?? null, changed: !!a && a.sha256 !== b.sha256 };
    });
    // Approved but gone from GitHub (or GitHub didn't answer): still listed, so it can be withdrawn.
    for (const a of results) {
      if (!builds.some((b) => b.version === a.version)) out.push({ version: a.version, publishedAt: null, sha256: null, size: null, approvedAt: a.approved_at, changed: false });
    }
    out.sort((x, y) => (isNewerVersion(x.version, y.version) ? -1 : isNewerVersion(y.version, x.version) ? 1 : 0));
    return json({ latest: latest.version, error, builds: out });
  };
  if (parts.length === 3 && m === "GET") return list();
  const version = parts[3] ?? "";
  if (parts.length !== 4 || !/^\d+\.\d+\.\d+$/.test(version)) throw new HttpError(404, "Not found");
  if (m === "POST") {
    // The SHA-256 comes from GitHub now, never from the page.
    const build = (await githubBuilds()).find((b) => b.version === version);
    if (!build?.sha256 || !build.size) throw new HttpError(400, `GitHub has no usable uploader ${version} from the release workflow`);
    await env.DB.prepare(
      `INSERT INTO uploader_releases (version, sha256, size, approved_at, approved_by) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (version) DO UPDATE SET sha256 = excluded.sha256, size = excluded.size, approved_at = excluded.approved_at, approved_by = excluded.approved_by`,
    )
      .bind(version, build.sha256, build.size, now(), user.id)
      .run();
    return list();
  }
  if (m === "DELETE") {
    await env.DB.prepare("DELETE FROM uploader_releases WHERE version = ?").bind(version).run();
    return list();
  }
  throw new HttpError(404, "Not found");
}
