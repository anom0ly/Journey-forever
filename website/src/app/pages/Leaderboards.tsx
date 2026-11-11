// Leaderboards: every public character, ranked. The home page shows a card
// per board with the top five (and your own best row under them); each
// card opens the full board.

import { useEffect, useState } from "preact/hooks";
import { BOARD_BY_ID, boardTitle, CARDS, coins, formatValue, GROUPS, type BoardDef, type GroupId } from "../../lib/boardDefs";
import { className as classLabel } from "../../lib/wow";
import { api, type BoardFilters, type BoardPage, type BoardRow } from "../api";
import { classColor, describeCharacter, plural } from "../format";
import { useFriends } from "../friends";
import { useMe } from "../me";
import { navigate } from "../router";
import { ReportDialog } from "./Report";

export function isGroup(id: string): id is GroupId {
  return GROUPS.some((g) => g.id === id);
}

// The filters carry over between the home page and a full board.
let remembered: BoardFilters = {};

function useFilters(): [BoardFilters, (f: BoardFilters) => void] {
  const [f, setF] = useState<BoardFilters>(remembered);
  return [f, (next) => setF((remembered = next))];
}

export function boardHref(id: string, param?: string): string {
  return `/leaderboards/board/${encodeURIComponent(id)}${param ? `/${encodeURIComponent(param)}` : ""}`;
}

function Filters({ f, onChange, extra }: { f: BoardFilters; onChange: (f: BoardFilters) => void; extra?: preact.ComponentChildren }) {
  const me = useMe();
  // The Friends filter and the key appear once a friend has a public character.
  const hasFriends = (useFriends()?.friends.length ?? 0) > 0;
  const [meta, setMeta] = useState<{ realms: string[]; classes: string[] }>({ realms: [], classes: [] });
  useEffect(() => {
    api.boardsMeta().then(setMeta).catch(() => undefined);
  }, []);
  return (
    <div class="lb-filters">
      {extra}
      <label class="lb-select">
        <span>Realm</span>
        <select value={f.realm ?? ""} onChange={(e) => onChange({ ...f, realm: (e.target as HTMLSelectElement).value || undefined })}>
          <option value="">All realms</option>
          {meta.realms.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>
      <label class="lb-select">
        <span>Class</span>
        <select value={f.cls ?? ""} onChange={(e) => onChange({ ...f, cls: (e.target as HTMLSelectElement).value || undefined })}>
          <option value="">All classes</option>
          {meta.classes.map((c) => (
            <option key={c} value={c}>
              {classLabel(c)}
            </option>
          ))}
        </select>
      </label>
      {me?.user && (
        <div class="lb-seg" role="group" aria-label="Show">
          <button type="button" aria-pressed={!f.show} onClick={() => onChange({ ...f, show: undefined })}>
            Everyone
          </button>
          {(hasFriends || f.show === "friends") && (
            <button type="button" aria-pressed={f.show === "friends"} onClick={() => onChange({ ...f, show: "friends" })}>
              Friends
            </button>
          )}
          <button type="button" aria-pressed={f.show === "mine"} onClick={() => onChange({ ...f, show: "mine" })}>
            Mine
          </button>
        </div>
      )}
      {me?.user && hasFriends && (
        <span class="lb-key">
          <i aria-hidden="true" />
          Your Battle.net friends
        </span>
      )}
    </div>
  );
}

function emptyText(f: BoardFilters): string {
  if (f.show === "mine") return "None of your public characters are on this board yet.";
  if (f.show === "friends") return "Neither you nor your friends have a public character on this board yet.";
  return "No public characters on this board yet.";
}

// Your best row and friends further down, in board order, for under the gap.
function below(page: BoardPage, shown: BoardRow[]): BoardRow[] {
  const have = new Set(shown.map((r) => r.slug));
  const extra = [...(page.me ? [page.me] : []), ...(page.friends ?? [])].filter((r) => !have.has(r.slug));
  return extra.sort((a, b) => a.rank - b.rank);
}

function Dot({ r, size }: { r: Pick<BoardRow, "name" | "className">; size?: "lg" }) {
  return (
    <span class={`lb-dot${size ? ` ${size}` : ""}`} style={{ background: classColor(r.className), color: r.className === "SHAMAN" ? "#fff" : "#1c0806" }} aria-hidden="true">
      {r.name.charAt(0)}
    </span>
  );
}

function ParamPicker({ def, params, value, onChange, id }: { def: BoardDef; params?: string[]; value: string; onChange: (p: string) => void; id: string }) {
  if (!def.param) return null;
  const list = params && params.length ? params : value ? [value] : [];
  if (!list.length) return null;
  const label = def.param === "milestone" || def.param === "goldLevel" || def.param === "level" ? "Level" : def.param === "profession" ? "Profession" : def.param === "zone" ? "Zone" : def.param === "creature" ? "Creature" : def.param === "ctype" ? "Type" : "Dungeon";
  return (
    <label class="lb-select" for={id}>
      <span>{label}</span>
      <select id={id} value={value} onChange={(e) => onChange((e.target as HTMLSelectElement).value)}>
        {!list.includes(value) && value && <option value={value}>{value}</option>}
        {list.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>
    </label>
  );
}

function JtTag() {
  return (
    <a href="/data" class="lb-jt" title="Characters without Journey Tracker don't appear on this board">
      Needs Journey Tracker
    </a>
  );
}

// ---------------------------------------------------------------- home

function BoardCard({ title, boards, f, index }: { title: string; boards: { id: string; label: string }[]; f: BoardFilters; index: string }) {
  const [which, setWhich] = useState(0);
  const id = boards[which].id;
  const def = BOARD_BY_ID.get(id)!;
  const [param, setParam] = useState<string>("");
  const [data, setData] = useState<BoardPage>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let live = true;
    setError(undefined);
    api
      .board(id, { ...f, param: param || undefined, limit: 5 })
      .then((d) => live && setData(d))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [id, param, f.realm, f.cls, f.show]);
  const shown = data?.board === id ? data : undefined;
  return (
    <article class="card lb-card">
      <div class="lb-card-head">
        <h3>{title}</h3>
        {def.jt && <JtTag />}
      </div>
      <p class="tiny muted">{def.sub}</p>
      {(boards.length > 1 || def.param) && (
        <div class="lb-card-pickers">
          {boards.length > 1 && (
            <div class="lb-seg small" role="group" aria-label={`${title}: which board`}>
              {boards.map((b, i) => (
                <button
                  key={b.id}
                  type="button"
                  aria-pressed={i === which}
                  onClick={() => {
                    setWhich(i);
                    if (BOARD_BY_ID.get(b.id)?.param !== def.param) setParam("");
                  }}
                >
                  {b.label}
                </button>
              ))}
            </div>
          )}
          <ParamPicker def={def} params={shown?.params} value={shown?.param ?? param} onChange={setParam} id={`p-${index}`} />
        </div>
      )}
      {error ? (
        <p class="small muted">Couldn't load this board: {error}</p>
      ) : !shown ? (
        <p class="small muted">Loading…</p>
      ) : !shown.rows.length ? (
        <p class="small muted">{emptyText(f)}</p>
      ) : (
        <ol class="lb-rank">
          {shown.rows.map((r) => (
            <RankLi key={r.slug} r={r} def={def} />
          ))}
          {below(shown, shown.rows).length > 0 && (
            <>
              <li class="lb-gap" aria-hidden="true">
                ⋮
              </li>
              {below(shown, shown.rows).map((r) => (
                <RankLi key={r.slug} r={r} def={def} />
              ))}
            </>
          )}
        </ol>
      )}
      <div class="lb-card-foot">
        <span class="tiny muted">{shown ? plural(shown.total, "character") : ""}</span>
        <a class="small" href={boardHref(id, def.param ? shown?.param : undefined)}>
          See all →
        </a>
      </div>
    </article>
  );
}

// Gold boards show gold, silver and copper with in-game coin colours; a zero
// part stays (dimmed) so amounts line up down the list.
function BoardValue({ def, value }: { def: BoardDef; value: number }) {
  if (def.fmt !== "gold" && def.fmt !== "goldHour") return <>{formatValue(def.fmt, value)}</>;
  const m = coins(value);
  return (
    <span class="lb-money" aria-label={formatValue(def.fmt, value)}>
      <span class={`g${m.g ? "" : " zero"}`} aria-hidden="true"><b>{m.g.toLocaleString("en-US")}</b><i /></span>
      <span class={`s${m.s ? "" : " zero"}`} aria-hidden="true"><b>{m.s}</b><i /></span>
      <span class={`c${m.c ? "" : " zero"}`} aria-hidden="true"><b>{m.c}</b><i /></span>
      {def.fmt === "goldHour" && <span class="per" aria-hidden="true">/h</span>}
    </span>
  );
}

function RankLi({ r, def }: { r: BoardRow; def: BoardDef }) {
  return (
    <li class={r.mine ? "mine" : r.friend ? "friend" : undefined} title={r.friend ? "Your Battle.net friend" : undefined}>
      <span class={`n${r.rank === 1 ? " first" : ""}`}>{r.rank}</span>
      <Dot r={r} />
      <a class="nm" href={`/j/${encodeURIComponent(r.slug)}`}>
        {r.name}
        {r.mine && <span class="lb-you">You</span>}
        {r.overall !== undefined && <span class="lb-overall">#{r.overall} overall</span>}
      </a>
      <span class="val"><BoardValue def={def} value={r.value} /></span>
    </li>
  );
}

export function LeaderboardsPage({ group = "leveling" }: { group?: GroupId }) {
  const [f, setF] = useFilters();
  return (
    <main class="page">
      <section class="lb-head">
        <div class="stack">
          <h1>Leaderboards</h1>
          <p class="lead">Every public character, ranked. Times are played time, so someone who plays two hours a night can still top a board.</p>
        </div>
        <Filters f={f} onChange={setF} />
      </section>
      <nav class="tabs" aria-label="Leaderboard groups">
        {GROUPS.map((g) => (
          <a key={g.id} href={`/leaderboards/${g.id}`} class={g.id === group ? "active" : undefined} aria-current={g.id === group ? "page" : undefined}>
            {g.label}
          </a>
        ))}
      </nav>
      <div class="lb-cards">
        {CARDS[group].map((c, i) => (
          <BoardCard key={`${group}-${i}`} title={c.title} boards={c.boards} f={f} index={`${group}-${i}`} />
        ))}
      </div>
      <p class="small muted">
        Only public characters are listed: make one public on its journey page to join. Boards that start at level 1 need Road to Sixty running from level 1. See
        something that can't be right? Use the flag on a board's full list to report it.
      </p>
    </main>
  );
}

// ---------------------------------------------------------------- one board

export function BoardPageView({ id, param }: { id: string; param?: string }) {
  const def = BOARD_BY_ID.get(id);
  const me = useMe();
  const [f, setF] = useFilters();
  const [data, setData] = useState<BoardPage>();
  const [more, setMore] = useState<BoardRow[]>([]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [reporting, setReporting] = useState<BoardRow>();

  useEffect(() => {
    if (!def) return;
    let live = true;
    setError(undefined);
    setMore([]);
    api
      .board(id, { ...f, param })
      .then((d) => live && setData(d))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [id, param, f.realm, f.cls, f.show]);

  if (!def) {
    return (
      <main class="page narrow">
        <h1>No such board</h1>
        <p class="muted">
          <a href="/leaderboards">See all leaderboards</a>.
        </p>
      </main>
    );
  }

  const rows = data ? [...data.rows, ...more] : [];
  const p = data?.param ?? param ?? "";
  const group = GROUPS.find((g) => g.id === def.group)!;
  const mineSlug = rows.find((r) => r.mine)?.slug ?? data?.me?.slug;

  const loadMore = async () => {
    if (!data) return;
    setBusy(true);
    try {
      const next = await api.board(id, { ...f, param: p, offset: rows.length });
      setMore((m) => [...m, ...next.rows]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const row = (r: BoardRow, pinned = false) => (
    <tr
      key={`${r.slug}${pinned ? "-below" : ""}`}
      class={[r.mine ? "mine" : r.friend && "friend", pinned && "pinned"].filter(Boolean).join(" ") || undefined}
      title={r.friend ? "Your Battle.net friend" : undefined}
    >
      <td class={`lb-n${r.rank === 1 ? " first" : ""}`}>{r.rank}</td>
      <td>
        <div class="lb-char">
          <Dot r={r} size="lg" />
          <div class="stack" style={{ gap: "0", minWidth: 0 }}>
            <span>
              <a href={`/j/${encodeURIComponent(r.slug)}`} class="lb-name">
                {r.name}
              </a>
              {r.mine && <span class="lb-you">You</span>}
              {r.overall !== undefined && <span class="lb-overall">#{r.overall} overall</span>}
            </span>
            <span class="tiny muted">
              Level {r.level} {describeCharacter(r)} · {r.realm}
            </span>
          </div>
        </div>
      </td>
      <td class="lb-val"><BoardValue def={def} value={r.value} /></td>
      <td class="lb-actions">
        {!r.mine && (
          <a class="small" href={mineSlug ? `/compare/${encodeURIComponent(mineSlug)}/${encodeURIComponent(r.slug)}` : `/compare/${encodeURIComponent(r.slug)}`}>
            {mineSlug ? "Compare with mine" : "Compare"}
          </a>
        )}
        {me?.user && !r.mine && (
          <button type="button" class="lb-flag" title={`Report ${r.name}`} aria-label={`Report ${r.name}`} onClick={() => setReporting(r)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M5 21V4M5 4h11l-2 4 2 4H5" />
            </svg>
          </button>
        )}
      </td>
    </tr>
  );

  return (
    <main class="page">
      <p class="small muted">
        <a href={`/leaderboards/${group.id}`} style={{ textDecoration: "none" }}>
          Leaderboards
        </a>{" "}
        / {group.label}
      </p>
      <section class="lb-head">
        <div class="stack">
          <div class="row" style={{ gap: "12px" }}>
            <h1>{boardTitle(def, p || "…")}</h1>
            {def.jt && <JtTag />}
          </div>
          <p class="lead">
            {def.sub}.{def.fromOne && " Only characters that had Road to Sixty running from level 1 can enter."}
          </p>
        </div>
        <Filters
          f={f}
          onChange={setF}
          extra={<ParamPicker def={def} params={data?.params} value={p} onChange={(next) => navigate(boardHref(id, next), true)} id="board-param" />}
        />
      </section>
      {error && <div class="notice err">{error}</div>}
      {data && !rows.length && (
        <div class="card flat">
          <p class="muted">{emptyText(f)}</p>
        </div>
      )}
      {rows.length > 0 && (
        <div class="table-wrap">
          <table class="data lb-table">
            <thead>
              <tr>
                <th class="lb-n">#</th>
                <th>Character</th>
                <th>{def.fmt === "duration" ? "Played time" : def.fmt === "date" ? "Reached on" : def.fmt === "gap" ? "Levels above" : def.group === "kills" ? "Kills" : "Score"}</th>
                <th>
                  <span class="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => row(r))}
              {data && below(data, rows).map((r, i) => row(r, i === 0))}
            </tbody>
          </table>
        </div>
      )}
      {data && (
        <div class="row between">
          <span class="tiny muted">
            Showing {rows.length} of {plural(data.total, "character")}
          </span>
          {rows.length < data.total && (
            <button type="button" class="btn" onClick={loadMore} disabled={busy}>
              {busy ? "Loading…" : "Show 50 more"}
            </button>
          )}
        </div>
      )}
      {reporting && <ReportDialog slug={reporting.slug} name={reporting.name} onClose={() => setReporting(undefined)} />}
    </main>
  );
}
