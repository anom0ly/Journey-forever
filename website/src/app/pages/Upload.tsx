import { useEffect, useState } from "preact/hooks";
import { duration } from "../../lib/insights";
import type { Journey, SourceInfo } from "../../lib/journey";
import { mergeJourneys, summarize, uploadDelta, type UploadDelta } from "../../lib/merge";
import { readUpload, type FileNote } from "../../lib/parse/upload";
import { km } from "../../lib/path";
import { matchShots, shotTime, type Matched, type ShotMatch } from "../../lib/shots";
import { api, type StoredCharacter } from "../api";
import { fromDrop, fromInput, merge, type Picked } from "../files";
import { classColor, describeCharacter, plural } from "../format";
import { prepareImage, previewUrl, sha256Hex } from "../images";
import { navigate } from "../router";

const ADDON_NAMES: Record<string, string> = { rts: "Road to Sixty", jt: "Journey Tracker", jf: "Journey Forever" };
const MISSING_MEANS: Record<string, string> = {
  rts: "no map path or timeline",
  jt: "gold breakdown unavailable",
  jf: "no screenshots or notes",
};
const KIND_TAG: Record<string, { tag: string; cls: string }> = {
  dungeon: { tag: "Dungeon", cls: "teal" },
  epic: { tag: "Epic loot", cls: "lilac" },
  blue: { tag: "Rare loot", cls: "lilac" },
  level: { tag: "Level up", cls: "gold" },
  death: { tag: "Death", cls: "red" },
  boss: { tag: "Boss", cls: "teal" },
  rare: { tag: "Rare", cls: "gold" },
  zone: { tag: "New zone", cls: "teal" },
  manual: { tag: "By hand", cls: "" },
};

export function sourcesLine(sources: SourceInfo[]): { text: string; ok: boolean } {
  const parts: string[] = [];
  let ok = true;
  for (const s of sources) {
    const name = ADDON_NAMES[s.addon];
    if (s.status === "ok") parts.push(s.version ? `${name} v${s.version}` : name);
    else if (s.status === "missing") {
      parts.push(`${name} missing: ${MISSING_MEANS[s.addon]}`);
      ok = false;
    } else {
      parts.push(`${name} ${s.status === "refused" ? "skipped (newer version)" : "unreadable"}`);
      ok = false;
    }
  }
  return { text: parts.join(" · "), ok };
}

interface ShotFile {
  name: string;
  time: number;
  file: File;
  id?: string;
  preview?: string;
}

interface Preview {
  journeys: Journey[];
  notes: FileNote[];
  stored: Map<string, StoredCharacter>;
  deltas: Map<string, UploadDelta>;
  shots: ShotMatch<ShotFile>;
  already: number; // screenshots uploaded before
  skipped: number;
}

function deltaText(d: UploadDelta): string {
  if (d.upToDate) return "Nothing new since last upload";
  const bits = [
    d.played ? duration(d.played) : undefined,
    d.quests ? plural(d.quests, "quest") : undefined,
    d.distance ? `${km(d.distance)} km walked` : undefined,
    d.deaths ? plural(d.deaths, "death") : undefined,
  ].filter(Boolean);
  return `${d.isNew ? "Whole journey so far" : "New session"}: ${bits.join(", ") || "no new activity"}`;
}

async function buildPreview(picked: Picked): Promise<Preview> {
  const texts = await Promise.all(picked.saved.map(async ({ path, file }) => ({ path, text: await file.text() })));
  const { journeys, notes } = readUpload(texts);
  const { characters } = await api.characters();
  const stored = new Map(characters.map((c) => [c.key, c]));
  const deltas = new Map(journeys.map((j) => [j.character.key, uploadDelta(stored.get(j.character.key)?.summary, j)]));

  const files: ShotFile[] = [];
  for (const file of picked.images) {
    const t = shotTime(file.name);
    if (t !== undefined) files.push({ name: file.name, time: t, file });
  }
  const shots = matchShots(files, journeys);

  // Leave out what's been uploaded before (IDs are hashes of the bytes).
  const existing = new Set<string>();
  await Promise.all(
    [...new Set([...shots.matched, ...shots.manual].map((m) => m.charKey))]
      .filter((k) => stored.has(k))
      .map(async (k) => (await api.screenshots(k)).screenshots.forEach((s) => existing.add(s.id))),
  );
  let already = 0;
  const fresh = async (list: Matched<ShotFile>[]) => {
    const out: Matched<ShotFile>[] = [];
    for (const m of list) {
      m.file.id = await sha256Hex(await m.file.file.arrayBuffer());
      if (existing.has(m.file.id)) already++;
      else out.push(m);
    }
    return out;
  };
  shots.matched = await fresh(shots.matched);
  shots.manual = await fresh(shots.manual);
  for (const m of [...shots.matched, ...shots.manual].slice(0, 60)) m.file.preview = await previewUrl(m.file.file).catch(() => undefined);
  return { journeys, notes, stored, deltas, shots, already, skipped: picked.skipped };
}

export function UploadPage() {
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [preview, setPreview] = useState<Preview>();
  const [picked, setPicked] = useState<Picked>();
  const [includeManual, setIncludeManual] = useState(true);
  const [done, setDone] = useState<string>();

  useEffect(() => () => {
    for (const m of [...(preview?.shots.matched ?? []), ...(preview?.shots.manual ?? [])]) if (m.file.preview) URL.revokeObjectURL(m.file.preview);
  }, [preview]);

  const take = async (p: Picked) => {
    const all = picked ? merge(picked, p) : p;
    setPicked(all);
    setError(undefined);
    setDone(undefined);
    if (!all.saved.length) {
      setPreview(undefined);
      setError(
        all.images.length
          ? "Got the screenshots. Now add the WTF account folder too, so we know which character and moment each one belongs to."
          : "No Road to Sixty, Journey Tracker or Journey Forever files in what you dropped. Drop the WTF\\Account\\<account> folder.",
      );
      return;
    }
    setBusy("Reading your saved files…");
    try {
      setPreview(await buildPreview(all));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(undefined);
    }
  };

  const save = async () => {
    if (!preview) return;
    setError(undefined);
    try {
      const toSave = preview.journeys.filter((j) => !preview.deltas.get(j.character.key)?.upToDate || !preview.stored.has(j.character.key));
      let n = 0;
      for (const j of toSave) {
        setBusy(`Saving ${j.character.name} (${++n} of ${toSave.length})…`);
        const before = preview.stored.get(j.character.key);
        const old = before?.hasJourney ? await api.journey(j.character.key).catch(() => undefined) : undefined;
        const merged = mergeJourneys(old, j);
        await api.saveJourney(merged, summarize(merged));
      }
      const shots = [...preview.shots.matched, ...(includeManual ? preview.shots.manual : [])];
      let i = 0;
      for (const s of shots) {
        setBusy(`Uploading screenshot ${++i} of ${shots.length}…`);
        if (!preview.stored.has(s.charKey) && !toSave.some((j) => j.character.key === s.charKey)) continue;
        const img = await prepareImage(s.file.file);
        await api.saveScreenshot(s.charKey, img.id, img.image, img.thumb, {
          t: s.t, kind: s.kind, label: s.label, file: s.file.name, width: img.width, height: img.height,
        });
      }
      setDone(`Saved ${plural(toSave.length, "character")} and ${plural(shots.length, "screenshot")}.`);
      setPreview(undefined);
      setPicked(undefined);
    } catch (e) {
      setError(`Saving stopped: ${(e as Error).message}. What was saved so far is kept; try again to finish.`);
    } finally {
      setBusy(undefined);
    }
  };

  const shots = preview ? [...preview.shots.matched, ...(includeManual ? preview.shots.manual : [])] : [];
  const sessions = preview ? preview.journeys.filter((j) => !preview.deltas.get(j.character.key)?.upToDate).length : 0;

  return (
    <main class="page narrow">
      <div class="stack">
        <h1>Upload today's session</h1>
        <p class="lead">
          Log out of WoW, then drop your account's WTF folder here, plus any screenshots from this session. We pick out the Road to Sixty,
          Journey Tracker and Journey Forever files for every character at once.
        </p>
      </div>

      <div
        class={`dropzone${over ? " over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={async (e) => {
          e.preventDefault();
          setOver(false);
          if (e.dataTransfer) take(await fromDrop(e.dataTransfer));
        }}
      >
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#E0B252" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 16V4" />
          <path d="M7 9l5-5 5 5" />
          <path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
        </svg>
        <span class="big">Drop your WTF account folder and screenshots here</span>
        <span class="muted">or choose them · screenshots are optional (.jpg, .png, .tga)</span>
        <div class="row" style={{ justifyContent: "center" }}>
          <label class="btn">
            Choose account folder
            <input
              type="file"
              // @ts-expect-error: not in Preact's types, supported by every current browser
              webkitdirectory
              multiple
              style={{ display: "none" }}
              onChange={(e) => take(fromInput((e.target as HTMLInputElement).files))}
            />
          </label>
          <label class="btn">
            Add screenshots
            <input type="file" accept=".jpg,.jpeg,.png,.tga" multiple style={{ display: "none" }} onChange={(e) => take(fromInput((e.target as HTMLInputElement).files))} />
          </label>
        </div>
      </div>

      <div class="notice stack" style={{ gap: "6px" }}>
        <span style={{ color: "var(--text)", fontWeight: 600 }}>Where to find them</span>
        <code style={{ color: "var(--text)" }}>World of Warcraft\_forever_\WTF\Account\[ACCOUNT]\</code>
        <span>Each character's saved files live inside it under [Realm]\[Character]\SavedVariables\. Nothing else in the folder is read or sent.</span>
        <code style={{ color: "var(--text)" }}>World of Warcraft\_forever_\Screenshots\</code>
        <span>Tip: you can drop the whole Screenshots folder. Only shots taken during a recorded session, and not uploaded before, are added.</span>
      </div>

      {busy && <div class="notice" role="status">{busy}</div>}
      {error && <div class="notice err" role="alert">{error}</div>}
      {done && (
        <div class="notice" role="status">
          {done} <a href="/characters">See your characters</a>.
        </div>
      )}

      {preview && (
        <section class="stack-lg">
          <div class="row between">
            <h2>What we found</h2>
            <button type="button" class="btn chip" onClick={() => { setPicked(undefined); setPreview(undefined); }}>
              Start over
            </button>
          </div>
          {preview.notes.map((n) => (
            <div class="notice err" key={n.path}>
              <span class="mono">{n.path}</span>: {n.message}
            </div>
          ))}
          <div class="list">
            {preview.journeys.map((j) => {
              const d = preview.deltas.get(j.character.key)!;
              const src = sourcesLine(j.sources);
              const refused = j.sources.filter((s) => s.status === "refused" || s.status === "error");
              return (
                <div class="item" key={j.character.key}>
                  <div class="avatar sm" style={{ background: classColor(j.character.className) }} aria-hidden="true">
                    {j.character.name.charAt(0)}
                  </div>
                  <div class="stack" style={{ flex: "1 1 220px", gap: "2px" }}>
                    <span style={{ fontWeight: 600 }}>{j.character.name}</span>
                    <span class="small muted">
                      {describeCharacter(j.character)} · level {d.fromLevel && d.fromLevel !== d.toLevel ? `${d.fromLevel} → ${d.toLevel}` : d.toLevel}
                    </span>
                    <span class="tiny" style={{ color: src.ok ? "var(--teal-hi)" : "var(--amber)" }}>
                      {src.text}
                    </span>
                    {refused.map((s) => (
                      <span class="tiny tone-red" key={s.addon}>
                        {s.message}
                      </span>
                    ))}
                  </div>
                  <span class="small" style={{ flex: "1 1 260px" }}>
                    {deltaText(d)}
                  </span>
                  <span class={`pill ${d.upToDate ? "" : "gold"}`}>{d.isNew ? "New character" : d.upToDate ? "Up to date" : "New session"}</span>
                </div>
              );
            })}
          </div>

          {(shots.length > 0 || preview.shots.manual.length > 0) && (
            <div class="card flat">
              <div class="row between">
                <span style={{ fontWeight: 600 }}>{plural(preview.shots.matched.length, "screenshot")} matched to your journey</span>
                <span class="small muted">Paired by the time the addon logged each one</span>
              </div>
              <div class="shots">
                {shots.slice(0, 60).map((s) => {
                  const tag = KIND_TAG[s.kind] ?? KIND_TAG.manual;
                  const j = preview.journeys.find((x) => x.character.key === s.charKey);
                  return (
                    <div class="shot" key={s.file.name}>
                      <div class="img">
                        {s.file.preview && <img src={s.file.preview} alt="" loading="lazy" />}
                        <span class={`pill ${tag.cls}`}>{tag.tag}</span>
                      </div>
                      <span class="what">{s.label}</span>
                      <span class="tiny muted">{j?.character.name}</span>
                    </div>
                  );
                })}
              </div>
              {preview.shots.manual.length > 0 && (
                <div class="row between small" style={{ paddingTop: "12px", borderTop: "1px solid var(--line)" }}>
                  <span class="muted">
                    {plural(preview.shots.manual.length, "more was", "more were")} taken by hand (Print Screen), not by the addon. They'll go on the
                    timeline at the moment they were taken.
                  </span>
                  <label class="row" style={{ gap: "8px", cursor: "pointer" }}>
                    <input type="checkbox" checked={includeManual} onChange={(e) => setIncludeManual((e.target as HTMLInputElement).checked)} style={{ width: "18px", height: "18px", accentColor: "var(--gold)" }} />
                    Include them
                  </label>
                </div>
              )}
            </div>
          )}
          {(preview.already > 0 || preview.shots.unmatched.length > 0) && (
            <p class="tiny muted">
              {[
                preview.already ? `${plural(preview.already, "screenshot")} already uploaded` : "",
                preview.shots.unmatched.length ? `${plural(preview.shots.unmatched.length, "screenshot")} from outside these sessions left out` : "",
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}

          <div class="row" style={{ justifyContent: "flex-end" }}>
            <button type="button" class="btn" onClick={() => navigate("/characters")}>
              Cancel
            </button>
            <button type="button" class="btn primary" disabled={!!busy || (!sessions && !shots.length)} onClick={save}>
              {sessions || shots.length ? `Save ${plural(sessions, "session")} and ${plural(shots.length, "screenshot")}` : "Nothing new to save"}
            </button>
          </div>
        </section>
      )}
    </main>
  );
}
