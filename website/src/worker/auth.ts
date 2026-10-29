// Sign-in with Battle.net (OAuth 2.0 authorization code flow), and the
// session cookie that follows it. With AUTH_MODE=dev and the site on
// localhost, /auth/login signs in a local "Dev" account instead, so the site
// can be tried before a Battle.net client exists.

import type { Env, User } from "./env";
import { cookie, HttpError, isLocal, json, now, parseCookies, randomToken, sha256 } from "./http";

const SESSION_COOKIE = "jf_session";
const STATE_COOKIE = "jf_oauth_state";
const SESSION_SECONDS = 30 * 24 * 3600;
const BNET = "https://oauth.battle.net";

export type AuthMode = "battlenet" | "dev" | "unconfigured";

export function authMode(env: Env, url: URL): AuthMode {
  if (env.AUTH_MODE === "dev") return isLocal(url) ? "dev" : "unconfigured";
  return env.BNET_CLIENT_ID && env.BNET_CLIENT_SECRET ? "battlenet" : "unconfigured";
}

export function clearSessionCookie(url: URL): string {
  return cookie(SESSION_COOKIE, "", url, 0);
}

export async function currentUser(req: Request, env: Env): Promise<User | null> {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT u.id, u.battletag, u.last_upload_at FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > ?`,
  )
    .bind(await sha256(token), now())
    .first<User>();
  return row ?? null;
}

export async function requireUser(req: Request, env: Env): Promise<User> {
  const user = await currentUser(req, env);
  if (!user) throw new HttpError(401, "Sign in first");
  return user;
}

async function startSession(env: Env, url: URL, userId: string, to: string): Promise<Response> {
  const token = randomToken();
  const t = now();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ? AND expires_at <= ?").bind(userId, t),
    env.DB.prepare("INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)").bind(
      await sha256(token), userId, t, t + SESSION_SECONDS,
    ),
  ]);
  const headers = new Headers({ location: to });
  headers.append("set-cookie", cookie(SESSION_COOKIE, token, url, SESSION_SECONDS));
  headers.append("set-cookie", cookie(STATE_COOKIE, "", url, 0));
  return new Response(null, { status: 302, headers });
}

async function upsertUser(env: Env, bnetId: string, battletag: string | null): Promise<string> {
  const existing = await env.DB.prepare("SELECT id FROM users WHERE bnet_id = ?").bind(bnetId).first<{ id: string }>();
  if (existing) {
    await env.DB.prepare("UPDATE users SET battletag = ? WHERE id = ?").bind(battletag, existing.id).run();
    return existing.id;
  }
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO users (id, bnet_id, battletag, created_at) VALUES (?, ?, ?, ?)")
    .bind(id, bnetId, battletag, now())
    .run();
  return id;
}

function redirectUri(env: Env, url: URL): string {
  return env.BNET_REDIRECT_URI || `${url.origin}/auth/callback`;
}

export async function handleAuth(req: Request, env: Env, url: URL): Promise<Response> {
  const mode = authMode(env, url);
  if (url.pathname === "/auth/login") {
    if (mode === "dev") return startSession(env, url, await upsertUser(env, "dev", "Dev#0000"), "/characters");
    if (mode === "unconfigured") return Response.redirect(`${url.origin}/?signin=unconfigured`, 302);
    const state = randomToken(16);
    const auth = new URL(`${BNET}/authorize`);
    auth.searchParams.set("client_id", env.BNET_CLIENT_ID!);
    auth.searchParams.set("redirect_uri", redirectUri(env, url));
    auth.searchParams.set("response_type", "code");
    auth.searchParams.set("scope", "openid");
    auth.searchParams.set("state", state);
    return new Response(null, {
      status: 302,
      headers: { location: auth.toString(), "set-cookie": cookie(STATE_COOKIE, state, url, 600) },
    });
  }

  if (url.pathname === "/auth/callback") {
    if (mode !== "battlenet") throw new HttpError(404, "Not found");
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || !state || state !== parseCookies(req)[STATE_COOKIE]) {
      return Response.redirect(`${url.origin}/?signin=failed`, 302);
    }
    const tokenRes = await fetch(`${BNET}/token`, {
      method: "POST",
      headers: {
        authorization: "Basic " + btoa(`${env.BNET_CLIENT_ID}:${env.BNET_CLIENT_SECRET}`),
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri(env, url) }),
    });
    if (!tokenRes.ok) return Response.redirect(`${url.origin}/?signin=failed`, 302);
    const { access_token } = (await tokenRes.json()) as { access_token?: string };
    const infoRes = await fetch(`${BNET}/userinfo`, { headers: { authorization: `Bearer ${access_token}` } });
    if (!infoRes.ok) return Response.redirect(`${url.origin}/?signin=failed`, 302);
    const info = (await infoRes.json()) as { sub?: string; id?: number; battletag?: string };
    const bnetId = info.sub ?? (info.id !== undefined ? String(info.id) : undefined);
    if (!bnetId) return Response.redirect(`${url.origin}/?signin=failed`, 302);
    // The Battle.net access token is only used here and never stored.
    return startSession(env, url, await upsertUser(env, bnetId, info.battletag ?? null), "/characters");
  }

  if (url.pathname === "/auth/logout" && req.method === "POST") {
    const token = parseCookies(req)[SESSION_COOKIE];
    if (token) await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(await sha256(token)).run();
    return json({ ok: true }, { headers: { "set-cookie": clearSessionCookie(url) } });
  }

  throw new HttpError(404, "Not found");
}
