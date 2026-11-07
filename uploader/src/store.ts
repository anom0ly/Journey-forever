// What the uploader keeps on the PC, in %LOCALAPPDATA%\JourneyForever:
// config.json (the site, this PC's key, the WoW folder) and state.json
// (what was uploaded already, and the recent log for the status page).

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, statSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function homeDir(): string {
  if (process.env.JF_UPLOADER_HOME) return process.env.JF_UPLOADER_HOME;
  if (process.env.LOCALAPPDATA) return join(process.env.LOCALAPPDATA, "JourneyForever");
  return join(homedir(), ".journey-forever-uploader");
}

export interface Config {
  site: string;
  key?: string; // "dpapi:…", encrypted for this Windows user (see windows.ts protect)
  account?: string | null; // the BattleTag it was connected as
  forever?: string; // ...\World of Warcraft\_forever_
  paused?: boolean;
  startup?: boolean; // start with Windows (undefined = yes)
  pcId?: string; // random, for error reports (report.ts)
}

export interface LogLine {
  t: number; // seconds
  text: string;
  ok: boolean;
}

export interface State {
  signature?: string; // the saved files as last uploaded
  lastUploadAt?: number;
  known: string[]; // screenshot ids uploaded (or found on the site)
  ids: Record<string, string>; // "<name>|<size>|<mtime>" -> id, so files aren't hashed twice
  friendsHash?: string;
  addonCheckedAt?: number;
  addonVersion?: string;
  updateCheckedAt?: number;
  shortcutVersion?: string; // the Start menu entry was made by this version
  reported?: Record<string, number>; // error reports sent in the last day (report.ts)
  log: LogLine[];
}

const MAX_LOG = 30;

function readJson<T>(file: string, fallback: T): T {
  try {
    return { ...fallback, ...(JSON.parse(readFileSync(file, "utf8")) as T) };
  } catch {
    return fallback;
  }
}

// Written to a temporary file first, so a crash never leaves half a file.
function writeJson(file: string, v: unknown): void {
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify(v, null, 1));
  renameSync(`${file}.tmp`, file);
}

// The site's first address. Battle.net only signs people in on the site's
// main address now, so PCs set up with this one move to the new default.
export const OLD_SITE = "https://journey-forever.hi-anomoly.workers.dev";

export class Store {
  readonly dir: string;
  config: Config;
  state: State;

  constructor(defaultSite: string, dir = homeDir()) {
    this.dir = dir;
    mkdirSync(dir, { recursive: true });
    this.config = readJson<Config>(join(dir, "config.json"), { site: defaultSite });
    if (this.config.site === OLD_SITE && defaultSite !== OLD_SITE) {
      this.config.site = defaultSite;
      this.saveConfig();
    }
    this.state = readJson<State>(join(dir, "state.json"), { known: [], ids: {}, log: [] });
  }

  saveConfig(): void {
    writeJson(join(this.dir, "config.json"), this.config);
  }

  saveState(): void {
    writeJson(join(this.dir, "state.json"), this.state);
  }

  // The status page's "Recent", and uploader.log for when something's wrong.
  log(text: string, ok = true): void {
    this.state.log = [{ t: Math.floor(Date.now() / 1000), text, ok }, ...this.state.log].slice(0, MAX_LOG);
    this.saveState();
    this.debug(text);
  }

  debug(text: string): void {
    const file = join(this.dir, "uploader.log");
    try {
      if (existsSync(file) && statSync(file).size > 1e6) renameSync(file, `${file}.old`);
      appendFileSync(file, `${new Date().toISOString()} ${text}\n`);
    } catch {
      // logging must never stop an upload
    }
  }
}
