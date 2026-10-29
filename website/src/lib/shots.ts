// Pairs dropped screenshot files with the moments they show. The game names
// each file by the PC's local time it was taken (WoWScrnShot_MMDDYY_HHMMSS),
// and our addon logs every screenshot with the name it expects the file to
// get, the time, and how far the PC's clock is from UTC. A file is the
// logged shot of that name, else the one within a couple of minutes of it.
// Other files taken during a session are Print Screen shots, placed at the
// time they were taken.

import type { JEvent, Journey } from "./journey";
import { shotLabel } from "./insights";

export const SHOT_MATCH_SECONDS = 120;
const SESSION_SLACK_SECONDS = 300;

// Seconds since 1970 from a screenshot's file name, read as local time in
// the browser's time zone (the PC that took it, as a rule). undefined when
// the name isn't the game's.
export function shotTime(name: string, toEpoch: typeof localEpoch = localEpoch): number | undefined {
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
  time: number; // from the name, read in the browser's time zone
}

export function baseName(name: string): string {
  return name.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "");
}

// The file's time as the PC that saved the journey's clock had it: the name
// read as UTC, less the offset our addon saved. Without one, the browser's
// time zone is taken as the PC's.
function fileTime(f: ShotFile, j: Journey): number {
  if (j.utcOffset === undefined) return f.time;
  const utc = shotTime(f.name, (y, mo, d, h, mi, s) => Date.UTC(y, mo - 1, d, h, mi, s) / 1000);
  return utc === undefined ? f.time : utc - j.utcOffset;
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
  // A failed shot has no file. Two triggers at once share one file: the
  // first logged entry stands for it.
  const seenName = new Set<string>();
  for (const j of journeys) {
    for (const e of j.events) {
      if (e.k !== "shot" || e.failed) continue;
      if (typeof e.shot === "string") {
        if (seenName.has(e.shot)) continue;
        seenName.add(e.shot);
      }
      logged.push({ j, e });
    }
  }

  // Exact names first (gap -1), then the closest times, so each file and
  // each logged shot is used once.
  const pairs: { fi: number; li: number; gap: number }[] = [];
  files.forEach((f, fi) =>
    logged.forEach((l, li) => {
      if (typeof l.e.shot === "string" && l.e.shot === baseName(f.name)) {
        pairs.push({ fi, li, gap: -1 });
        return;
      }
      const gap = Math.abs(fileTime(f, l.j) - l.e.t);
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
    const j = journeys.find((x) => {
      const t = fileTime(f, x);
      return x.sessions.some((s) => t >= s.start - SESSION_SLACK_SECONDS && t <= s.end + SESSION_SLACK_SECONDS);
    });
    if (j) manual.push({ file: f, charKey: j.character.key, t: fileTime(f, j), kind: "manual", label: "Screenshot", manual: true });
    else unmatched.push(f);
  });
  matched.sort((a, b) => a.t - b.t);
  manual.sort((a, b) => a.t - b.t);
  return { matched, manual, unmatched };
}
