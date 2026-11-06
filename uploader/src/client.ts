// Talking to the site with this PC's upload key. The key can only upload
// (website/src/worker/uploader.ts), and only for admins for now.

import type { StoredCharacter } from "../../website/src/app/api";
import type { BoardEntry } from "../../website/src/lib/boardDefs";
import type { CharacterSummary, Journey } from "../../website/src/lib/journey";
import type { ApprovedUploader, UploaderSettings } from "../../website/src/lib/uploader";
import type { PreparedImage } from "./images";
import type { Client, ShotMeta } from "./sync";

export class SiteError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

// JSON that's safe in a header: anything past ASCII as \u escapes.
export function asciiJson(v: unknown): string {
  return JSON.stringify(v).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface StatusReport {
  ok: boolean;
  message: string;
  uploaded: boolean;
  appVersion: string;
  addonVersion?: string;
}

export class SiteClient implements Client {
  constructor(readonly site: string, private readonly key: string) {}

  async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${this.key}`);
    headers.set("x-journey-forever", "1");
    let res = await fetch(this.site + path, { ...init, headers });
    // The site limits how fast one account can send; a first upload with
    // many screenshots can reach that, so wait and send again.
    for (let n = 1; res.status === 429 && n <= 6; n++) {
      await wait(n * 10_000);
      res = await fetch(this.site + path, { ...init, headers });
    }
    if (!res.ok) {
      let message = res.statusText;
      try {
        message = ((await res.json()) as { error?: string }).error ?? message;
      } catch {
        // not JSON
      }
      throw new SiteError(res.status, message);
    }
    return (await res.json()) as T;
  }

  private send<T>(path: string, method: string, body: unknown): Promise<T> {
    return this.call<T>(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  }

  async characters(): Promise<StoredCharacter[]> {
    return (await this.call<{ characters: StoredCharacter[] }>("/api/characters")).characters;
  }

  async journey(key: string): Promise<Journey | undefined> {
    try {
      return await this.call<Journey>(`/api/characters/${encodeURIComponent(key)}/journey`);
    } catch (e) {
      if (e instanceof SiteError && e.status === 404) return undefined;
      throw e;
    }
  }

  async screenshotIds(key: string): Promise<string[]> {
    const r = await this.call<{ screenshots: { id: string }[] }>(`/api/characters/${encodeURIComponent(key)}/screenshots`);
    return r.screenshots.map((s) => s.id);
  }

  async saveJourney(journey: Journey, summary: CharacterSummary): Promise<void> {
    const key = encodeURIComponent(journey.character.key);
    // The summary first: it creates the character, which the journey needs.
    await this.send(`/api/characters/${key}`, "PUT", summary);
    await this.call(`/api/characters/${key}/journey`, {
      method: "PUT",
      headers: { "content-type": "application/octet-stream", "x-content-encoding": "gzip" },
      body: Bun.gzipSync(new TextEncoder().encode(JSON.stringify(journey))),
    });
  }

  async saveBoards(key: string, entries: BoardEntry[], checks: string[], version: number): Promise<void> {
    await this.send(`/api/characters/${encodeURIComponent(key)}/boards`, "PUT", { entries, checks, version });
  }

  async saveScreenshot(key: string, img: PreparedImage, meta: ShotMeta): Promise<void> {
    const base = `/api/characters/${encodeURIComponent(key)}/screenshots/${img.id}`;
    await this.call(base, { method: "PUT", headers: { "content-type": img.type, "x-shot": asciiJson(meta) }, body: img.image });
    if (img.thumb) await this.call(`${base}/thumb`, { method: "PUT", headers: { "content-type": "image/jpeg" }, body: img.thumb });
  }

  async saveFriends(lists: Partial<Record<"jf" | "rts", string[]>>): Promise<void> {
    await this.send("/api/friends", "PUT", lists);
  }

  settings(): Promise<UploaderSettings> {
    return this.call<UploaderSettings>("/api/uploader/settings");
  }

  // The build an admin approved for self-update.
  latest(): Promise<ApprovedUploader> {
    return this.call<ApprovedUploader>("/api/uploader/latest");
  }

  async forget(): Promise<void> {
    await this.call("/api/uploader/self", { method: "DELETE" });
  }

  async status(r: StatusReport): Promise<void> {
    await this.send("/api/uploader/status", "POST", r).catch(() => undefined);
  }
}

// Swapping the connect code (and the secret only this PC knows) for a key.
export async function claimKey(site: string, code: string, verifier: string): Promise<{ key: string; battletag: string | null }> {
  const res = await fetch(`${site}/api/uploader/claim`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-journey-forever": "1" },
    body: JSON.stringify({ code, verifier }),
  });
  const body = (await res.json().catch(() => ({}))) as { key?: string; battletag?: string | null; error?: string };
  if (!res.ok || !body.key) throw new SiteError(res.status, body.error ?? "Couldn't connect");
  return { key: body.key, battletag: body.battletag ?? null };
}
