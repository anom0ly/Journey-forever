import type { BoardEntry } from "../lib/boardDefs";
import { JOURNEY_READ_LIMIT, readJsonCapped, send } from "../lib/send";
import type { CharacterSummary, Journey } from "../lib/journey";
import type { UploaderSettings } from "../lib/uploader";

export interface Me {
  user: {
    id: string;
    battletag: string | null;
    lastUploadAt: number | null;
    isAdmin?: boolean;
    // The Windows uploader: open to this account (admins, or everyone in Beta), and how many PCs are connected.
    uploader?: { allowed: boolean; beta: boolean; pcs: number };
  } | null;
  reviewCount?: number;
  problemCount?: number; // admins: problems open on the Problems page
  notices?: ProblemNotice[]; // problems this player hit that have since been fixed
  authMode: "battlenet" | "dev" | "unconfigured";
}

export interface ProblemNotice {
  id: string;
  kind: string;
  note: string;
  hitAt: number;
}

export interface ProblemCase {
  t: number;
  battletag: string | null;
  signedIn: boolean;
  detail: Record<string, unknown>;
}

export interface ProblemGroup {
  id: string;
  kind: string;
  title: string;
  status: "open" | "fixed" | "hidden";
  firstT: number;
  lastT: number;
  count: number;
  players: number;
  fixedAt: number | null;
  note: string | null;
  cases: ProblemCase[];
}

export interface ProblemList {
  groups: ProblemGroup[];
  counts: { open: number; fixed: number; hidden: number; playersWeek: number; uploadersWeek: number; signinWeek: number };
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
  waiting?: boolean; // the owner's own top place, waiting for review (rank is where it would be)
}

export interface BoardPage {
  board: string;
  param: string;
  params?: string[];
  total: number;
  rows: BoardRow[];
  me?: BoardRow;
  friends?: BoardRow[]; // friends further down, nearest your own place
  waiting?: number; // new top places on this board waiting for review
  mineWaiting?: BoardRow[]; // the viewer's own waiting places, numbered where they'd rank
}

// A character with new top places waiting for the reviewer.
export interface PlaceItem {
  slug: string;
  name: string;
  realm: string;
  level: number;
  className?: string;
  race?: string;
  uploadedAt: number;
  waitingSince: number;
  checks: string[];
  places: { board: string; param: string; value: number; rank: number; top: { value: number; name: string }[] }[];
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
  // Set when an upload's list wasn't stored: "limited" = changed more than
  // 10 times today, "off" = friends are switched off on the site.
  notSaved?: "limited" | "off";
}

export interface Rank {
  board: string;
  param: string;
  value: number;
  rank: number;
  waiting?: boolean; // the owner's top place waiting for review
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
  established: boolean; // counts toward a hold (account 3+ days old, a character first uploaded 2+ days before)
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
  newChecks: string[]; // check lines not seen when it was last cleared
  checksOpenedAt: number | null; // when a check last opened it
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
  lastOkAt: number | null; // last good check-in (an upload attempt that went well)
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
// The site switches for the uploader (admin Uploaders page).
export interface UploaderSwitches {
  beta: boolean;
  connect: boolean;
  minVersion: string | null;
}

// What the /uploader page offers: the newest approved build.
export interface UploaderDownload {
  beta: boolean;
  connect: boolean;
  version: string | null;
  sha256?: string;
  size?: number;
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

// maxBytes: stop reading the answer past this many bytes (journeys).
async function call<T>(path: string, init: RequestInit = {}, maxBytes?: number): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.method && init.method !== "GET") headers.set("x-journey-forever", "1");
  let res = await send(path, { ...init, headers, credentials: "same-origin" });
  // The site limits how fast one person can send requests; a big upload can
  // reach that, so wait and send again (10, 20, then 30 seconds).
  for (let wait = 1; res.status === 429 && wait <= 3; wait++) {
    await new Promise((r) => setTimeout(r, wait * 10_000));
    res = await send(path, { ...init, headers, credentials: "same-origin" });
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
  if (maxBytes) return readJsonCapped<T>(res, maxBytes);
  return (await res.json()) as T;
}

export const api = {
  me: () => call<Me>("/api/me"),
  problems: (status: string) => call<ProblemList>(`/api/admin/problems?status=${encodeURIComponent(status)}`),
  problemAction: (id: string, action: "fix" | "hide" | "reopen", note?: string) =>
    call<{ ok: true; notified: number }>(`/api/admin/problems/${encodeURIComponent(id)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, note }),
    }),
  dismissNotice: (id: string) => call<{ ok: true }>(`/api/notices/${encodeURIComponent(id)}`, { method: "DELETE" }),
  logout: () => call<{ ok: true }>("/auth/logout", { method: "POST" }),
  characters: () => call<{ characters: StoredCharacter[]; lastUploadAt: number | null }>("/api/characters"),
  character: (key: string) => call<StoredCharacter>(`/api/characters/${encodeURIComponent(key)}`),
  journey: (key: string) => call<Journey>(`/api/characters/${encodeURIComponent(key)}/journey`, {}, JOURNEY_READ_LIMIT),
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
  publicJourneyData: (slug: string) => call<Journey>(`/api/public/${encodeURIComponent(slug)}/journey`, {}, JOURNEY_READ_LIMIT),

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
  places: () => call<{ items: PlaceItem[] }>("/api/review/places"),
  placeAction: (slug: string, action: "approve" | "decline") =>
    call<{ ok: true }>(`/api/review/places/${encodeURIComponent(slug)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    }),
  recalcList: () => call<{ characters: { slug: string; name: string; boardsVersion: number | null }[] }>("/api/review/boards"),
  recalcSave: (slug: string, entries: BoardEntry[], checks: string[], version: number) =>
    call<{ ok: true }>(`/api/review/boards/${encodeURIComponent(slug)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entries, checks, version }),
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
  uploaderSwitches: () => call<UploaderSwitches>("/api/admin/uploader/switches"),
  setUploaderSwitches: (s: Partial<UploaderSwitches>) =>
    call<UploaderSwitches>("/api/admin/uploader/switches", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(s) }),
  uploaderDownload: () => call<UploaderDownload>("/api/uploader/download"),
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
