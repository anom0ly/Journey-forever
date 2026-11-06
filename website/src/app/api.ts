import type { BoardEntry } from "../lib/boardDefs";
import type { CharacterSummary, Journey } from "../lib/journey";
import type { UploaderSettings } from "../lib/uploader";

export interface Me {
  user: { id: string; battletag: string | null; lastUploadAt: number | null; isAdmin?: boolean } | null;
  reviewCount?: number;
  authMode: "battlenet" | "dev" | "unconfigured";
}

export interface StoredCharacter {
  key: string;
  summary: CharacterSummary;
  isPublic: boolean;
  slug: string | null;
  updatedAt: number;
  hasJourney: boolean;
  boardState?: number; // 0 listed, 1 held by reports, 2 hidden after review
  boardsVersion?: number | null;
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

export interface PublicHit {
  name: string;
  realm: string;
  slug: string;
  level: number;
  className?: string;
  race?: string;
}

export interface BoardRow {
  rank: number;
  value: number;
  name: string;
  realm: string;
  slug: string;
  level: number;
  className?: string;
  race?: string;
  mine: boolean;
  friend?: boolean; // a Battle.net friend's (signed in only)
  overall?: number; // place on the whole board, when ranked among friends
}

export interface BoardPage {
  board: string;
  param: string;
  params?: string[];
  total: number;
  rows: BoardRow[];
  me?: BoardRow;
  friends?: BoardRow[]; // friends further down, nearest your own place
}

export interface BoardFilters {
  realm?: string;
  cls?: string;
  show?: "" | "mine" | "friends";
}

export interface FriendCharacter {
  name: string;
  realm: string;
  slug: string;
  level: number;
  className?: string;
  race?: string;
}

export interface FriendsInfo {
  visible: boolean; // "Show me to my Battle.net friends"
  updatedAt: number | null;
  counts: { jf: number; rts: number; total: number };
  friends: { characters: FriendCharacter[]; sources: ("jf" | "rts")[] }[];
  notOnSite: number;
}

export interface Rank {
  board: string;
  param: string;
  value: number;
  rank: number;
}

export interface ReviewReport {
  reporterId: string;
  battletag: string | null;
  reason: string;
  note: string | null;
  createdAt: number;
  sent: number;
  cleared: number;
  ignored: boolean;
  established: boolean; // counts toward a hold (account 3+ days old, 1+ hour played)
  counts: boolean;
}

export interface ReviewItem {
  slug: string | null;
  name: string;
  realm: string;
  level: number;
  className?: string;
  race?: string;
  isPublic: boolean;
  held: boolean;
  hidden: boolean;
  status: "open" | "hidden" | "cleared";
  openedAt: number;
  clearedAt: number | null;
  counted: number;
  boards: number;
  bestRank?: number;
  checks: string[];
  reports: ReviewReport[];
}

// A PC connected to the Windows uploader (Account page, admins only).
export interface UploaderPc {
  id: string;
  name: string;
  createdAt: number;
  lastSeenAt: number | null;
  lastUploadAt: number | null;
  ok: boolean | null; // how the last try went; null before the first
  message: string | null;
  appVersion: string | null;
  addonVersion: string | null;
}

// The admin Uploader health page: every connected PC, with its owner.
export interface UploaderHealthPc extends UploaderPc {
  battletag: string;
  osVersion: string | null;
  weekErrors: number;
  lastError: { t: number; area: string; message: string } | null;
}

// Uploader builds on GitHub and which ones an admin approved for self-update.
export interface UploaderBuild {
  version: string;
  publishedAt: string | null;
  sha256: string | null;
  size: number | null;
  approvedAt: number | null;
  changed: boolean; // approved, but GitHub's file is no longer the one approved
}
export interface UploaderBuilds {
  latest: string | null;
  error?: string;
  builds: UploaderBuild[];
}

export interface UploaderProblem {
  t: number;
  area: string;
  message: string;
  appVersion: string | null;
}

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.method && init.method !== "GET") headers.set("x-journey-forever", "1");
  let res = await fetch(path, { ...init, headers, credentials: "same-origin" });
  // The site limits how fast one person can send requests; a big upload can
  // reach that, so wait and send again (10, 20, then 30 seconds).
  for (let wait = 1; res.status === 429 && wait <= 3; wait++) {
    await new Promise((r) => setTimeout(r, wait * 10_000));
    res = await fetch(path, { ...init, headers, credentials: "same-origin" });
  }
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
  searchPublic: (q: string) => call<{ results: PublicHit[] }>(`/api/public?q=${encodeURIComponent(q)}`),
  publicJourneyData: (slug: string) => call<Journey>(`/api/public/${encodeURIComponent(slug)}/journey`),

  friends: () => call<FriendsInfo>("/api/friends"),
  saveFriends: (lists: Partial<Record<"jf" | "rts", string[]>>) =>
    call<FriendsInfo>("/api/friends", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(lists) }),
  setFriendsVisible: (visible: boolean) =>
    call<FriendsInfo>("/api/friends", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ visible }) }),
  forgetFriends: () => call<FriendsInfo>("/api/friends", { method: "DELETE" }),

  boardsMeta: () => call<{ realms: string[]; classes: string[] }>("/api/boards"),
  board: (id: string, o: BoardFilters & { param?: string; limit?: number; offset?: number } = {}) => {
    const q = new URLSearchParams();
    if (o.param) q.set("param", o.param);
    if (o.realm) q.set("realm", o.realm);
    if (o.cls) q.set("class", o.cls);
    if (o.show) q.set("show", o.show);
    if (o.limit) q.set("limit", String(o.limit));
    if (o.offset) q.set("offset", String(o.offset));
    return call<BoardPage>(`/api/boards/${encodeURIComponent(id)}?${q}`);
  },
  publicRanks: (slug: string) => call<{ ranks: Rank[] }>(`/api/public/${encodeURIComponent(slug)}/ranks`),
  ownRanks: (key: string) => call<{ ranks: Rank[] }>(`/api/characters/${encodeURIComponent(key)}/ranks`),
  saveBoards: (key: string, entries: BoardEntry[], checks: string[], version: number) =>
    call<{ ok: true }>(`/api/characters/${encodeURIComponent(key)}/boards`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entries, checks, version }),
    }),
  myReport: (slug: string) => call<{ report: { reason: string; note: string | null } | null; own: boolean }>(`/api/public/${encodeURIComponent(slug)}/report`),
  report: (slug: string, reason: string, note: string) =>
    call<{ ok: true; updated: boolean }>(`/api/public/${encodeURIComponent(slug)}/report`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason, note }),
    }),
  review: (status: "open" | "hidden" | "cleared") =>
    call<{ items: ReviewItem[]; counts: Record<string, number> }>(`/api/review?status=${status}`),
  reviewAction: (slug: string, action: "hide" | "clear") =>
    call<{ ok: true }>(`/api/review/${encodeURIComponent(slug)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    }),
  ignoreReporter: (id: string, ignore: boolean) =>
    call<{ ok: true }>(`/api/review/reporters/${encodeURIComponent(id)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ignore }),
    }),

  uploader: () => call<{ pcs: UploaderPc[]; settings: UploaderSettings }>("/api/uploader"),
  setUploaderSettings: (s: Partial<UploaderSettings>) =>
    call<UploaderSettings>("/api/uploader/settings", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(s) }),
  uploaderHealth: () => call<{ pcs: UploaderHealthPc[] }>("/api/admin/uploader"),
  uploaderBuilds: () => call<UploaderBuilds>("/api/admin/uploader/releases"),
  approveUploader: (version: string) => call<UploaderBuilds>(`/api/admin/uploader/releases/${encodeURIComponent(version)}`, { method: "POST" }),
  withdrawUploader: (version: string) => call<UploaderBuilds>(`/api/admin/uploader/releases/${encodeURIComponent(version)}`, { method: "DELETE" }),
  uploaderProblems: (id: string) => call<{ errors: UploaderProblem[] }>(`/api/admin/uploader/${encodeURIComponent(id)}/errors`),
  disconnectPc: (id: string) => call<{ pcs: UploaderPc[] }>(`/api/uploader/pcs/${encodeURIComponent(id)}`, { method: "DELETE" }),
  connectPc: (name: string, challenge: string) =>
    call<{ code: string }>("/api/uploader/connect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, challenge }),
    }),

  async saveJourney(journey: Journey, summary: CharacterSummary): Promise<StoredCharacter> {
    const key = encodeURIComponent(journey.character.key);
    const gz = await new Response(
      new Blob([JSON.stringify(journey)]).stream().pipeThrough(new CompressionStream("gzip")),
    ).arrayBuffer();
    // The summary first: it creates the character, which the journey needs.
    await call<StoredCharacter>(`/api/characters/${key}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(summary),
    });
    await call(`/api/characters/${key}/journey`, {
      method: "PUT",
      headers: { "content-type": "application/octet-stream", "x-content-encoding": "gzip" },
      body: gz,
    });
    return call<StoredCharacter>(`/api/characters/${key}`);
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
