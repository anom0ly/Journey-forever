// The uploader's only window: a small page it serves to the browser on this
// PC (http://127.0.0.1:<port>/). It answers only requests addressed to
// 127.0.0.1 or localhost (so another site can't reach it by DNS tricks), and
// every button needs the token printed in the page (so another site can't
// press them).

import type { Uploader } from "./app";
import { statusPage, messagePage } from "./page";

export const APP_NAME = "journey-forever-uploader";

export interface ServerHooks {
  uploader: Uploader;
  token: string; // for the page's buttons
  instanceToken: string; // for another copy of the uploader asking this one to quit
  pickFolder(): Promise<void>;
  remove(): Promise<void>;
  quit(): void;
}

export function hostOk(host: string | null, port: number): boolean {
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
}

export function handler(h: ServerHooks, port: () => number) {
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    if (!hostOk(req.headers.get("host"), port())) return new Response("Not found", { status: 404 });
    const html = (body: string, status = 200) =>
      new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-frame-options": "DENY" } });

    if (url.pathname === "/ping") return Response.json({ app: APP_NAME, version: h.uploader.status().version });
    if (url.pathname === "/" && req.method === "GET") return html(statusPage(h.uploader.status(), h.token));
    if (url.pathname === "/connected" && req.method === "GET") {
      const r = await h.uploader.connected(url.searchParams.get("code") ?? "");
      return html(messagePage(r.ok ? "Connected" : "Not connected", r.message, r.ok), r.ok ? 200 : 400);
    }

    const token = req.headers.get("x-token");
    if (url.pathname === "/quit" && req.method === "POST" && token === h.instanceToken) {
      setTimeout(() => h.quit(), 100);
      return Response.json({ ok: true });
    }
    if (token !== h.token) return new Response("Forbidden", { status: 403 });
    if (url.pathname === "/state" && req.method === "GET") return Response.json(h.uploader.status());
    if (url.pathname === "/action" && req.method === "POST") {
      const { action } = (await req.json().catch(() => ({}))) as { action?: string };
      const u = h.uploader;
      if (action === "sync") u.uploadNow();
      else if (action === "pause") u.setPaused(true);
      else if (action === "resume") u.setPaused(false);
      else if (action === "connect") await u.connect();
      else if (action === "pick") void h.pickFolder();
      else if (action === "remove") {
        await h.remove();
        return Response.json({ ok: true, removed: true });
      } else return new Response("Unknown action", { status: 400 });
      return Response.json({ ok: true });
    }
    return new Response("Not found", { status: 404 });
  };
}
