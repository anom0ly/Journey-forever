// Sends what goes wrong in the browser to the Worker (POST /api/errors),
// which logs it for Cloudflare's Workers Issues and keeps it for the admin
// Problems page. Without this, a page crash or a saved file the parsers
// can't read is only ever seen by the player. Reports are cleaned first
// (lib/errorReport.ts): never a file's contents.

import { blockedName, cleanReport, MAX_BLOCKED, routeOf, splitLine, type ErrorReport } from "../lib/errorReport";
import { interferenceOf } from "../lib/problems";

// One broken page shouldn't send hundreds of reports.
const MAX_PER_PAGE = 8;
let sent = 0;
const seen = new Set<string>();

// What tampers with the page from the player's PC: anything our security
// policy blocked, hosts an ad blocker added to that policy, and scripts
// from other sites that ended up in the page. Sent with every report, so a
// problem caused by an ad blocker says so.
const blocked = new Set<string>();
const OUR_SCRIPT_HOSTS = new Set(["wowhub.net"]);

function noteBlocked(name: string | undefined): void {
  if (name && blocked.size < MAX_BLOCKED * 2) blocked.add(name);
}

function injectedHosts(): string[] {
  const out: string[] = [];
  try {
    for (const s of Array.from(document.scripts)) {
      if (!s.src) continue;
      const host = new URL(s.src, location.href).hostname;
      if (host !== location.hostname && !OUR_SCRIPT_HOSTS.has(host)) out.push(host);
    }
  } catch {
    // never mind
  }
  return out;
}

export function pageTampering(): string[] {
  return [...new Set([...blocked, ...injectedHosts()])].slice(0, MAX_BLOCKED);
}

// An ad blocker or extension on the player's PC, when we can tell.
export function interference(): { name?: string; host: string } | undefined {
  return interferenceOf(pageTampering());
}

export function report(r: Omit<ErrorReport, "route">): void {
  try {
    const tampering = pageTampering();
    const clean = cleanReport({ ...r, route: routeOf(location.pathname), ...(tampering.length ? { blocked: tampering } : {}) });
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

// fetch() throws a TypeError when no answer came back at all: the request
// was blocked (an ad blocker, a firewall) or the connection dropped.
export function isNetworkError(err: unknown): boolean {
  return err instanceof TypeError && /fetch|network|load failed/i.test(err.message);
}

export function reportError(kind: "crash" | "promise" | "render", err: unknown): void {
  report({ kind, ...describe(err) });
}

// A saved file the site couldn't read, an upload that stopped, or a pick
// with nothing to read in it.
export function reportUpload(
  step: "pick" | "read" | "preview" | "save",
  err: unknown,
  extra: { file?: string; size?: number; status?: number; char?: string } = {},
): void {
  const { message, stack } = typeof err === "string" ? { message: err, stack: undefined } : describe(err);
  const split = splitLine(message);
  const file = extra.file?.split(/[\\/]/).pop();
  report({ kind: "upload", step, stack, ...extra, file, message: split.message, line: split.line, ...(isNetworkError(err) ? { network: true } : {}) });
}

// A page that couldn't load its data. "Not found" and "private" are normal
// answers, not problems.
export function reportLoad(err: unknown, status?: number): void {
  if (status === 401 || status === 403 || status === 404) return;
  report({ kind: "load", ...describe(err), status, ...(isNetworkError(err) ? { network: true } : {}) });
}

// Leaderboard numbers that didn't save after an upload or a version change.
export function reportBoards(err: unknown, status?: number): void {
  report({ kind: "boards", ...describe(err), status });
}

// Errors the Journey Forever addon caught in game, kept in its saved file.
// The newest few, once each (the Worker skips ones it already has).
export function reportAddonErrors(errors: { t: number; message: string; count: number; version?: string; character?: string }[]): void {
  for (const e of [...errors].sort((a, b) => b.t - a.t).slice(0, 4)) {
    report({ kind: "addon", message: e.message, at: e.t, times: e.count, addon: e.version, char: e.character });
  }
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
  addEventListener("securitypolicyviolation", (e) => {
    noteBlocked(blockedName(e.blockedURI));
    // An ad blocker that filters HTTPS rewrites our policy to let its own
    // script in; the extra host in the policy names it.
    for (const host of e.originalPolicy.match(/(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}/gi) ?? []) {
      const name = blockedName(host.includes("://") ? host : `https://${host}`);
      if (name && !OUR_POLICY_HOSTS.has(name)) noteBlocked(name);
    }
  });
}

// Hosts our own policy (public/_headers) names.
const OUR_POLICY_HOSTS = new Set(["wowhub.net", "fonts.googleapis.com", "fonts.gstatic.com"]);
