// Sign-in with Battle.net (OAuth 2.0 authorization code flow), and the
// session cookie that follows it. With AUTH_MODE=dev and the site on
// localhost, /auth/login signs in a local "Dev" account instead, so the site
// can be tried before a Battle.net client exists.

import { hashTag } from "../lib/friendTags";
import type { Env, User } from "./env";
import { cookie, HttpError, isLocal, json, now, parseCookies, randomToken, sha256 } from "./http";
import { redact } from "../lib/errorReport";
import { browserOf, groupKey, type SigninReason } from "../lib/problems";
import { checkReportRate } from "./limits";
import { recordProblem } from "./problems";
import { bearerKey, keyUser } from "./uploader";

const SESSION_COOKIE = "jf_session";
const STATE_COOKIE = "jf_oauth_state";
// Where to go after signing in (?to= on /auth/login): only this site's own
// /connect page, so the uploader's connect link survives a sign-in.
const RETURN_COOKIE = "jf_return";
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

// The signed-in account: from the session cookie, or from an upload key
// (the Windows uploader), which index.ts limits to the upload routes.
export async function currentUser(req: Request, env: Env): Promise<User | null> {
  const key = bearerKey(req);
  if (key) return keyUser(env, key);
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT u.id, u.bnet_id, u.battletag, u.last_upload_at FROM sessions s JOIN users u ON u.id = s.user_id
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
  headers.append("set-cookie", cookie(RETURN_COOKIE, "", url, 0));
  return new Response(null, { status: 302, headers });
}

async function upsertUser(env: Env, bnetId: string, battletag: string | null): Promise<string> {
  const existing = await env.DB.prepare("SELECT id FROM users WHERE bnet_id = ?").bind(bnetId).first<{ id: string }>();
  if (existing) {
    await env.DB.prepare("UPDATE users SET battletag = ?, tag_hash = ? WHERE id = ?").bind(battletag, battletag ? await hashTag(battletag) : null, existing.id).run();
    return existing.id;
  }
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO users (id, bnet_id, battletag, tag_hash, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(id, bnetId, battletag, battletag ? await hashTag(battletag) : null, now())
    .run();
  return id;
}

function redirectUri(env: Env, url: URL): string {
  return env.BNET_REDIRECT_URI || `${url.origin}/auth/callback`;
}

export function returnPath(to: string | null | undefined): string | undefined {
  return to && /^\/connect(\?[\w=&%.-]*)?$/.test(to) && to.length <= 500 ? to : undefined;
}

export async function handleAuth(req: Request, env: Env, url: URL): Promise<Response> {
  const mode = authMode(env, url);
  if (url.pathname === "/auth/login") {
    const to = returnPath(url.searchParams.get("to"));
    if (mode === "dev") return startSession(env, url, await upsertUser(env, "dev", "Dev#0000"), to ?? "/characters");
    if (mode === "unconfigured") return Response.redirect(`${url.origin}/?signin=unconfigured`, 302);
    const state = randomToken(16);
    const auth = new URL(`${BNET}/authorize`);
    auth.searchParams.set("client_id", env.BNET_CLIENT_ID!);
    auth.searchParams.set("redirect_uri", redirectUri(env, url));
    auth.searchParams.set("response_type", "code");
    auth.searchParams.set("scope", "openid");
    auth.searchParams.set("state", state);
    const headers = new Headers({ location: auth.toString() });
    headers.append("set-cookie", cookie(STATE_COOKIE, state, url, 600));
    if (to) headers.append("set-cookie", cookie(RETURN_COOKIE, to, url, 600));
    return new Response(null, { status: 302, headers });
  }

  if (url.pathname === "/auth/callback") {
    if (mode !== "battlenet") throw new HttpError(404, "Not found");
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const bnetError = url.searchParams.get("error");
    // A visit with nothing from Battle.net (a bot, a bookmark) isn't a failed sign-in.
    if (!code && !bnetError) return Response.redirect(`${url.origin}/?signin=failed`, 302);
    const fail = (why: SigninReason, extra: Record<string, unknown> = {}) => signinFailed(req, env, url, why, extra);
    if (bnetError) return fail("denied", { bnet: bnetError.slice(0, 60) });
    const expected = parseCookies(req)[STATE_COOKIE];
    if (!expected) return fail("expired");
    if (!code || !state || state !== expected) return fail("mismatch");
    const tokenRes = await fetch(`${BNET}/token`, {
      method: "POST",
      headers: {
        authorization: "Basic " + btoa(`${env.BNET_CLIENT_ID}:${env.BNET_CLIENT_SECRET}`),
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri(env, url) }),
    });
    if (!tokenRes.ok) {
      const answer = (await tokenRes.json().catch(() => ({}))) as { error?: unknown; error_description?: unknown };
      return fail("token", {
        status: tokenRes.status,
        bnet: typeof answer.error === "string" ? answer.error.slice(0, 60) : undefined,
        says: typeof answer.error_description === "string" ? answer.error_description.slice(0, 160) : undefined,
      });
    }
    const { access_token } = (await tokenRes.json()) as { access_token?: string };
    const infoRes = await fetch(`${BNET}/userinfo`, { headers: { authorization: `Bearer ${access_token}` } });
    if (!infoRes.ok) return fail("userinfo", { status: infoRes.status });
    const info = (await infoRes.json()) as { sub?: string; id?: number; battletag?: string };
    const bnetId = info.sub ?? (info.id !== undefined ? String(info.id) : undefined);
    if (!bnetId) return fail("account");
    // The Battle.net access token is only used here and never stored.
    return startSession(env, url, await upsertUser(env, bnetId, info.battletag ?? null), returnPath(parseCookies(req)[RETURN_COOKIE]) ?? "/characters");
  }

  if (url.pathname === "/auth/logout" && req.method === "POST") {
    const token = parseCookies(req)[SESSION_COOKIE];
    if (token) await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(await sha256(token)).run();
    return json({ ok: true }, { headers: { "set-cookie": clearSessionCookie(url) } });
  }

  throw new HttpError(404, "Not found");
}

// A sign-in that didn't finish: kept for the Problems page (it can't be
// tied to an account, so the callback address and browser say whose), and
// the home page told why, so it can say what to do.
// Anyone can open the callback address, so failures share the error-report
// limit (past it they're not stored), and a cancel keeps the ?error= text out
// of the title: otherwise every made-up value would add a problem of its own.
async function signinFailed(req: Request, env: Env, url: URL, why: SigninReason, extra: Record<string, unknown>): Promise<Response> {
  const back = Response.redirect(`${url.origin}/?signin=failed&why=${why}`, 302);
  try {
    await checkReportRate(env, req, null);
  } catch {
    return back;
  }
  const detail: Record<string, unknown> = { why, callback: redirectUri(env, url), browser: browserOf(req.headers.get("user-agent")) };
  for (const [k, v] of Object.entries(extra)) if (v !== undefined) detail[k] = typeof v === "string" ? redact(v) : v;
  const bnet = why === "denied" ? undefined : extra.bnet;
  const message = `${SIGNIN_TEXT[why]}${extra.status ? ` (${extra.status}${bnet ? ` ${bnet}` : ""})` : bnet ? ` (${bnet})` : ""}`;
  const status = await recordProblem(env, {
    kind: "signin",
    key: groupKey("signin", `${why} ${url.host}`, message),
    title: `${message}, via ${url.host}`,
    userId: null,
    detail,
  });
  if (why !== "denied" && why !== "expired" && status !== "hidden") console.error(new Error(`Sign-in failed: ${message}`), JSON.stringify(detail));
  return back;
}

const SIGNIN_TEXT: Record<SigninReason, string> = {
  denied: "Player cancelled at Battle.net",
  expired: "Sign-in cookie missing (took over 10 minutes, or cookies blocked)",
  mismatch: "Sign-in state didn't match",
  token: "Battle.net refused the code",
  userinfo: "Battle.net account info failed",
  account: "Battle.net sent no account id",
};
