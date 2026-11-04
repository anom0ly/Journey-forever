// POST /api/errors: the pages' error reports (see lib/errorReport.ts). The
// report is checked, then logged with console.error, which is what Workers
// Issues groups and alerts on. Nothing is stored. Signed in or not, since a
// crash on a public journey matters as much; the usual rate limits apply.

import { cleanReport, headline, MAX_BODY } from "../lib/errorReport";
import { HttpError, json, readBody } from "./http";

export async function handleErrorReport(req: Request, userId: string | null): Promise<Response> {
  const body = await readBody(req, MAX_BODY);
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(body));
  } catch {
    throw new HttpError(400, "Not JSON");
  }
  const report = cleanReport(raw);
  if (!report) throw new HttpError(400, "Not an error report");
  // An Error named for where it happened, carrying the page's own stack, so
  // Issues groups by the problem rather than by this line.
  const err = new Error(headline(report));
  err.name = "BrowserError";
  err.stack = `BrowserError: ${err.message}${report.stack ? `\n${report.stack}` : ""}`;
  const { stack: _stack, ...details } = report;
  console.error(err, JSON.stringify({ source: "browser", ...details, userId: userId ?? undefined }));
  return json({ ok: true });
}
