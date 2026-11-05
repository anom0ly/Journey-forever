// The uploader's only window: a small page it serves to the browser on this
// PC (http://127.0.0.1:<port>/). It answers only requests addressed to
// 127.0.0.1 or localhost (so another site can't reach it by DNS tricks). The
// page itself opens only with ?t=<instance token>, which only this Windows
// user can read (so another user of the PC can't use it), and every button
// needs a token printed in the page (so another site can't press them).

import type { Uploader } from "./app";
import { statusPage, messagePage } from "./page";
import { trayState, type WindowControl } from "./window";

export const APP_NAME = "journey-forever-uploader";

export interface ServerHooks {
  uploader: Uploader;
  token: string; // for the page's buttons
  instanceToken: string; // the window/tray, and another copy of the uploader
  window: WindowControl;
  pickFolder(): Promise<void>;
  remove(): Promise<void>;
  openJourney(): Promise<void>;
  openInBrowser(): Promise<void>; // the status page, when there's no window
  setStartup(on: boolean): Promise<void>;
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
    if (url.pathname === "/" && req.method === "GET") {
      if (url.searchParams.get("t") !== h.instanceToken) {
        return html(messagePage("Journey Forever uploader", "Double-click the uploader to open this page.", false), 403);
      }
      return html(statusPage(h.uploader.status(), h.token));
    }
    if (url.pathname === "/connected" && req.method === "GET") {
      const r = await h.uploader.connected(url.searchParams.get("code") ?? "");
      return html(messagePage(r.ok ? "Connected" : "Not connected", r.message, r.ok), r.ok ? 200 : 400);
    }

    const token = req.headers.get("x-token");
    if (token === h.instanceToken) {
      if (url.pathname === "/quit" && req.method === "POST") {
        setTimeout(() => h.quit(), 100);
        return Response.json({ ok: true });
      }
      // Double-clicking the .exe again: bring up the window (or the page).
      if (url.pathname === "/show" && req.method === "POST") {
        if (!h.window.show()) await h.openInBrowser();
        return Response.json({ ok: true });
      }
      if (url.pathname === "/host/state" && req.method === "GET") {
        const s = h.uploader.status();
        return Response.json({ ...trayState(s), paused: s.paused, ...h.window.polled(url.searchParams.get("visible") === "1") });
      }
      if (url.pathname === "/host/cmd" && req.method === "POST") {
        const { cmd } = (await req.json().catch(() => ({}))) as { cmd?: string };
        const u = h.uploader;
        if (cmd === "sync") u.uploadNow();
        else if (cmd === "pause") u.setPaused(true);
        else if (cmd === "resume") u.setPaused(false);
        else if (cmd === "journey") await h.openJourney();
        else if (cmd === "quit") setTimeout(() => h.quit(), 100);
        else if (cmd === "nowebview") {
          h.window.noWebView = true;
          await h.openInBrowser();
        } else return new Response("Unknown command", { status: 400 });
        return Response.json({ ok: true });
      }
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
      else if (action === "startup-on" || action === "startup-off") await h.setStartup(action === "startup-on");
      else if (action === "check-update") u.checkForUpdates();
      else if (action === "remove") {
        await h.remove();
        return Response.json({ ok: true, removed: true });
      } else return new Response("Unknown action", { status: 400 });
      return Response.json({ ok: true });
    }
    return new Response("Not found", { status: 404 });
  };
}
