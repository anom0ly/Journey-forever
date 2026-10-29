import type { CharacterSummary, Journey } from "../lib/journey";

export interface Me {
  user: { id: string; battletag: string | null; lastUploadAt: number | null } | null;
  authMode: "battlenet" | "dev" | "unconfigured";
}

export interface StoredCharacter {
  key: string;
  summary: CharacterSummary;
  isPublic: boolean;
  slug: string | null;
  updatedAt: number;
  hasJourney: boolean;
}

export interface Screenshot {
  id: string;
  t: number;
  kind: string;
  label: string | null;
  file: string | null;
  width: number | null;
  height: number | null;
  url: string;
  thumb: string;
}

export interface AccountSummary {
  battletag: string | null;
  createdAt: number | null;
  lastUploadAt: number | null;
  characters: string[];
  publicLinks: string[];
  screenshots: number;
  screenshotBytes: number;
}

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.method && init.method !== "GET") headers.set("x-journey-forever", "1");
  const res = await fetch(path, { ...init, headers, credentials: "same-origin" });
  if (!res.ok) {
    let message = res.statusText;
    try {
      message = ((await res.json()) as { error?: string }).error ?? message;
    } catch {
      // not JSON
    }
    throw new ApiError(res.status, message);
  }
  return (await res.json()) as T;
}

export const api = {
  me: () => call<Me>("/api/me"),
  logout: () => call<{ ok: true }>("/auth/logout", { method: "POST" }),
  characters: () => call<{ characters: StoredCharacter[]; lastUploadAt: number | null }>("/api/characters"),
  character: (key: string) => call<StoredCharacter>(`/api/characters/${encodeURIComponent(key)}`),
  journey: (key: string) => call<Journey>(`/api/characters/${encodeURIComponent(key)}/journey`),
  screenshots: (key: string) => call<{ screenshots: Screenshot[] }>(`/api/characters/${encodeURIComponent(key)}/screenshots`),
  setPublic: (key: string, isPublic: boolean) =>
    call<StoredCharacter>(`/api/characters/${encodeURIComponent(key)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isPublic }),
    }),
  deleteCharacter: (key: string) => call<{ ok: true }>(`/api/characters/${encodeURIComponent(key)}`, { method: "DELETE" }),
  account: () => call<AccountSummary>("/api/account"),
  deleteAccount: (confirm: string) =>
    call<{ ok: true }>("/api/account", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirm }),
    }),
  publicJourney: (slug: string) => call<{ character: StoredCharacter; screenshots: Screenshot[] }>(`/api/public/${encodeURIComponent(slug)}`),
  publicJourneyData: (slug: string) => call<Journey>(`/api/public/${encodeURIComponent(slug)}/journey`),

  async saveJourney(journey: Journey, summary: CharacterSummary): Promise<StoredCharacter> {
    const key = encodeURIComponent(journey.character.key);
    const gz = await new Response(
      new Blob([JSON.stringify(journey)]).stream().pipeThrough(new CompressionStream("gzip")),
    ).arrayBuffer();
    await call(`/api/characters/${key}/journey`, {
      method: "PUT",
      headers: { "content-type": "application/octet-stream", "x-content-encoding": "gzip" },
      body: gz,
    });
    return call<StoredCharacter>(`/api/characters/${key}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(summary),
    });
  },

  async saveScreenshot(
    key: string,
    id: string,
    image: Blob,
    thumb: Blob | undefined,
    meta: { t: number; kind: string; label: string; file: string; width?: number; height?: number },
  ): Promise<void> {
    const base = `/api/characters/${encodeURIComponent(key)}/screenshots/${id}`;
    await call(base, { method: "PUT", headers: { "content-type": image.type, "x-shot": JSON.stringify(meta) }, body: image });
    if (thumb) await call(`${base}/thumb`, { method: "PUT", headers: { "content-type": thumb.type }, body: thumb });
  },
};
