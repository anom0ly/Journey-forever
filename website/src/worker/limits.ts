// Rate limits, with Cloudflare's rate limiting binding (wrangler.jsonc
// "ratelimits"). Counts are per Cloudflare location and approximate, which
// is enough to stop one script from using up the day's free requests or
// filling storage. Without the bindings (tests), nothing is limited.

import type { Env } from "./env";
import { HttpError } from "./http";

// Every request the Worker handles, by IP address.
// Changes (uploads, toggles, reports), by account when signed in, else by IP.
export async function checkRate(env: Env, req: Request, userId: string | null): Promise<void> {
  const ip = req.headers.get("cf-connecting-ip") ?? "local";
  if (env.RL_REQUESTS && !(await env.RL_REQUESTS.limit({ key: `ip:${ip}` })).success) throw tooMany();
  if (req.method === "GET" || req.method === "HEAD") return;
  if (env.RL_CHANGES && !(await env.RL_CHANGES.limit({ key: userId ? `user:${userId}` : `ip:${ip}` })).success) throw tooMany();
}

// Error reports (POST /api/errors), on top of the above: a page or PC with a
// real problem sends a few, so anything past this is noise or someone
// trying to flood Workers Issues and its alerts.
export async function checkReportRate(env: Env, req: Request, who: string | null): Promise<void> {
  const ip = req.headers.get("cf-connecting-ip") ?? "local";
  if (env.RL_ERRORS && !(await env.RL_ERRORS.limit({ key: who ?? `ip:${ip}` })).success) throw tooMany();
}

function tooMany(): HttpError {
  return new HttpError(429, "Too many requests. Wait a few seconds and try again.");
}
