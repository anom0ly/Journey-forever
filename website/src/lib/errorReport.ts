// Error reports the pages send to the Worker (POST /api/errors), which logs
// them so they show up in Cloudflare's Workers Issues next to the Worker's
// own errors. Shared by both sides: the page cleans a report before sending
// it, and the Worker cleans it again before logging, so nothing from a saved
// file and nothing about the player beyond what's listed here gets logged.

// The addons' saved files, as in parse/upload.ts (not imported, so the
// Worker doesn't bundle the parsers).
export const REPORT_FILES = ["RoadToSixty.lua", "JourneyTracker.lua", "JourneyForever.lua"];

// crash/promise/render: the page broke. upload: a step of the Upload page
// failed. load: a page couldn't load its data. boards: leaderboard numbers
// didn't save. addon: an error the Journey Forever addon caught in game and
// kept in its saved file. uploader: the Windows uploader.
export const REPORT_KINDS = ["crash", "promise", "render", "upload", "load", "boards", "addon", "uploader"] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

// pick: what was picked holds nothing to read (the wrong folder).
export const UPLOAD_STEPS = ["pick", "read", "preview", "save"] as const;
export type UploadStep = (typeof UPLOAD_STEPS)[number];

// The Windows uploader's reports (kind "uploader"): which part went wrong.
export const UPLOADER_AREAS = ["crash", "upload", "read", "addon", "update", "window"] as const;
export type UploaderArea = (typeof UPLOADER_AREAS)[number];

export interface ErrorReport {
  kind: ReportKind;
  message: string;
  stack?: string;
  route?: string; // the page, with names and keys taken out (routeOf)
  step?: UploadStep; // upload reports: where it stopped
  file?: string; // upload reports: which addon's saved file
  size?: number; // bytes of that file
  line?: number; // where in the file the parser stopped
  status?: number; // the API's answer, when saving failed
  blocked?: string[]; // what the page's security policy blocked: "inline", "eval" or a host (an ad blocker's, an extension's)
  network?: boolean; // the request never got an answer (blocked, or the connection dropped)
  char?: string; // the character being uploaded (signed-in reports only)
  at?: number; // addon reports: when it last happened in game (the PC's clock)
  times?: number; // addon reports: how many times
  // Uploader reports:
  area?: UploaderArea;
  app?: string; // uploader version
  addon?: string; // Journey Forever addon version on that PC
  os?: string; // Windows version, e.g. 10.0.26100
  webview?: string; // Edge WebView2 version, for window problems
  pc?: string; // a random id the uploader made, not the PC's name
  security?: boolean; // a check that guards the PC failed (a download's checksum)
}

export const MAX_MESSAGE = 300;
export const MAX_STACK = 1500;
export const MAX_BODY = 4000;
export const MAX_BLOCKED = 8;

// A blocked script or connection, as the browser names it, cut to its host:
// "inline" and "eval" stay, a URL becomes its host name.
export function blockedName(uri: string): string | undefined {
  if (uri === "inline" || uri === "eval" || uri === "wasm-eval") return uri;
  try {
    const host = new URL(uri).hostname.toLowerCase();
    return /^[a-z0-9.-]{1,80}$/.test(host) ? host : undefined;
  } catch {
    return undefined;
  }
}

// Quoted text in an error can be a value from a saved file (the Lua parser
// says `unexpected "Brannoc"`), and those hold other players' names. Keep
// one-character quotes ("=", "}") and "end of file", which say what the
// parser wanted; replace the rest.
//
// Also: BattleTags, and Windows user folders in paths (the uploader's
// errors name files), which hold the player's name.
export function redact(text: string): string {
  return text
    .replace(/"([^"\n]*)"/g, (all, inner: string) => (inner.length <= 1 || inner === "end of file" ? all : '"…"'))
    .replace(/[\p{L}\p{N}]{2,12}#\d{3,6}/gu, "<battletag>")
    .replace(/([A-Za-z]:[\\/](?:Users|Documents and Settings)[\\/])[^\\/'"\n]+/gi, "%USERPROFILE%")
    .replace(/(\/(?:home|Users)\/)[^/'"\n]+/g, "$1<user>");
}

// The parser's messages end in "(line N)"; keep the line apart so one
// problem in many files is one issue, not one per line number.
export function splitLine(message: string): { message: string; line?: number } {
  const m = /\s*\(line (\d+)\)\s*$/.exec(message);
  return m ? { message: message.slice(0, m.index), line: Number(m[1]) } : { message };
}

// Page paths name characters (/c/<Name-Realm>, /j/<slug>); keep the shape only.
export function routeOf(path: string): string {
  return path
    .replace(/^\/(c|j|compare)\/[^/]+/, "/$1/:id")
    .replace(/^(\/compare\/:id)\/[^/]+/, "$1/:id")
    .replace(/^\/leaderboards\/board\/([^/]+)\/[^/]+/, "/leaderboards/board/$1/:param")
    .slice(0, 100);
}

function text(v: unknown, max: number): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.replace(/[\u0000-\u0008\u000b-\u001f]/g, "").trim();
  return t ? redact(t).slice(0, max) : undefined;
}

function count(v: unknown, max: number): number | undefined {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max ? v : undefined;
}

// A report as it may be logged, or null when it isn't one.
export function cleanReport(raw: unknown): ErrorReport | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const kind = REPORT_KINDS.find((k) => k === r.kind);
  const message = text(r.message, MAX_MESSAGE);
  if (!kind || !message) return null;
  const out: ErrorReport = { kind, message };
  const stack = text(r.stack, MAX_STACK);
  if (stack) out.stack = stack;
  const route = typeof r.route === "string" ? routeOf(r.route) : undefined;
  if (route?.startsWith("/")) out.route = route;
  const step = UPLOAD_STEPS.find((s) => s === r.step);
  if (step) out.step = step;
  const file = REPORT_FILES.find((f) => f === r.file);
  if (file) out.file = file;
  const size = count(r.size, 1e9);
  if (size !== undefined) out.size = size;
  const line = count(r.line, 1e8);
  if (line !== undefined) out.line = line;
  const status = count(r.status, 599);
  if (status !== undefined) out.status = status;
  if (Array.isArray(r.blocked)) {
    const blocked = [...new Set(r.blocked.filter((b): b is string => typeof b === "string" && /^[a-z0-9.-]{1,80}$/.test(b)))].slice(0, MAX_BLOCKED);
    if (blocked.length) out.blocked = blocked;
  }
  if (r.network === true) out.network = true;
  if (typeof r.char === "string" && /^[\p{L}][\p{L} '-]{0,39}$/u.test(r.char)) out.char = r.char;
  if (kind === "addon") {
    const at = count(r.at, 4e9);
    if (at !== undefined) out.at = at;
    const times = count(r.times, 1e6);
    if (times !== undefined) out.times = times;
    const v = typeof r.addon === "string" && /^[\w.-]{1,20}$/.test(r.addon) ? r.addon : undefined;
    if (v) out.addon = v;
  }
  if (kind === "uploader") {
    const area = UPLOADER_AREAS.find((a) => a === r.area);
    if (!area) return null;
    out.area = area;
    for (const k of ["app", "addon", "os", "webview"] as const) {
      const v = typeof r[k] === "string" && /^[\w .()-]{1,40}$/.test(r[k] as string) ? (r[k] as string) : undefined;
      if (v) out[k] = v;
    }
    if (typeof r.pc === "string" && /^pc_[0-9a-f]{8,16}$/.test(r.pc)) out.pc = r.pc;
    if (r.security === true) out.security = true;
  }
  return out;
}

// The one line that names the problem: what Issues shows as its title.
export function headline(r: ErrorReport): string {
  if (r.kind === "uploader") return `Uploader ${r.area}${r.file ? ` ${r.file}` : ""}${r.security ? " (security)" : ""}: ${r.message}`;
  if (r.kind === "addon") return `Addon${r.addon ? ` ${r.addon}` : ""}: ${r.message}`;
  const where = r.kind === "upload" ? `upload ${r.step ?? "?"}${r.file ? ` ${r.file}` : ""}` : r.kind;
  return `Browser ${where}: ${r.message}`;
}
