// Error reports the pages send to the Worker (POST /api/errors), which logs
// them so they show up in Cloudflare's Workers Issues next to the Worker's
// own errors. Shared by both sides: the page cleans a report before sending
// it, and the Worker cleans it again before logging, so nothing from a saved
// file and nothing about the player beyond what's listed here gets logged.

// The addons' saved files, as in parse/upload.ts (not imported, so the
// Worker doesn't bundle the parsers).
export const REPORT_FILES = ["RoadToSixty.lua", "JourneyTracker.lua", "JourneyForever.lua"];

export const REPORT_KINDS = ["crash", "promise", "render", "upload"] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

export const UPLOAD_STEPS = ["read", "preview", "save"] as const;
export type UploadStep = (typeof UPLOAD_STEPS)[number];

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
}

export const MAX_MESSAGE = 300;
export const MAX_STACK = 1500;
export const MAX_BODY = 4000;

// Quoted text in an error can be a value from a saved file (the Lua parser
// says `unexpected "Brannoc"`), and those hold other players' names. Keep
// one-character quotes ("=", "}") and "end of file", which say what the
// parser wanted; replace the rest.
export function redact(text: string): string {
  return text.replace(/"([^"\n]*)"/g, (all, inner: string) => (inner.length <= 1 || inner === "end of file" ? all : '"…"'));
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
  return out;
}

// The one line that names the problem: what Issues shows as its title.
export function headline(r: ErrorReport): string {
  const where = r.kind === "upload" ? `upload ${r.step ?? "?"}${r.file ? ` ${r.file}` : ""}` : r.kind;
  return `Browser ${where}: ${r.message}`;
}
