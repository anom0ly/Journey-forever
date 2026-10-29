// Pairs dropped screenshot files with the moments they show. The game names
// each file by the PC's local time it was taken (WoWScrnShot_MMDDYY_HHMMSS),
// and our addon logs every screenshot it takes with the realm's clock, so a
// file within a couple of minutes of a logged shot is that shot. Other
// files taken during a session are Print Screen shots, placed at the time
// they were taken.

import type { JEvent, Journey } from "./journey";
import { shotLabel } from "./insights";

export const SHOT_MATCH_SECONDS = 120;
const SESSION_SLACK_SECONDS = 300;

// Seconds since 1970 from a screenshot's file name, read as local time in
// the browser's time zone (the PC that took it, as a rule). undefined when
// the name isn't the game's.
export function shotTime(name: string, toEpoch = localEpoch): number | undefined {
  const m = /WoWScrnShot_(\d{2})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/i.exec(name);
  if (!m) return undefined;
  const [, mo, d, y, h, mi, s] = m.map(Number);
  return toEpoch(2000 + y, mo, d, h, mi, s);
}

function localEpoch(y: number, mo: number, d: number, h: number, mi: number, s: number): number {
  return Math.floor(new Date(y, mo - 1, d, h, mi, s).getTime() / 1000);
}

export interface ShotFile {
  name: string;
  time: number;
}

export interface Matched<F extends ShotFile> {
  file: F;
  charKey: string;
  t: number;
  kind: string;
  label: string;
  manual: boolean;
}

export interface ShotMatch<F extends ShotFile> {
  matched: Matched<F>[]; // logged by our addon
  manual: Matched<F>[]; // taken by hand during a session
  unmatched: F[]; // outside every session in this upload
}

export function matchShots<F extends ShotFile>(files: F[], journeys: Journey[]): ShotMatch<F> {
  const logged: { j: Journey; e: JEvent }[] = [];
  for (const j of journeys) for (const e of j.events) if (e.k === "shot") logged.push({ j, e });

  // Closest pairs first, so each file and each logged shot is used once.
  const pairs: { fi: number; li: number; gap: number }[] = [];
  files.forEach((f, fi) =>
    logged.forEach((l, li) => {
      const gap = Math.abs(f.time - l.e.t);
      if (gap <= SHOT_MATCH_SECONDS) pairs.push({ fi, li, gap });
    }),
  );
  pairs.sort((a, b) => a.gap - b.gap);
  const usedFile = new Set<number>(), usedLog = new Set<number>();
  const matched: Matched<F>[] = [];
  for (const p of pairs) {
    if (usedFile.has(p.fi) || usedLog.has(p.li)) continue;
    usedFile.add(p.fi);
    usedLog.add(p.li);
    const { j, e } = logged[p.li];
    matched.push({ file: files[p.fi], charKey: j.character.key, t: e.t, kind: String(e.kind ?? "manual"), label: shotLabel(j, e), manual: false });
  }

  const manual: Matched<F>[] = [];
  const unmatched: F[] = [];
  files.forEach((f, fi) => {
    if (usedFile.has(fi)) return;
    const j = journeys.find((x) => x.sessions.some((s) => f.time >= s.start - SESSION_SLACK_SECONDS && f.time <= s.end + SESSION_SLACK_SECONDS));
    if (j) manual.push({ file: f, charKey: j.character.key, t: f.time, kind: "manual", label: "Screenshot", manual: true });
    else unmatched.push(f);
  });
  matched.sort((a, b) => a.t - b.t);
  manual.sort((a, b) => a.t - b.t);
  return { matched, manual, unmatched };
}
