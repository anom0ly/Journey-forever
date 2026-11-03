import { handleApi, handleMedia } from "./api";
import { authMode, currentUser, handleAuth } from "./auth";
import { isAdmin, reviewCount } from "./boards";
import type { Env } from "./env";
import { checkSameOrigin, HttpError, json, withSecurityHeaders } from "./http";
import { checkRate } from "./limits";
import { handleMapTile } from "./maps";

async function route(req: Request, env: Env, url: URL): Promise<Response> {
  checkSameOrigin(req, url);
  // Changes are limited per account when signed in, so look the account up
  // for those (reads are limited by IP only).
  const user = req.method === "GET" || req.method === "HEAD" ? null : await currentUser(req, env);
  await checkRate(env, req, user?.id ?? null);
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
    let res: Response;
    try {
      res = await route(req, env, url);
    } catch (err) {
      if (err instanceof HttpError) {
        res = json({ error: err.message }, { status: err.status, headers: err.status === 429 ? { "retry-after": "10" } : {} });
      } else {
        console.error(err);
        res = json({ error: "Something went wrong on our side" }, { status: 500 });
      }
    }
    // Pages and files from dist/ get theirs from public/_headers.
    return own ? withSecurityHeaders(res) : res;
  },
} satisfies ExportedHandler<Env>;
