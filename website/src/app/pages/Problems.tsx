// The admin Problems page: what went wrong for players on the site, grouped
// so the same problem shows once with everyone who hit it (worker/
// problems.ts). Mark one fixed with a note and every signed-in player who
// hit it sees that note on their next visit. Only accounts in ADMIN_BNET_IDS
// can load it; the API answers "Not found" to anyone else.

import { useEffect, useState } from "preact/hooks";
import { interferenceOf } from "../../lib/problems";
import { api, type ProblemGroup, type ProblemList } from "../api";
import { dateTime, plural } from "../format";

const KIND_LABEL: Record<string, string> = {
  upload: "Upload",
  signin: "Sign-in",
  page: "Page crash",
  load: "Page load",
  boards: "Leaderboards",
  addon: "Addon in game",
};
const KIND_PILL: Record<string, string> = { upload: "red", signin: "gold", page: "red", load: "", boards: "", addon: "lilac" };

const STATUSES = [
  ["open", "Open"],
  ["fixed", "Fixed"],
  ["hidden", "Noise"],
  ["all", "All"],
] as const;

function blockedOf(d: Record<string, unknown>): string[] {
  return Array.isArray(d.blocked) ? d.blocked.filter((b): b is string => typeof b === "string") : [];
}

// The detail fields worth a column, as short text.
function where(d: Record<string, unknown>): string {
  const bits = [d.step, d.file, d.why, d.route].filter((x): x is string => typeof x === "string");
  if (typeof d.status === "number") bits.push(`HTTP ${d.status}`);
  if (d.network === true) bits.push("no answer");
  if (typeof d.line === "number") bits.push(`line ${d.line}`);
  if (typeof d.times === "number" && d.times > 1) bits.push(`${d.times}×`);
  if (typeof d.addon === "string") bits.push(`addon ${d.addon}`);
  if (typeof d.via === "string") bits.push(`via ${d.via}`);
  if (typeof d.callback === "string") bits.push(d.callback);
  if (typeof d.says === "string") bits.push(`“${d.says}”`);
  return bits.join(" · ");
}

function size(d: Record<string, unknown>): string {
  return typeof d.size === "number" ? `${(d.size / 1e6).toFixed(1)} MB` : "";
}

function Group({ g, onChanged }: { g: ProblemGroup; onChanged: (message?: string) => void }) {
  const [open, setOpen] = useState(g.status === "open");
  const [fixing, setFixing] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const signedInPlayers = new Set(g.cases.filter((c) => c.signedIn).map((c) => c.battletag)).size;
  const withBlocked = g.cases.filter((c) => blockedOf(c.detail).length).length;
  const blockers = [...new Set(g.cases.map((c) => interferenceOf(blockedOf(c.detail))).filter(Boolean).map((x) => x!.name ?? x!.host))];

  const act = async (action: "fix" | "hide" | "reopen", text?: string) => {
    setBusy(true);
    setError(undefined);
    try {
      const r = await api.problemAction(g.id, action, text);
      setFixing(false);
      onChanged(
        action === "fix"
          ? `Marked fixed${r.notified ? `: ${plural(r.notified, "player")} will see your note` : ""}.`
          : action === "hide"
            ? "Marked as noise. It's still recorded, but no longer alerts."
            : "Opened again.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section class="card flat stack problem" style={{ gap: "10px" }}>
      <div class="row between" style={{ gap: "12px", alignItems: "flex-start" }}>
        <div class="stack" style={{ gap: "6px", flex: "1 1 320px", minWidth: 0 }}>
          <div class="row" style={{ gap: "6px" }}>
            <span class={`pill ${KIND_PILL[g.kind] ?? ""}`}>{KIND_LABEL[g.kind] ?? g.kind}</span>
            <span class="pill" style={{ background: "var(--surface-2)", color: "var(--muted)" }}>
              {g.players ? plural(g.players, "player") : "Not signed in"} · {plural(g.count, "time")}
            </span>
            {g.status === "fixed" && <span class="pill teal">Fixed {g.fixedAt ? dateTime(g.fixedAt) : ""}</span>}
            {g.status === "hidden" && <span class="pill">Noise</span>}
          </div>
          <code class="small" style={{ color: "var(--text)", overflowWrap: "anywhere" }}>{g.title}</code>
          <span class="tiny muted">
            First {dateTime(g.firstT)} · last {dateTime(g.lastT)}
            {withBlocked ? ` · page tampered with in ${withBlocked} of ${g.cases.length}` : ""}
            {blockers.length ? `: ${blockers.join(", ")}` : ""}
          </span>
          {g.note && <span class="tiny muted">Players were told: “{g.note}”</span>}
        </div>
        <div class="row" style={{ gap: "8px" }}>
          <button type="button" class="btn" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? "Hide who" : `Who (${g.cases.length})`}
          </button>
          {g.status !== "hidden" && (
            <button type="button" class="btn" disabled={busy} onClick={() => act("hide")} title="Stops Discord alerts for it too">
              Noise
            </button>
          )}
          {g.status !== "open" && (
            <button type="button" class="btn" disabled={busy} onClick={() => act("reopen")}>
              Reopen
            </button>
          )}
          {g.status !== "fixed" && (
            <button type="button" class="btn primary" disabled={busy} onClick={() => setFixing(!fixing)}>
              Mark fixed…
            </button>
          )}
        </div>
      </div>
      {error && <div class="notice err">{error}</div>}
      {fixing && (
        <div class="stack" style={{ gap: "8px", borderTop: "1px solid var(--line)", paddingTop: "12px" }}>
          <label class="small" for={`note-${g.id}`}>
            {signedInPlayers
              ? `Tell the ${plural(signedInPlayers, "signed-in player")} who hit it (shown on their next visit)`
              : "Nobody signed in hit it, so there's no one to tell; a note is kept here"}
          </label>
          <textarea
            id={`note-${g.id}`}
            rows={2}
            maxLength={500}
            class="input"
            placeholder="e.g. Uploads now work with AdGuard turned on. Please try again."
            value={note}
            onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)}
          />
          <span class="tiny muted">If it happens again after this, it opens again by itself.</span>
          <div class="row" style={{ gap: "8px" }}>
            <button type="button" class="btn primary" disabled={busy || !note.trim()} onClick={() => act("fix", note.trim())}>
              Mark fixed and tell them
            </button>
            <button type="button" class="btn" disabled={busy} onClick={() => act("fix")}>
              Mark fixed quietly
            </button>
          </div>
        </div>
      )}
      {open && (
        <div style={{ overflowX: "auto" }}>
          <table class="data nowrap">
            <thead>
              <tr>
                <th>When</th>
                <th>Player</th>
                <th>Character</th>
                <th>Browser</th>
                <th>Details</th>
                <th>Blocked or injected</th>
                <th>Size</th>
              </tr>
            </thead>
            <tbody>
              {g.cases.map((c, i) => (
                <tr key={i}>
                  <td>{dateTime(c.t)}</td>
                  <td>{c.battletag ?? <span class="muted">not signed in</span>}</td>
                  <td>{typeof c.detail.char === "string" ? c.detail.char : "–"}</td>
                  <td>{typeof c.detail.browser === "string" ? c.detail.browser : "–"}</td>
                  <td style={{ whiteSpace: "normal", minWidth: "200px" }}>{where(c.detail) || "–"}</td>
                  <td style={{ whiteSpace: "normal" }}>{blockedOf(c.detail).join(", ") || <span class="muted">none</span>}</td>
                  <td>{size(c.detail)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {g.count > g.cases.length && <p class="tiny muted">The newest {g.cases.length} of {g.count} shown.</p>}
        </div>
      )}
    </section>
  );
}

export function ProblemsPage({ onCount }: { onCount: (n: number) => void }) {
  const [status, setStatus] = useState<string>("open");
  const [data, setData] = useState<ProblemList>();
  const [error, setError] = useState<string>();
  const [tick, setTick] = useState(0);
  const [message, setMessage] = useState<string>();

  useEffect(() => {
    let live = true;
    setError(undefined);
    api
      .problems(status)
      .then((d) => {
        if (!live) return;
        setData(d);
        onCount(d.counts.open);
      })
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [status, tick]);

  const c = data?.counts;
  return (
    <main class="page">
      <section class="lb-head">
        <div class="stack">
          <h1>Problems</h1>
          <p class="lead">
            What went wrong for players on the site, in the browser and in game, grouped so each problem shows once. Reports carry no file
            contents. Mark a problem fixed with a note and everyone who hit it sees that note on their next visit. Kept for 30 days.
          </p>
        </div>
      </section>
      {error && <div class="notice err">{error}</div>}
      {message && <div class="notice ok" role="status">{message}</div>}
      {!data && !error && <p class="muted">Loading…</p>}
      {c && (
        <div class="stack-lg">
          <div class="row" style={{ gap: "12px", flexWrap: "wrap" }}>
            {[
              [c.open, "open problems"],
              [c.playersWeek, "players affected, 7 days"],
              [c.uploadersWeek, "players uploaded, 7 days"],
              [c.signinWeek, "sign-in failures, 7 days"],
            ].map(([n, label]) => (
              <div class="card flat" key={label} style={{ flex: "1 1 160px", padding: "14px 16px" }}>
                <div style={{ fontSize: "26px", fontWeight: 700 }}>{n}</div>
                <div class="tiny muted">{label}</div>
              </div>
            ))}
          </div>
          <div class="seg" role="group" aria-label="Show">
            {STATUSES.map(([id, label]) => (
              <button type="button" key={id} aria-pressed={status === id} onClick={() => setStatus(id)}>
                {label}
                {id !== "all" ? ` · ${c[id]}` : ""}
              </button>
            ))}
          </div>
          {!data!.groups.length ? (
            <div class="card flat">
              <p class="muted">{status === "open" ? "Nothing open. Everything players hit has been looked at." : "Nothing here."}</p>
            </div>
          ) : (
            data!.groups.map((g) => <Group key={`${g.id}-${g.status}`} g={g} onChanged={(m) => {
                  setMessage(m);
                  setTick((t) => t + 1);
                }} />)
          )}
        </div>
      )}
    </main>
  );
}
