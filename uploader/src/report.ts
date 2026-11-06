// Error reports: when something goes wrong, the uploader tells the site
// (POST /api/errors, kind "uploader") so it can be fixed without the player
// having to write in. What's sent is cleaned first: no BattleTag, character
// names, Windows user or PC name, and no paths into the user's folders. The
// site cleans it again (website/src/lib/errorReport.ts) and keeps the last 10
// per PC for the admin Uploader health page.
//
// Each distinct problem is sent at most once a day per PC, and not at all when
// "Send error reports" is off on the Account page. A crash is written to
// crash.json and sent on the next start.

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, release } from "node:os";
import { join } from "node:path";
import { splitLine, type UploaderArea } from "../../website/src/lib/errorReport";
import { UPLOADER_VERSION } from "../../website/src/lib/uploader";
import type { Store } from "./store";

export interface Problem {
  area: UploaderArea;
  message: string;
  file?: string; // a saved file's name, e.g. RoadToSixty.lua
  line?: number;
  stack?: string;
  security?: boolean; // a check that guards the PC failed (checksum, unexpected file)
  webview?: string;
}

// What a report must never carry, for this PC.
export interface Private {
  home?: string; // C:\Users\<name>
  user?: string; // Windows user name
  computer?: string; // PC name
  account?: string | null; // BattleTag
  forever?: string; // the WoW folder (may be under the user's folder, or named after them)
  characters?: string[];
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function scrub(text: string, p: Private): string {
  let out = text;
  const swap = (what: string | null | undefined, to: string, min = 2) => {
    if (!what || what.length < min) return;
    out = out.replace(new RegExp(escape(what).replace(/\\\\|\//g, "[\\\\/]"), "gi"), to);
  };
  swap(p.forever, "<WoW>", 4);
  swap(p.home, "%USERPROFILE%", 4);
  swap(p.account, "<battletag>");
  if (p.account) swap(p.account.split("#")[0], "<account>", 3);
  for (const c of p.characters ?? []) swap(c, "<character>", 3);
  // Names last, as whole words, so "Justin" doesn't eat parts of other words.
  for (const [what, to] of [[p.user, "<user>"], [p.computer, "<pc>"]] as const) {
    if (what && what.length >= 3) out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escape(what)}(?![\\p{L}\\p{N}])`, "giu"), to);
  }
  return out
    .replace(/(WTF[\\/]Account[\\/])[^'"\n]*?(?=[\\/]SavedVariables|['"\n]|$)/gi, "$1<account>")
    .replace(/[\p{L}\p{N}]{2,12}#\d{3,6}/gu, "<battletag>")
    .replace(/([A-Za-z]:[\\/](?:Users|Documents and Settings)[\\/])[^\\/'"\n]+/gi, "%USERPROFILE%");
}

// Problems that mean a download wasn't what it should be.
export function isSecurity(message: string): boolean {
  return /checksum|wrong size|unexpected download address|unexpected file in the addon zip/i.test(message);
}

const DAY = 86400;

export class Reporter {
  constructor(
    readonly store: Store,
    readonly opts: {
      key: () => string | undefined; // the upload key, when connected
      enabled: () => boolean; // "Send error reports" on the Account page
      private: () => Private;
      send?: typeof fetch;
    },
  ) {}

  // A random id for this PC, so reports from one PC can be told apart
  // without its name.
  get pcId(): string {
    const c = this.store.config;
    if (!c.pcId) {
      c.pcId = `pc_${[...crypto.getRandomValues(new Uint8Array(4))].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
      this.store.saveConfig();
    }
    return c.pcId;
  }

  // Never throws, never waits long: reporting must not get in the way.
  async report(p: Problem): Promise<boolean> {
    try {
      if (!this.opts.enabled()) return false;
      const priv = this.opts.private();
      const split = p.line === undefined ? splitLine(p.message) : { message: p.message, line: p.line };
      const message = scrub(split.message, priv).slice(0, 300);
      const t = Math.floor(Date.now() / 1000);
      const seen = (this.store.state.reported ??= {});
      const id = `${p.area}|${p.file ?? ""}|${message}`.slice(0, 200);
      if (t - (seen[id] ?? 0) < DAY) return false;
      for (const k of Object.keys(seen)) if (t - seen[k] >= DAY) delete seen[k];
      const body = {
        kind: "uploader",
        area: p.area,
        message,
        file: p.file,
        line: split.line,
        stack: p.stack ? scrub(p.stack, priv).slice(0, 1500) : undefined,
        security: p.security || undefined,
        app: UPLOADER_VERSION,
        addon: this.store.state.addonVersion,
        os: release(),
        webview: p.webview,
        pc: this.pcId,
      };
      const headers: Record<string, string> = { "content-type": "application/json", "x-journey-forever": "1" };
      const key = this.opts.key();
      if (key) headers.authorization = `Bearer ${key}`;
      const res = await (this.opts.send ?? fetch)(`${this.store.config.site}/api/errors`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        this.store.debug(`Error report not taken (${res.status})`);
        return false;
      }
      seen[id] = t;
      this.store.saveState();
      return true;
    } catch (e) {
      this.store.debug(`Couldn't send an error report: ${String(e)}`);
      return false;
    }
  }

  // A crash: kept on disk now, sent on the next start.
  static saveCrash(dir: string, e: unknown): void {
    const err = e instanceof Error ? e : new Error(String(e));
    try {
      writeFileSync(join(dir, "crash.json"), JSON.stringify({ message: `${err.name}: ${err.message}`, stack: err.stack }));
    } catch {
      // nowhere to write
    }
  }

  async sendCrash(): Promise<void> {
    const file = join(this.store.dir, "crash.json");
    if (!existsSync(file)) return;
    let crash: { message?: string; stack?: string } = {};
    try {
      crash = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      // half written: still say it crashed
    }
    rmSync(file, { force: true });
    await this.report({ area: "crash", message: crash.message || "The uploader stopped unexpectedly", stack: crash.stack });
  }
}

export function windowsPrivate(): Pick<Private, "home" | "user" | "computer"> {
  return { home: process.env.USERPROFILE || homedir(), user: process.env.USERNAME, computer: process.env.COMPUTERNAME };
}
