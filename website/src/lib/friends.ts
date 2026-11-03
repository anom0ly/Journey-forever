// Battle.net friends. Our addon saves the BattleTags of the player's
// Battle.net friends (JourneyForeverDB.friends) and Road to Sixty 1.19 saves
// one for each friend it syncs with (RoadToSixtyDB.friends[key].battleTag).
// The upload page hashes each tag here in the browser and sends only the
// hashes; the Worker hashes each user's own BattleTag the same way to match.

import { hashTag, MAX_FRIENDS, validTag, type FriendSource } from "./friendTags";
import { entries, isObj, list, num, str, type LuaValue } from "./lua";

export { hashTag, validTag, type FriendSource } from "./friendTags";

export interface FriendLists {
  jf?: { t: number; tags: string[] }; // the newest list from any character's file
  rts?: string[];
}

function unique(tags: string[]): string[] {
  const seen = new Map<string, string>();
  for (const t of tags) if (validTag(t) && !seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t);
  return [...seen.values()].slice(0, MAX_FRIENDS);
}

// JourneyForeverDB.friends = { t, tags = { ... } }
export function jfFriends(db: LuaValue | undefined): { t: number; tags: string[] } | undefined {
  if (!isObj(db) || !isObj(db.friends)) return undefined;
  const tags = list(db.friends.tags).map(str).filter((t): t is string => !!t);
  return { t: num(db.friends.t) ?? 0, tags: unique(tags) };
}

// RoadToSixtyDB.friends[key] = { battleTag, ... } (only the tag is read).
export function rtsFriends(db: LuaValue | undefined): string[] | undefined {
  if (!isObj(db) || !isObj(db.friends)) return undefined;
  const tags: string[] = [];
  for (const [, f] of entries(db.friends)) {
    const tag = isObj(f) ? str(f.battleTag) : undefined;
    if (tag) tags.push(tag);
  }
  return unique(tags);
}

// Adds what one saved file says to the lists so far: the newest addon list
// wins (every character's file has a copy), Road to Sixty's is account-wide.
export function addFriends(into: FriendLists, globals: Record<string, LuaValue>): void {
  const jf = "JourneyForeverDB" in globals ? jfFriends(globals.JourneyForeverDB) : undefined;
  if (jf && (!into.jf || jf.t > into.jf.t)) into.jf = jf;
  const rts = "RoadToSixtyDB" in globals ? rtsFriends(globals.RoadToSixtyDB) : undefined;
  if (rts) into.rts = unique([...(into.rts ?? []), ...rts]);
}

// How many different friends, counting someone on both lists once.
export function friendCount(f: FriendLists): { total: number; jf: number; rts: number; both: number } {
  const jf = new Set((f.jf?.tags ?? []).map((t) => t.toLowerCase()));
  const rts = new Set((f.rts ?? []).map((t) => t.toLowerCase()));
  const both = [...jf].filter((t) => rts.has(t)).length;
  return { total: jf.size + rts.size - both, jf: jf.size, rts: rts.size, both };
}

// What the upload sends: hashes per source. A source the upload didn't
// include is left out, so the stored list for it stays as it was.
export async function friendHashes(f: FriendLists): Promise<Partial<Record<FriendSource, string[]>>> {
  const out: Partial<Record<FriendSource, string[]>> = {};
  if (f.jf) out.jf = await Promise.all(f.jf.tags.map(hashTag));
  if (f.rts) out.rts = await Promise.all(f.rts.map(hashTag));
  return out;
}
