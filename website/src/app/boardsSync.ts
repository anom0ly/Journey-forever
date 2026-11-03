import { BOARDS_VERSION } from "../lib/boardDefs";
import { boardEntries, integrityChecks } from "../lib/boards";
import type { Journey } from "../lib/journey";
import { api, type StoredCharacter } from "./api";

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
      const j = await api.journey(c.key).catch(() => undefined);
      if (j) await saveBoards(j).catch(() => undefined);
    }
  } finally {
    running = false;
  }
}
