// Problems the site hears about, grouped so the same one shows once on the
// admin Problems page (worker/problems.ts stores them). Shared by the Worker
// and the pages; nothing here touches a saved file.

import type { ErrorReport } from "./errorReport";

// What kind of problem, as the Problems page and the players' notices name it.
export const PROBLEM_KINDS = ["upload", "signin", "page", "load", "boards", "addon"] as const;
export type ProblemKind = (typeof PROBLEM_KINDS)[number];

export const PROBLEM_STATUSES = ["open", "fixed", "hidden"] as const;
export type ProblemStatus = (typeof PROBLEM_STATUSES)[number];

export const KEEP_DAYS = 30;
export const KEEP_PER_ACCOUNT = 20;
export const KEEP_ANONYMOUS = 500;

// Why a Battle.net sign-in didn't finish (auth.ts), also the ?why= the
// home page reads to say what to do.
export const SIGNIN_REASONS = ["denied", "expired", "mismatch", "token", "userinfo", "account"] as const;
export type SigninReason = (typeof SIGNIN_REASONS)[number];

export function problemKindOf(r: ErrorReport): ProblemKind {
  if (r.kind === "upload") return "upload";
  if (r.kind === "load" || r.kind === "boards" || r.kind === "addon") return r.kind;
  return "page";
}

// Numbers and ids differ between two cases of the same problem; leave them
// out of the key so they group together.
export function normalizeMessage(message: string): string {
  return message
    .toLowerCase()
    .replace(/[0-9a-f]{8,}/g, "…")
    .replace(/\d+/g, "#")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

// The key two cases of the same problem share.
export function groupKey(kind: ProblemKind, where: string, message: string): string {
  return `${kind}|${where}|${normalizeMessage(message)}`;
}

// Where it happened, for the key and the title.
export function whereOf(r: ErrorReport): string {
  if (r.kind === "upload") return [r.step ?? "?", r.file].filter(Boolean).join(" ");
  if (r.kind === "crash" || r.kind === "promise" || r.kind === "render") return r.route ? `${r.kind} ${r.route}` : r.kind;
  if (r.kind === "load") return r.route ?? "";
  return "";
}

export function titleOf(r: ErrorReport): string {
  const where = whereOf(r);
  return (where ? `${where}: ${r.message}` : r.message).slice(0, 300);
}

// "Chrome 142 · Windows" from a User-Agent; never more than the browser's
// name, major version and the OS family.
export function browserOf(ua: string | null | undefined): string | undefined {
  if (!ua) return undefined;
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : undefined;
  const tests: [RegExp, string][] = [
    [/Edg\/(\d+)/, "Edge"],
    [/OPR\/(\d+)/, "Opera"],
    [/Firefox\/(\d+)/, "Firefox"],
    [/Chrome\/(\d+)/, "Chrome"],
    [/Version\/(\d+)[\d.]* .*Safari/, "Safari"],
  ];
  let browser: string | undefined;
  for (const [re, name] of tests) {
    const m = re.exec(ua);
    if (m) {
      browser = `${name} ${m[1]}`;
      break;
    }
  }
  return [browser, os].filter(Boolean).join(" · ") || undefined;
}

// Hosts we expect: blocking these is our own policy doing its job (the
// scripts Cloudflare adds), not something on the player's PC.
const EXPECTED_BLOCKS = [/(^|\.)cloudflareinsights\.com$/, /^inline$/];

// Something on the player's PC that tampers with pages: an ad blocker or an
// extension injecting its own scripts. Named for the player when we can.
export function interferenceOf(blocked: string[] | undefined): { name?: string; host: string } | undefined {
  for (const host of blocked ?? []) {
    if (EXPECTED_BLOCKS.some((re) => re.test(host))) continue;
    if (/adguard/.test(host)) return { name: "AdGuard", host };
    if (/ublock|ublockorigin/.test(host)) return { name: "uBlock Origin", host };
    if (/adblock/.test(host)) return { name: "AdBlock", host };
    if (/ghostery/.test(host)) return { name: "Ghostery", host };
    if (/kaspersky|kis\.v2\.scr/.test(host)) return { name: "Kaspersky", host };
    if (/avast|avg\.com/.test(host)) return { name: "Avast", host };
    if (/^eval$|^wasm-eval$/.test(host)) continue;
    return { host };
  }
  return undefined;
}

// What a player is told when a problem they hit is fixed.
export function noticeTitle(kind: string, hitAt: number): string {
  const what =
    kind === "upload" ? "upload problem" : kind === "signin" ? "sign-in problem" : kind === "addon" ? "Journey Forever addon error" : "problem";
  const day = new Date(hitAt * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `Fixed: the ${what} you hit on ${day}`;
}
