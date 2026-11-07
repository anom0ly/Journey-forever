import { handleApi, handleMedia } from "./api";
import { authMode, currentUser, handleAuth } from "./auth";
import { isAdmin, reviewCount } from "./boards";
import type { Env, User } from "./env";
import { checkSameOrigin, HttpError, isLocal, json, withSecurityHeaders } from "./http";
import { checkRate } from "./limits";
import { handleMapTile } from "./maps";
import { handleErrorReport } from "./errors";
import { bearerKey, canUseUploader, keyAllows, keyUser, outdatedBlocked, uploaderSwitches } from "./uploader";

// What the error log says about a request that failed.
interface Seen {
  userId: string | null;
}

async function route(req: Request, env: Env, url: URL, seen: Seen): Promise<Response> {
  checkSameOrigin(req, url);
  // The Windows uploader signs in with its key, which only works while the
  // uploader is open to the account (admins, or everyone in Beta) and only
  // for uploading (uploader.ts).
  const key = bearerKey(req);
  if (key) {
    const owner = await keyUser(env, key);
    if (!owner) throw new HttpError(401, "This PC was disconnected. Connect it again from the uploader.");
    const sw = await uploaderSwitches(env);
    if (!canUseUploader(env, owner, sw)) throw new HttpError(404, "Not found");
    if (!keyAllows(req.method, url.pathname)) throw new HttpError(403, "The uploader can't do that");
    if (outdatedBlocked(sw, owner.app_version, req.method, url.pathname)) {
      throw new HttpError(426, "This uploader is out of date. Choose Check for updates in its tray menu, or download it again from the site.");
    }
  }
  // Changes are limited per account when signed in, so look the account up
  // for those (reads are limited by IP only).
  const user = req.method === "GET" || req.method === "HEAD" ? null : await currentUser(req, env);
  seen.userId = user?.id ?? null;
  await checkRate(env, req, seen.userId);
  if (url.pathname === "/api/errors" && req.method === "POST") return await handleErrorReport(req, env, user);
  if (url.pathname === "/api/me") {
    const me = await currentUser(req, env);
    const admin = isAdmin(env, me);
    const uploader = me ? await uploaderFor(env, me) : undefined;
    return json({
      user: me && { id: me.id, battletag: me.battletag, lastUploadAt: me.last_upload_at, isAdmin: admin, uploader },
      reviewCount: admin ? await reviewCount(env) : undefined,
      authMode: authMode(env, url),
    });
  }
  if (url.pathname.startsWith("/api/")) return await handleApi(req, env, url);
  if (url.pathname.startsWith("/auth/")) return await handleAuth(req, env, url);
  if (url.pathname.startsWith("/media/")) return await handleMedia(req, env, url, (r) => currentUser(r, env));
  if (url.pathname.startsWith("/maps/")) return await handleMapTile(env, url);
  return env.ASSETS.fetch(req);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    // workers.dev also answers plain http. Signing in from there would send
    // Battle.net an http:// callback, which it rejects ("callback URL is not
    // valid"), so sign-in always moves to https first.
    if (url.protocol === "http:" && url.pathname.startsWith("/auth/") && !isLocal(url)) {
      url.protocol = "https:";
      return Response.redirect(url.toString(), 308);
    }
    const own = /^\/(api|auth|media|maps)\//.test(url.pathname);
    const seen: Seen = { userId: null };
    let res: Response;
    try {
      res = await route(req, env, url, seen);
    } catch (err) {
      // Logged errors are what Workers Issues groups and alerts on: anything
      // unexpected, and our own 5xx answers (map art not reachable).
      const where = JSON.stringify({ method: req.method, path: url.pathname.slice(0, 200), userId: seen.userId ?? undefined });
      if (err instanceof HttpError) {
        if (err.status >= 500) console.error(err, where);
        res = json({ error: err.message }, { status: err.status, headers: err.status === 429 ? { "retry-after": "10" } : {} });
      } else {
        console.error(err, where);
        res = json({ error: "Something went wrong on our side" }, { status: 500 });
      }
    }
    // Pages and files from dist/ get theirs from public/_headers.
    return own ? withSecurityHeaders(res) : res;
  },
} satisfies ExportedHandler<Env>;

// Whether this account can use the Windows uploader, and how many PCs it has
// connected (the site stops offering the download once there's one).
async function uploaderFor(env: Env, user: User): Promise<{ allowed: boolean; beta: boolean; pcs: number }> {
  const sw = await uploaderSwitches(env);
  const allowed = canUseUploader(env, user, sw);
  const n = allowed ? await env.DB.prepare("SELECT COUNT(*) AS n FROM upload_keys WHERE user_id = ?").bind(user.id).first<{ n: number }>() : null;
  return { allowed, beta: sw.beta, pcs: n?.n ?? 0 };
}
