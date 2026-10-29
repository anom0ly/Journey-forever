import { handleApi, handleMedia } from "./api";
import { authMode, currentUser, handleAuth } from "./auth";
import type { Env } from "./env";
import { checkSameOrigin, HttpError, json } from "./http";

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    try {
      checkSameOrigin(req, url);
      if (url.pathname === "/api/me") {
        const user = await currentUser(req, env);
        return json({
          user: user && { id: user.id, battletag: user.battletag, lastUploadAt: user.last_upload_at },
          authMode: authMode(env, url),
        });
      }
      if (url.pathname.startsWith("/api/")) return await handleApi(req, env, url);
      if (url.pathname.startsWith("/auth/")) return await handleAuth(req, env, url);
      if (url.pathname.startsWith("/media/")) return await handleMedia(req, env, url, (r) => currentUser(r, env));
      return env.ASSETS.fetch(req);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, { status: err.status });
      console.error(err);
      return json({ error: "Something went wrong on our side" }, { status: 500 });
    }
  },
} satisfies ExportedHandler<Env>;
