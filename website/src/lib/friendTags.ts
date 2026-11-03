// The parts of Battle.net friends that both the browser and the Worker
// use: hashing a BattleTag, and what a hash and a tag look like. See friends.ts.

export type FriendSource = "jf" | "rts";

export const MAX_FRIENDS = 1000;
const TAG = /^[^#|\p{Cc}]{1,40}#\d{1,10}$/u;

export function validTag(tag: unknown): tag is string {
  return typeof tag === "string" && TAG.test(tag);
}

// The same tag in any case is the same person: Battle.net shows them as typed.
export async function hashTag(tag: string): Promise<string> {
  const bytes = new TextEncoder().encode(`journey-forever friend:${tag.trim().toLowerCase()}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const HASH = /^[0-9a-f]{64}$/;
