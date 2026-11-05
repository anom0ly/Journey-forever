// The uploader itself: watches the saved files, uploads after the game
// writes them, keeps the addon current, and connects this PC to the site.

import { duration } from "../../website/src/lib/insights";
import { UPLOADER_SETTINGS_DEFAULT, UPLOADER_VERSION, type UploaderSettings } from "../../website/src/lib/uploader";
import { installedVersion, keepAddonCurrent } from "./addon";
import { claimKey, SiteClient, SiteError } from "./client";
import { prepareImage, shotId } from "./images";
import type { Store } from "./store";
import { sync, type ShotSource, type SyncResult } from "./sync";
import { computerName, notify, openUrl, wowRunning } from "./windows";
import { addonDir, listSaved, listScreenshots, readSaved, signature } from "./wow";

const TICK_MS = 5_000;
const SETTLE_MS = 15_000; // the game writes several files; wait for it to finish
const RETRY_MS = 5 * 60_000;
const ADDON_EVERY_MS = 6 * 3600_000;
const ADDON_RETRY_MS = 10 * 60_000; // while WoW is open
const SETTINGS_EVERY_MS = 10 * 60_000;

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomSecret(): string {
  return [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// The notification after an upload: title, text, and the page to open.
export function uploadMessage(r: SyncResult, site: string): { title: string; body: string; url: string; log: string } | undefined {
  const shots = r.shots ? plural(r.shots, "screenshot") : "";
  if (r.characters.length === 1) {
    const c = r.characters[0];
    const level = c.fromLevel !== undefined && c.fromLevel !== c.toLevel ? `Level ${c.fromLevel} → ${c.toLevel}` : `Level ${c.toLevel}`;
    const body = [level, c.played ? `${duration(c.played)} played` : "", shots].filter(Boolean).join(" · ");
    const title = c.isNew ? `${c.name}'s journey is on the site` : `${c.name}'s journey is up to date`;
    return { title, body, url: `${site}/c/${encodeURIComponent(c.key)}`, log: `${c.name} uploaded${shots ? `, ${shots}` : ""}` };
  }
  if (r.characters.length > 1) {
    const names = r.characters.map((c) => `${c.name} (level ${c.toLevel})`).join(", ");
    return {
      title: `Uploaded ${plural(r.characters.length, "character")}`,
      body: [names, shots].filter(Boolean).join(" · "),
      url: `${site}/characters`,
      log: `${r.characters.map((c) => c.name).join(", ")} uploaded${shots ? `, ${shots}` : ""}`,
    };
  }
  if (r.shots) return { title: `${shots} uploaded`, body: "Added to your journey's timeline.", url: `${site}/characters`, log: `${shots} uploaded` };
  return undefined;
}

export interface Status {
  version: string;
  site: string;
  connected: boolean;
  account?: string | null;
  forever?: string;
  paused: boolean;
  busy?: string;
  characters: string[];
  lastUploadAt?: number;
  addonVersion?: string;
  addonNote?: string;
  error?: string;
  log: { t: number; text: string; ok: boolean }[];
}

export class Uploader {
  private timer: ReturnType<typeof setInterval> | undefined;
  private pendingSig: string | undefined;
  private pendingSince = 0;
  private retryAt = 0;
  private failing = false;
  private busy: string | undefined;
  private settings: UploaderSettings = { ...UPLOADER_SETTINGS_DEFAULT };
  private settingsAt = 0;
  private addonRetryAt = 0;
  private addonNote: string | undefined;
  private error: string | undefined;
  private characters: string[] = [];
  private verifier: string | undefined;
  private force = false;

  constructor(readonly store: Store, readonly port: () => number) {}

  get client(): SiteClient | undefined {
    const { site, key } = this.store.config;
    return key ? new SiteClient(site, key) : undefined;
  }

  start(): void {
    this.timer ??= setInterval(() => void this.tick().catch((e) => this.store.debug(`tick: ${String(e)}`)), TICK_MS);
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  status(): Status {
    const c = this.store.config, s = this.store.state;
    return {
      version: UPLOADER_VERSION,
      site: c.site,
      connected: !!c.key,
      account: c.account,
      forever: c.forever,
      paused: !!c.paused,
      busy: this.busy,
      characters: this.characters,
      lastUploadAt: s.lastUploadAt,
      addonVersion: s.addonVersion,
      addonNote: this.addonNote,
      error: this.error,
      log: s.log,
    };
  }

  uploadNow(): void {
    this.force = true;
    void this.tick();
  }

  setPaused(paused: boolean): void {
    this.store.config.paused = paused;
    this.store.saveConfig();
    this.store.log(paused ? "Paused" : "Resumed");
  }

  setForever(forever: string): void {
    this.store.config.forever = forever;
    this.store.saveConfig();
    this.store.state.signature = undefined; // read everything in the new folder
    this.store.saveState();
    this.store.log(`WoW folder set to ${forever}`);
    void this.tick();
  }

  // Opens the site's /connect page; Allow there sends the browser back to
  // /connected on this PC with a code, which connected() swaps for a key.
  async connect(): Promise<void> {
    this.verifier = randomSecret();
    const q = new URLSearchParams({ port: String(this.port()), challenge: await sha256Hex(this.verifier), pc: computerName() });
    await openUrl(`${this.store.config.site}/connect?${q}`);
  }

  async connected(code: string): Promise<{ ok: boolean; message: string }> {
    if (!this.verifier) return { ok: false, message: "This PC didn't ask to connect just now. Use Connect on the uploader page to start again." };
    try {
      const r = await claimKey(this.store.config.site, code, this.verifier);
      this.verifier = undefined;
      this.store.config.key = r.key;
      this.store.config.account = r.battletag;
      this.store.saveConfig();
      this.store.state.signature = undefined; // upload everything once
      this.store.saveState();
      this.error = undefined;
      this.store.log(`Connected${r.battletag ? ` as ${r.battletag}` : ""}`);
      void this.tick();
      return { ok: true, message: "This PC is connected. It will upload after each session." };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  }

  // Remove from this PC: the key is dropped on the site and here.
  async forget(): Promise<void> {
    await this.client?.forget().catch(() => undefined);
    this.store.config.key = undefined;
    this.store.saveConfig();
  }

  private disconnected(): void {
    this.store.config.key = undefined;
    this.store.saveConfig();
    this.error = "This PC was disconnected from the site.";
    this.store.log("Disconnected by the site (or the account isn't allowed to auto-upload)", false);
    void notify("This PC was disconnected", "Double-click the Journey Forever uploader to connect it again.");
  }

  private async loadSettings(client: SiteClient, fresh = false): Promise<boolean> {
    if (!fresh && Date.now() - this.settingsAt < SETTINGS_EVERY_MS) return true;
    try {
      this.settings = await client.settings();
      this.settingsAt = Date.now();
      return true;
    } catch (e) {
      if (e instanceof SiteError && [401, 403, 404].includes(e.status)) {
        this.disconnected();
        return false;
      }
      return true; // offline: keep the last ones
    }
  }

  private async tick(): Promise<void> {
    if (this.busy) return;
    const { forever, paused } = this.store.config;
    const client = this.client;
    if (!client || !forever || paused) return;
    const now = Date.now();

    const files = await listSaved(forever);
    const sig = signature(files);
    let due = this.force || (this.failing && now >= this.retryAt);
    if (!due && files.length && sig !== this.store.state.signature) {
      if (sig !== this.pendingSig) {
        this.pendingSig = sig;
        this.pendingSince = now;
      } else if (now - this.pendingSince >= SETTLE_MS) {
        due = true;
      }
    }
    if (due) {
      this.force = false;
      await this.upload(client, sig);
      return;
    }

    const s = this.store.state;
    if (now - (s.addonCheckedAt ?? 0) * 1000 >= ADDON_EVERY_MS || (this.addonRetryAt && now >= this.addonRetryAt)) {
      await this.checkAddon(client);
    }
  }

  private async upload(client: SiteClient, sig: string): Promise<void> {
    const { forever } = this.store.config;
    if (!forever) return;
    this.busy = "Uploading";
    try {
      if (!(await this.loadSettings(client, true))) return;
      const files = await listSaved(forever);
      const saved = await readSaved(files);
      const shots = this.settings.shots ? await listScreenshots(forever) : [];
      const st = this.store.state;
      const ids = st.ids;
      const idOf = async (f: ShotSource) => {
        const k = `${f.name}|${f.size}|${Math.round(f.mtime)}`;
        ids[k] ??= await shotId(await f.read());
        return ids[k];
      };
      const r = await sync(client, saved, shots, {
        shots: this.settings.shots,
        known: new Set(st.known),
        idOf,
        prepare: async (f) => prepareImage(f.name, await f.read()),
        friendsHash: st.friendsHash,
        progress: (text) => (this.busy = text),
      });
      // Only remember hashes of files still in the folder.
      const names = new Set(shots.map((f) => f.name));
      for (const k of Object.keys(ids)) if (!names.has(k.split("|")[0])) delete ids[k];
      st.known = [...new Set([...st.known, ...r.shotIds])].slice(-20_000);
      st.friendsHash = r.friendsHash;
      st.signature = sig;
      this.characters = [...new Set(saved.map((f) => f.path.split("/")).filter((p) => p[5] === "SavedVariables").map((p) => p[4]))];
      const msg = uploadMessage(r, this.store.config.site);
      const notes = r.notes.map((n) => `${n.path.split("/").pop()}: ${n.message}`);
      if (msg) st.lastUploadAt = Math.floor(Date.now() / 1000);
      this.store.log(msg?.log ?? "Checked, nothing new to upload");
      for (const n of notes) this.store.log(`Couldn't read ${n}`, false);
      this.failing = false;
      this.error = undefined;
      if (msg && this.settings.notify) await notify(msg.title, msg.body, msg.url);
      await client.status({
        ok: !notes.length,
        message: notes.length ? `Couldn't read ${notes[0]}` : (msg?.log ?? "Nothing new"),
        uploaded: !!msg,
        appVersion: UPLOADER_VERSION,
        addonVersion: (await installedVersion(addonDir(forever))) ?? undefined,
      });
    } catch (e) {
      if (e instanceof SiteError && e.status === 401) {
        this.disconnected();
        return;
      }
      const message = (e as Error).message || String(e);
      this.store.log(`Upload failed: ${message}`, false);
      this.error = `Upload failed: ${message}. Trying again in 5 minutes.`;
      this.retryAt = Date.now() + RETRY_MS;
      // One notification per run of failures, not one every 5 minutes.
      if (!this.failing && this.settings.notify) await notify("Couldn't upload", `${message}. I'll try again in 5 minutes.`);
      this.failing = true;
      await client.status({ ok: false, message, uploaded: false, appVersion: UPLOADER_VERSION });
    } finally {
      this.store.saveState();
      this.busy = undefined;
    }
  }

  private async checkAddon(client: SiteClient): Promise<void> {
    const { forever } = this.store.config;
    if (!forever) return;
    if (!(await this.loadSettings(client))) return;
    const st = this.store.state;
    st.addonCheckedAt = Math.floor(Date.now() / 1000);
    this.addonRetryAt = 0;
    const dir = addonDir(forever);
    if (!this.settings.addon) {
      st.addonVersion = await installedVersion(dir);
      this.addonNote = undefined;
      this.store.saveState();
      return;
    }
    this.busy = "Checking the addon";
    try {
      const r = await keepAddonCurrent(dir, { wowRunning });
      if (r.status === "installed" || r.status === "updated") {
        st.addonVersion = r.version;
        this.addonNote = undefined;
        const title = r.status === "installed" ? `Journey Forever addon ${r.version} installed` : `Journey Forever addon updated to ${r.version}`;
        this.store.log(title);
        if (this.settings.notify) await notify(title, "It loads next time you start WoW (or after /reload).");
      } else if (r.status === "waiting") {
        st.addonVersion = r.installed;
        this.addonNote = `Version ${r.version} is out. It installs when WoW is closed.`;
        this.addonRetryAt = Date.now() + ADDON_RETRY_MS;
      } else if (r.status === "current") {
        st.addonVersion = r.version;
        this.addonNote = undefined;
      } else if (r.status === "unknown") {
        st.addonVersion = r.installed;
      }
    } catch (e) {
      this.store.log(`Couldn't update the addon: ${(e as Error).message}`, false);
      this.addonRetryAt = Date.now() + ADDON_RETRY_MS * 3;
    } finally {
      this.store.saveState();
      this.busy = undefined;
    }
  }
}
