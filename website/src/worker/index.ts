import { handleApi, handleMedia } from "./api";
import { authMode, currentUser, handleAuth } from "./auth";
import { isAdmin, reviewCount } from "./boards";
import type { Env } from "./env";
import { checkSameOrigin, HttpError, json, withSecurityHeaders } from "./http";
import { checkRate } from "./limits";
import { handleMapTile } from "./maps";
import { handleErrorReport } from "./errors";
import { bearerKey, keyAllows, keyUser } from "./uploader";

// What the error log says about a request that failed.
interface Seen {
  userId: string | null;
}

async function route(req: Request, env: Env, url: URL, seen: Seen): Promise<Response> {
  checkSameOrigin(req, url);
  // The Windows uploader signs in with its key, which only works for
  // admins (for now) and only for uploading (uploader.ts).
  const key = bearerKey(req);
  if (key) {
    const owner = await keyUser(env, key);
    if (!owner) throw new HttpError(401, "This PC was disconnected. Connect it again from the uploader.");
    if (!isAdmin(env, owner)) throw new HttpError(404, "Not found");
    if (!keyAllows(req.method, url.pathname)) throw new HttpError(403, "The uploader can't do that");
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
    return json({
      user: me && { id: me.id, battletag: me.battletag, lastUploadAt: me.last_upload_at, isAdmin: admin },
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
