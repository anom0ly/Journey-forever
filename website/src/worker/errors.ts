// POST /api/errors: error reports from the pages and from the Windows
// uploader (see lib/errorReport.ts). The report is checked, then logged with
// console.error, which is what Workers Issues groups and alerts on. Signed in
// or not, since a crash on a public journey matters as much; the usual rate
// limits apply. An uploader's report sent with its key is also kept (the
// last 10 per PC) for the admin Uploader health page.

import { cleanReport, headline, MAX_BODY, type ErrorReport } from "../lib/errorReport";
import type { Env, User } from "./env";
import { HttpError, json, now, readBody } from "./http";

export const KEEP_PER_PC = 10;

export async function handleErrorReport(req: Request, env: Env, user: (User & { key_id?: string }) | null): Promise<Response> {
  const body = await readBody(req, MAX_BODY);
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(body));
  } catch {
    throw new HttpError(400, "Not JSON");
  }
  const report = cleanReport(raw);
  if (!report) throw new HttpError(400, "Not an error report");
  const uploader = report.kind === "uploader";
  // An Error named for where it happened, carrying the sender's own stack, so
  // Issues groups by the problem rather than by this line.
  const name = uploader ? "UploaderError" : "BrowserError";
  const err = new Error(headline(report));
  err.name = name;
  err.stack = `${name}: ${err.message}${report.stack ? `\n${report.stack}` : ""}`;
  const { stack: _stack, ...details } = report;
  console.error(err, JSON.stringify({ source: uploader ? "uploader" : "browser", ...details, userId: user?.id ?? undefined }));
  if (uploader && user?.key_id) await keep(env, user.key_id, report);
  return json({ ok: true });
}

async function keep(env: Env, keyId: string, r: ErrorReport): Promise<void> {
  const message = `${r.file ? `${r.file}${r.line ? ` line ${r.line}` : ""}: ` : ""}${r.message}`.slice(0, 300);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO upload_errors (key_id, t, area, message, app_version) VALUES (?, ?, ?, ?, ?)").bind(
      keyId, now(), r.security ? `${r.area}-security` : r.area!, message, r.app ?? null,
    ),
    env.DB.prepare(
      `DELETE FROM upload_errors WHERE key_id = ?1 AND id NOT IN
         (SELECT id FROM upload_errors WHERE key_id = ?1 ORDER BY id DESC LIMIT ${KEEP_PER_PC})`,
    ).bind(keyId),
    env.DB.prepare("UPDATE upload_keys SET os_version = COALESCE(?, os_version), app_version = COALESCE(?, app_version) WHERE id = ?").bind(
      r.os ?? null, r.app ?? null, keyId,
    ),
  ]);
}
