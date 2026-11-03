// The signed-in user's Battle.net friends on the site, fetched once and
// shared by every page (compare pickers, journey pages, the account page).

import { useEffect, useState } from "preact/hooks";
import { api, type FriendCharacter, type FriendsInfo } from "./api";
import { useMe } from "./me";

let cached: Promise<FriendsInfo | null> | undefined;
const listeners = new Set<(f: FriendsInfo | null) => void>();

function load(): Promise<FriendsInfo | null> {
  cached ??= api.friends().catch(() => null);
  return cached;
}

// After an upload, the switch or "forget": every page sees the new list.
export function setFriends(info: FriendsInfo | null): void {
  cached = Promise.resolve(info);
  for (const l of listeners) l(info);
}

export function forgetFriendsCache(): void {
  cached = undefined;
}

export function useFriends(): FriendsInfo | null {
  const me = useMe();
  const [info, setInfo] = useState<FriendsInfo | null>(null);
  useEffect(() => {
    if (!me?.user) return;
    let live = true;
    load().then((f) => live && setInfo(f));
    listeners.add(setInfo);
    return () => {
      live = false;
      listeners.delete(setInfo);
    };
  }, [me?.user?.id]);
  return me?.user ? info : null;
}

// Friends' public characters, closest in level to `level` first.
export function friendCharacters(info: FriendsInfo | null, level?: number): FriendCharacter[] {
  const all = (info?.friends ?? []).flatMap((f) => f.characters);
  return level === undefined ? all : [...all].sort((a, b) => Math.abs(a.level - level) - Math.abs(b.level - level) || a.name.localeCompare(b.name));
}

export function friendSlugs(info: FriendsInfo | null): Set<string> {
  return new Set(friendCharacters(info).map((c) => c.slug));
}
