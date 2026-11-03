// The reviewer's page: every reported character, from the first report.
// Only accounts listed in ADMIN_BNET_IDS can load it; the API answers
// "Not found" to anyone else.

import { useEffect, useState } from "preact/hooks";
import { api, type ReviewItem } from "../api";
import { classColor, date, describeCharacter, plural } from "../format";

type Status = "open" | "hidden" | "cleared";
const TABS: { id: Status; label: string }[] = [
  { id: "open", label: "Waiting" },
  { id: "hidden", label: "Hidden" },
  { id: "cleared", label: "Cleared" },
];

export function ReviewPage({ onCount }: { onCount?: (n: number) => void }) {
  const [status, setStatus] = useState<Status>("open");
  const [data, setData] = useState<{ items: ReviewItem[]; counts: Record<string, number> }>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<string>();

  const load = () =>
    api
      .review(status)
      .then((d) => {
        setData(d);
        if (status === "open") onCount?.(d.items.length);
      })
      .catch((e: Error) => setError(e.message));

  useEffect(() => {
    setData(undefined);
    setError(undefined);
    void load();
  }, [status]);

  const act = async (key: string, run: () => Promise<unknown>) => {
    setBusy(key);
    setError(undefined);
    try {
      await run();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <main class="page">
      <section class="lb-head">
        <div class="stack">
          <h1>Review</h1>
          <p class="lead">
            Every reported character, from the first report. It stays on the leaderboards until you hide it, unless 10 different established accounts
            (3 or more days old, with a character that has an hour played) have reported it: then it's held off until you clear or
            hide it. The automatic checks are here to help you decide; they never act on
            their own.
          </p>
        </div>
        <div class="lb-seg" role="group" aria-label="Show">
          {TABS.map((t) => (
            <button key={t.id} type="button" aria-pressed={status === t.id} onClick={() => setStatus(t.id)}>
              {t.label}
              {t.id !== "open" && data?.counts[t.id] ? ` (${data.counts[t.id]})` : t.id === "open" && status === "open" && data ? ` (${data.items.length})` : ""}
            </button>
          ))}
        </div>
      </section>
      {error && <div class="notice err">{error}</div>}
      {!data && !error && <p class="muted">Loading…</p>}
      {data && !data.items.length && (
        <div class="card flat">
          <p class="muted">{status === "open" ? "Nothing waiting. New reports will show up here." : status === "hidden" ? "No characters are hidden." : "Nothing cleared yet."}</p>
        </div>
      )}
      <div class="stack-lg">
        {data?.items.map((it) => {
          const key = it.slug ?? it.name;
          const counted = it.reports.filter((r) => r.counts);
          return (
            <article class="card rv-card" key={key}>
              <div class="row between">
                <div class="row" style={{ flexWrap: "nowrap", gap: "12px", minWidth: 0 }}>
                  <div class="avatar sm" style={{ background: classColor(it.className) }} aria-hidden="true">
                    {it.name.charAt(0)}
                  </div>
                  <div class="stack" style={{ gap: "0", minWidth: 0 }}>
                    <strong>{it.name}</strong>
                    <span class="tiny muted">
                      Level {it.level} {describeCharacter(it)} · {it.realm}
                      {it.boards ? ` · on ${plural(it.boards, "board")}, best #${it.bestRank}` : ""}
                      {!it.isPublic && " · now private"}
                    </span>
                  </div>
                </div>
                <span class={`rv-state${it.held || it.hidden ? " hi" : ""}`}>
                  {it.hidden ? "Hidden by you" : it.held ? "Held off boards" : status === "cleared" ? `Cleared ${it.clearedAt ? date(it.clearedAt) : ""}` : "Still listed"}
                  {status !== "cleared" && ` · ${plural(counted.length, "report")}`}
                </span>
              </div>

              {it.checks.length > 0 && (
                <div class="stack">
                  <span class="tiny muted rv-label">Automatic checks</span>
                  <ul class="rv-list">
                    {it.checks.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                </div>
              )}
              {!it.checks.length && <span class="tiny muted">Automatic checks found nothing.</span>}

              <div class="stack">
                <span class="tiny muted rv-label">Reports</span>
                <ul class="rv-list rv-reports">
                  {it.reports.map((r) => (
                    <li key={r.reporterId} class={r.counts ? undefined : "muted"}>
                      <div>
                        <strong>{r.reason}</strong>
                        {r.note && <span>: "{r.note}"</span>}
                      </div>
                      <div class="tiny muted">
                        {r.battletag ?? "Unknown account"} · {date(r.createdAt)} · {plural(r.sent, "report")} sent, {r.cleared} on characters you cleared
                        {r.ignored ? " · ignored" : !r.counts ? " · before you last cleared" : !r.established ? " · new account, doesn't count toward a hold" : ""}
                        {" · "}
                        <button
                          type="button"
                          class="linkish tiny"
                          disabled={!!busy}
                          onClick={() => act(`ign-${r.reporterId}`, () => api.ignoreReporter(r.reporterId, !r.ignored))}
                        >
                          {r.ignored ? "Stop ignoring this reporter" : "Ignore this reporter"}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>

              <div class="row" style={{ gap: "12px" }}>
                {it.slug && it.isPublic && (
                  <>
                    <a class="btn" href={`/j/${encodeURIComponent(it.slug)}`}>
                      Open journey
                    </a>
                    <a class="btn" href={`/j/${encodeURIComponent(it.slug)}/replay`}>
                      Open replay
                    </a>
                  </>
                )}
                <span class="push" />
                {it.slug && status !== "cleared" && (
                  <button type="button" class="btn" disabled={!!busy} onClick={() => act(`clr-${key}`, () => api.reviewAction(it.slug!, "clear"))}>
                    {status === "hidden" ? "Put back on boards" : "Clear flag"}
                  </button>
                )}
                {it.slug && status !== "hidden" && (
                  <button type="button" class="btn primary" disabled={!!busy} onClick={() => act(`hide-${key}`, () => api.reviewAction(it.slug!, "hide"))}>
                    Hide from leaderboards
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
      <p class="tiny muted">
        Hide takes a character off every board but leaves its journey public. Clear closes the flag and puts a held character back; accounts that
        already reported it can't report it again. Ignoring a reporter stops all their reports counting, past and future, without telling them.
      </p>
    </main>
  );
}
