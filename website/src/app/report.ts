// Sends what goes wrong in the browser to the Worker (POST /api/errors),
// which logs it for Cloudflare's Workers Issues. Without this, a page crash or
// a saved file the parsers can't read is only ever seen by the player.
// Reports are cleaned first (lib/errorReport.ts): never a file's contents.

import { cleanReport, routeOf, splitLine, type ErrorReport } from "../lib/errorReport";

// One broken page shouldn't send hundreds of reports.
const MAX_PER_PAGE = 8;
let sent = 0;
const seen = new Set<string>();

export function report(r: Omit<ErrorReport, "route">): void {
  try {
    const clean = cleanReport({ ...r, route: routeOf(location.pathname) });
    if (!clean) return;
    const key = `${clean.kind}|${clean.step ?? ""}|${clean.file ?? ""}|${clean.message}`;
    if (seen.has(key) || sent >= MAX_PER_PAGE) return;
    seen.add(key);
    sent++;
    void fetch("/api/errors", {
      method: "POST",
      headers: { "content-type": "application/json", "x-journey-forever": "1" },
      body: JSON.stringify(clean),
      credentials: "same-origin",
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // Reporting must never be the thing that breaks the page.
  }
}

function describe(err: unknown): { message: string; stack?: string } {
  if (err instanceof Error) return { message: `${err.name}: ${err.message}`, stack: err.stack };
  return { message: String(err) };
}

export function reportError(kind: "crash" | "promise" | "render", err: unknown): void {
  report({ kind, ...describe(err) });
}

// A saved file the site couldn't read, or an upload that stopped.
export function reportUpload(step: "read" | "preview" | "save", err: unknown, extra: { file?: string; size?: number; status?: number } = {}): void {
  const { message, stack } = typeof err === "string" ? { message: err, stack: undefined } : describe(err);
  const split = splitLine(message);
  const file = extra.file?.split(/[\\/]/).pop();
  report({ kind: "upload", step, stack, ...extra, file, message: split.message, line: split.line });
}

// Errors nothing else caught. Scripts from elsewhere (browser extensions)
// show up as "Script error." with no detail; those aren't ours.
export function installErrorReporting(): void {
  addEventListener("error", (e) => {
    if (!e.error && /^Script error\.?$/.test(e.message)) return;
    if (e.filename && !e.filename.startsWith(location.origin)) return;
    reportError("crash", e.error ?? e.message);
  });
  addEventListener("unhandledrejection", (e) => reportError("promise", e.reason));
}
