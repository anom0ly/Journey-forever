// The reviewer's page: every reported character, from the first report,
// and every character an automatic check has found something new on.
// Only accounts listed in ADMIN_BNET_IDS can load it; the API answers
// "Not found" to anyone else.

import { useEffect, useState } from "preact/hooks";
import { BOARD_BY_ID, boardTitle, formatValue } from "../../lib/boardDefs";
import { api, type PlaceItem, type ReviewItem } from "../api";
import { recalcAllBoards } from "../boardsSync";
import { classColor, date, dateTime, describeCharacter, plural } from "../format";

type Status = "open" | "hidden" | "cleared";
const TABS: { id: Status | "places"; label: string }[] = [
  { id: "open", label: "Waiting" },
  { id: "places", label: "Top places" },
  { id: "hidden", label: "Hidden" },
  { id: "cleared", label: "Cleared" },
];

export function ReviewPage({ onCount }: { onCount?: (n: number) => void }) {
  const [status, setStatus] = useState<Status | "places">("open");
  const [places, setPlaces] = useState<PlaceItem[]>();
  const [data, setData] = useState<{ items: ReviewItem[]; counts: Record<string, number> }>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const [recalc, setRecalc] = useState<string>();
  const [recalcing, setRecalcing] = useState(false);

  const recalcAll = async () => {
    setRecalcing(true);
    setRecalc("Starting…");
    try {
      const r = await recalcAllBoards((n, total) => setRecalc(`Recalculating ${n} of ${total}…`));
      setRecalc(`Recalculated ${plural(r.done, "public character")}.${r.failed.length ? ` Couldn't do: ${r.failed.join(", ")}.` : ""}`);
      await load();
    } catch (e) {
      setRecalc(`Couldn't recalculate: ${(e as Error).message}`);
    } finally {
      setRecalcing(false);
    }
  };

  // The nav badge counts both: reports and checks waiting, and characters
  // with top places waiting.
  const load = async () => {
    try {
      const p = await api.places();
      setPlaces(p.items);
      if (status === "places") return;
      const d = await api.review(status);
      setData(d);
      if (status === "open") onCount?.(d.items.length + p.items.length);
    } catch (e) {
      setError((e as Error).message);
    }
  };

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
            Every reported character, and every character an automatic check has found something new on. A reported character stays on the
            leaderboards until you hide it, unless 10 different established accounts (3 or more days old, with a character first uploaded at
            least 2 days before the report) have reported it: then it's held off until you clear or hide it. Automatic checks open an item for you to look at, but
            never hold or hide anyone on their own.
          </p>
        </div>
        <div class="lb-seg" role="group" aria-label="Show">
          {TABS.map((t) => (
            <button key={t.id} type="button" aria-pressed={status === t.id} onClick={() => setStatus(t.id)}>
              {t.label}
              {t.id === "places"
                ? places?.length
                  ? ` (${places.length})`
                  : ""
                : t.id !== "open" && data?.counts[t.id]
                  ? ` (${data.counts[t.id]})`
                  : t.id === "open" && status === "open" && data
                    ? ` (${data.items.length})`
                    : ""}
            </button>
          ))}
        </div>
      </section>
      {error && <div class="notice err">{error}</div>}
      {status === "places" && <TopPlaces items={places} busy={busy} act={act} />}
      {status !== "places" && !data && !error && <p class="muted">Loading…</p>}
      {status !== "places" && data && !data.items.length && (
        <div class="card flat">
          <p class="muted">{status === "open" ? "Nothing waiting. New reports and new automatic check lines will show up here." : status === "hidden" ? "No characters are hidden." : "Nothing cleared yet."}</p>
        </div>
      )}
      <div class="stack-lg">
        {status !== "places" && data?.items.map((it) => {
          const key = it.slug ?? it.name;
          const counted = it.reports.filter((r) => r.counts);
          const fresh = new Set(it.newChecks);
          const byCheck = status === "open" && !counted.length && it.newChecks.length > 0;
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
                <span class={`rv-state${it.held || it.hidden ? " hi" : byCheck ? " check" : ""}`}>
                  {it.hidden
                    ? "Hidden by you"
                    : it.held
                      ? "Held off boards"
                      : status === "cleared"
                        ? `Cleared ${it.clearedAt ? date(it.clearedAt) : ""}`
                        : byCheck
                          ? `${it.clearedAt ? "Reopened" : "Opened"} by a data check`
                          : "Still listed"}
                  {status !== "cleared" && ` · ${plural(counted.length, "report")}`}
                </span>
              </div>

              {it.checks.length > 0 && (
                <div class="stack">
                  <span class="tiny muted rv-label">Automatic checks</span>
                  <ul class="rv-list">
                    {it.checks.map((c) =>
                      status !== "cleared" && fresh.has(c) ? (
                        <li key={c}>
                          <span class="rv-new">New</span>
                          {c}
                        </li>
                      ) : (
                        <li key={c} class={it.clearedAt ? "muted" : undefined}>
                          {c}
                        </li>
                      ),
                    )}
                  </ul>
                  {status === "cleared" ? (
                    <span class="tiny muted">{it.newChecks.length ? "" : "All seen when you cleared it. A new line will move it back to Waiting."}</span>
                  ) : (
                    it.newChecks.length > 0 && (
                      <span class="tiny muted">
                        {it.clearedAt ? `New since you cleared it on ${date(it.clearedAt)}` : "Not looked at yet"}
                        {it.checksOpenedAt ? ` · found by the upload on ${dateTime(it.checksOpenedAt)}` : ""}
                      </span>
                    )
                  )}
                </div>
              )}
              {!it.checks.length && <span class="tiny muted">Automatic checks found nothing.</span>}

              <div class="stack">
                <span class="tiny muted rv-label">Reports</span>
                {!it.reports.length && <span class="tiny muted">Nobody has reported this character.</span>}
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
        Hide takes a character off every board but leaves its journey public. Clear closes the flag, puts a held character back and marks its check lines as seen; accounts that
        already reported it can't report it again. Ignoring a reporter stops all their reports counting, past and future, without telling them.
      </p>
      <section class="card flat" style={{ marginTop: "24px" }}>
        <div class="row between" style={{ gap: "12px" }}>
          <div class="stack" style={{ minWidth: 0 }}>
            <h2>Leaderboard numbers</h2>
            <p class="muted tiny">
              Works out every public character's leaderboard numbers and automatic checks again from its saved journey, with the site's
              current rules. Only needed after the rules change; it can take a minute.
            </p>
            {recalc && <p class="tiny">{recalc}</p>}
          </div>
          <button type="button" class="btn" disabled={recalcing} onClick={recalcAll}>
            Recalculate all boards
          </button>
        </div>
      </section>
    </main>
  );
}

// New top-3 times on Fastest to 60 and the level-time boards, one card per
// character so one click approves everything it has waiting.
function TopPlaces({ items, busy, act }: { items?: PlaceItem[]; busy?: string; act: (key: string, run: () => Promise<unknown>) => Promise<void> }) {
  if (!items) return <p class="muted">Loading…</p>;
  return (
    <div class="stack-lg">
      <p class="muted small">
        New top-3 times on Fastest to 60 and the level-time boards wait here until you approve them. Approving covers that time or slower; a faster one
        comes back here.
      </p>
      {!items.length && (
        <div class="card flat">
          <p class="muted">No top places waiting.</p>
        </div>
      )}
      {items.map((it) => (
        <article class="card rv-card" key={it.slug}>
          <div class="row between">
            <div class="row" style={{ flexWrap: "nowrap", gap: "12px", minWidth: 0 }}>
              <div class="avatar sm" style={{ background: classColor(it.className) }} aria-hidden="true">
                {it.name.charAt(0)}
              </div>
              <div class="stack" style={{ gap: "0", minWidth: 0 }}>
                <strong>{it.name}</strong>
                <span class="tiny muted">
                  Level {it.level} {describeCharacter(it)} · {it.realm} · uploaded {dateTime(it.uploadedAt)}
                </span>
              </div>
            </div>
            <span class="rv-state wait">{plural(it.places.length, "place")} waiting</span>
          </div>
          <div class="table-wrap">
            <table class="rv-places">
              <thead>
                <tr>
                  <th>Board</th>
                  <th>Time</th>
                  <th>Would be</th>
                  <th>Listed now</th>
                </tr>
              </thead>
              <tbody>
                {it.places.map((p) => {
                  const def = BOARD_BY_ID.get(p.board);
                  if (!def) return null;
                  return (
                    <tr key={`${p.board}-${p.param}`}>
                      <td>{boardTitle(def, p.param)}</td>
                      <td class="v">{formatValue(def.fmt, p.value)}</td>
                      <td>
                        <span class="lb-wait">#{p.rank}</span>
                      </td>
                      <td class="tiny muted">
                        {p.top.length ? p.top.map((t, i) => `#${i + 1} ${t.name} ${formatValue(def.fmt, t.value)}`).join(" · ") : "Nobody yet"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {it.checks.length > 0 ? (
            <div class="stack">
              <span class="tiny muted rv-label">Automatic checks</span>
              <ul class="rv-list">
                {it.checks.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
          ) : (
            <span class="tiny muted">Automatic checks found nothing.</span>
          )}
          <div class="row" style={{ gap: "12px" }}>
            <a class="btn" href={`/j/${encodeURIComponent(it.slug)}`}>
              Open journey
            </a>
            <a class="btn" href={`/j/${encodeURIComponent(it.slug)}/replay`}>
              Open replay
            </a>
            <span class="push" />
            <button type="button" class="btn" disabled={!!busy} onClick={() => act(`dec-${it.slug}`, () => api.placeAction(it.slug, "decline"))}>
              Turn down
            </button>
            <button type="button" class="btn primary" disabled={!!busy} onClick={() => act(`app-${it.slug}`, () => api.placeAction(it.slug, "approve"))}>
              {it.places.length > 1 ? `Approve ${it.places.length} places` : "Approve"}
            </button>
          </div>
        </article>
      ))}
      {items.length > 0 && (
        <p class="tiny muted">
          Approve lists the places. Turn down keeps them off those boards (the character stays on every other board) without telling its owner; a faster
          time later comes back here. To take a character off every board, use Hide on the Waiting tab.
        </p>
      )}
    </div>
  );
}
