// Reporting a public character that looks cheated. Reports go to the
// reviewer's page; the owner never sees who reported. The server enforces
// the limits (one report per account per character, 5 a day, not your own,
// and only from accounts that have uploaded a character).

import { useEffect, useRef, useState } from "preact/hooks";
import { api } from "../api";

const REASONS: [string, string][] = [
  ["impossible", "The numbers look impossible"],
  ["edited", "The journey looks edited or made up"],
  ["name", "Offensive name"],
  ["other", "Something else"],
];

export function ReportDialog({ slug, name, onClose }: { slug: string; name: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState("impossible");
  const [note, setNote] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "own" | "sending" | "sent">("loading");
  const [before, setBefore] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    ref.current?.showModal();
    api
      .myReport(slug)
      .then((r) => {
        if (r.own) return setState("own");
        if (r.report) {
          setBefore(true);
          setReason(r.report.reason);
          setNote(r.report.note ?? "");
        }
        setState("ready");
      })
      .catch((e: Error) => {
        setError(e.message);
        setState("ready");
      });
  }, [slug]);

  const send = async (e: Event) => {
    e.preventDefault();
    setError(undefined);
    setState("sending");
    try {
      await api.report(slug, reason, note);
      setState("sent");
    } catch (err) {
      setError((err as Error).message);
      setState("ready");
    }
  };

  return (
    <dialog ref={ref} class="confirm wide" aria-labelledby="report-title" onClose={onClose}>
      <h2 id="report-title">Report {name}</h2>
      {state === "own" ? (
        <p class="muted">This is your own character.</p>
      ) : state === "sent" ? (
        <p class="muted">Thanks for the report. It's been sent for review.</p>
      ) : (
        <form class="stack-lg" onSubmit={send} id="report-form">
          {before && <div class="notice small">You've reported {name} before. Sending again updates your report; it isn't counted twice.</div>}
          <fieldset class="lb-reasons">
            <legend class="small muted">What's wrong?</legend>
            {REASONS.map(([id, label]) => (
              <label key={id}>
                <input type="radio" name="reason" value={id} checked={reason === id} onChange={() => setReason(id)} />
                {label}
              </label>
            ))}
          </fieldset>
          <div class="stack">
            <label class="small muted" for="report-note">
              Anything to add (optional)
            </label>
            <textarea id="report-note" rows={3} maxLength={500} value={note} onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)} />
          </div>
          <p class="tiny muted">The owner won't see who reported. You can send up to 5 reports a day.</p>
        </form>
      )}
      {error && <div class="notice err">{error}</div>}
      <div class="row" style={{ justifyContent: "flex-end", gap: "12px" }}>
        <button type="button" class="btn" onClick={() => ref.current?.close()}>
          {state === "sent" || state === "own" ? "Close" : "Cancel"}
        </button>
        {(state === "ready" || state === "sending" || state === "loading") && (
          <button type="submit" form="report-form" class="btn primary" disabled={state !== "ready"}>
            {state === "sending" ? "Sending…" : before ? "Update report" : "Send report"}
          </button>
        )}
      </div>
    </dialog>
  );
}
