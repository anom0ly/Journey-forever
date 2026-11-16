import { BOARDS_VERSION } from "../lib/boardDefs";
import { boardEntries, integrityChecks } from "../lib/boards";
import type { Journey } from "../lib/journey";
import { api, ApiError, type StoredCharacter } from "./api";
import { reportBoards, reportLoad } from "./report";

// Works out a journey's leaderboard numbers and checks, and stores them.
// before is the journey stored before this upload, for the checks.
export async function saveBoards(j: Journey, before?: Journey): Promise<void> {
  await api.saveBoards(j.character.key, boardEntries(j), integrityChecks(j, before), BOARDS_VERSION);
}

// Characters uploaded before leaderboards existed (or before the numbers
// changed) get them worked out again, quietly, when their owner opens the
// characters page.
let running = false;
export async function backfillBoards(chars: StoredCharacter[]): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (const c of chars) {
      if (!c.hasJourney || (c.boardsVersion ?? 0) >= BOARDS_VERSION) continue;
      const j = await api.journey(c.key).catch((e: Error) => void reportLoad(e, e instanceof ApiError ? e.status : undefined));
      // Quiet for the player, but the boards would go stale: report it.
      if (j) await saveBoards(j).catch((e: Error) => reportBoards(e, e instanceof ApiError ? e.status : undefined));
    }
  } finally {
    running = false;
  }
}

// The admin's one-off: every public character's leaderboard numbers and
// checks worked out again from its stored journey, with today's rules.
export async function recalcAllBoards(onProgress: (done: number, total: number) => void): Promise<{ done: number; failed: string[] }> {
  const { characters } = await api.recalcList();
  const failed: string[] = [];
  let done = 0;
  onProgress(0, characters.length);
  for (const c of characters) {
    try {
      const j = await api.publicJourneyData(c.slug);
      await api.recalcSave(c.slug, boardEntries(j), integrityChecks(j), BOARDS_VERSION);
      done++;
    } catch {
      failed.push(c.name);
    }
    onProgress(done + failed.length, characters.length);
  }
  return { done, failed };
}
