import { useEffect, useRef, useState } from "preact/hooks";
import { duration } from "../../lib/insights";
import { km } from "../../lib/path";
import { api, type StoredCharacter } from "../api";
import { classColor, date, describeCharacter, time } from "../format";

export function PublicToggle({ c, onChange }: { c: StoredCharacter; onChange: (c: StoredCharacter) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const flip = async () => {
    setBusy(true);
    setError(undefined);
    try {
      onChange(await api.setPublic(c.key, !c.isPublic));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div class="stack">
      <button type="button" class="toggle" role="switch" aria-checked={c.isPublic} disabled={busy} onClick={flip}>
        <span class="track">
          <span class="knob" />
        </span>
        <span>{c.isPublic ? "Public journey" : "Private (only you)"}</span>
      </button>
      {error && <span class="tiny tone-red">{error}</span>}
    </div>
  );
}

export function shareUrl(slug: string): string {
  return `${location.origin}/j/${slug}`;
}

// Asks before deleting a character: the journey, public link and
// screenshots go; the saved files on the player's PC don't.
function DeleteButton({ c, onDeleted }: { c: StoredCharacter; onDeleted: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const remove = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await api.deleteCharacter(c.key);
      ref.current?.close();
      onDeleted();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button type="button" class="linkish small muted" onClick={() => ref.current?.showModal()}>
        Delete
      </button>
      <dialog ref={ref} class="confirm" aria-labelledby={`del-${c.key}`} onClose={() => setError(undefined)}>
        <h2 id={`del-${c.key}`}>Delete {c.summary.name}?</h2>
        <p class="muted">
          This removes the journey, the public link and all their screenshots from Journey Forever. Your saved files on your PC aren't
          touched, and uploading {c.summary.name} again brings them back.
        </p>
        {error && <div class="notice err">{error}</div>}
        <div class="row" style={{ justifyContent: "flex-end", gap: "12px" }}>
          <button type="button" class="btn" onClick={() => ref.current?.close()} disabled={busy}>
            Cancel
          </button>
          <button type="button" class="btn danger" onClick={remove} disabled={busy}>
            {busy ? "Deleting…" : "Delete"}
          </button>
        </div>
      </dialog>
    </>
  );
}

function Card({ c, onChange, onDeleted }: { c: StoredCharacter; onChange: (c: StoredCharacter) => void; onDeleted: () => void }) {
  const s = c.summary;
  const href = `/c/${encodeURIComponent(c.key)}`;
  return (
    <article class="card" style={{ border: "1px solid var(--line)" }}>
      <div class="row" style={{ flexWrap: "nowrap", gap: "16px" }}>
        <div class="avatar" style={{ background: classColor(s.className) }} aria-hidden="true">
          {s.name.charAt(0)}
        </div>
        <div class="stack" style={{ gap: "2px", minWidth: 0 }}>
          <a href={href} style={{ fontFamily: "var(--serif)", fontSize: "24px", fontWeight: 700, color: "var(--text)", textDecoration: "none" }}>
            {s.name}
          </a>
          <span class="small muted">
            {describeCharacter(s)} · {s.realm}
          </span>
        </div>
      </div>
      <div class="stack">
        <div class="row between small">
          <span>Level {s.level} of 60</span>
          <span class="muted">{s.played ? `${duration(s.played)} played` : ""}</span>
        </div>
        <div class="progress">
          <div style={{ width: `${Math.round((Math.min(60, s.level) / 60) * 100)}%` }} />
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "12px" }} class="tiny muted">
        <div class="stack" style={{ gap: "2px" }}>
          <span style={{ fontSize: "18px", color: "var(--text)", fontWeight: 600 }}>{s.quests}</span>quests
        </div>
        <div class="stack" style={{ gap: "2px" }}>
          <span style={{ fontSize: "18px", color: "var(--text)", fontWeight: 600 }}>{km(s.distance)}</span>km walked
        </div>
        <div class="stack" style={{ gap: "2px" }}>
          <span style={{ fontSize: "18px", color: "var(--text)", fontWeight: 600 }}>{s.deaths}</span>deaths
        </div>
      </div>
      <div class="row between" style={{ paddingTop: "16px", borderTop: "1px solid var(--line)" }}>
        <PublicToggle c={c} onChange={onChange} />
        <div class="row" style={{ gap: "20px" }}>
          <DeleteButton c={c} onDeleted={onDeleted} />
          <a href={href} class="small" style={{ fontWeight: 600, textDecoration: "none" }}>
            Open journey
          </a>
        </div>
      </div>
      {c.isPublic && c.slug && (
        <div class="tiny muted" style={{ marginTop: "-8px", overflowWrap: "anywhere" }}>
          Anyone with the link can view: <a href={`/j/${c.slug}`}>{shareUrl(c.slug).replace(/^https?:\/\//, "")}</a>
        </div>
      )}
    </article>
  );
}

export function CharactersPage() {
  const [chars, setChars] = useState<StoredCharacter[]>();
  const [last, setLast] = useState<number | null>(null);
  const [error, setError] = useState<string>();
  useEffect(() => {
    api
      .characters()
      .then((r) => {
        setChars(r.characters.sort((a, b) => b.summary.level - a.summary.level));
        setLast(r.lastUploadAt);
      })
      .catch((e: Error) => setError(e.message));
  }, []);
  const update = (c: StoredCharacter) => setChars((list) => list?.map((x) => (x.key === c.key ? c : x)));
  return (
    <main class="page">
      <div class="row between" style={{ alignItems: "flex-end", gap: "16px" }}>
        <div class="stack">
          <h1>Your characters</h1>
          <p class="muted">{last ? `Last upload ${date(last)}, ${time(last)}` : "Nothing uploaded yet"}</p>
        </div>
        <a class="btn primary" href="/upload">
          Upload a session
        </a>
      </div>
      {error && <div class="notice err">{error}</div>}
      {chars && !chars.length && (
        <div class="card flat">
          <h2>No characters yet</h2>
          <p class="muted">
            Upload your WTF folder after a session and every character with Road to Sixty, Journey Tracker or Journey Forever data shows up
            here. Want to see what it looks like first? <a href="/demo">Open the sample journey</a>.
          </p>
        </div>
      )}
      <div class="grid-cards">{chars?.map((c) => <Card key={c.key} c={c} onChange={update} onDeleted={() => setChars((list) => list?.filter((x) => x.key !== c.key))} />)}</div>
    </main>
  );
}
