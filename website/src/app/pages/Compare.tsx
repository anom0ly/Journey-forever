// Two public characters side by side: the picker (/compare/:a) and the
// comparison (/compare/:a/:b). /demo/compare puts the two sample characters
// against each other. Numbers come from lib/compare.ts and lib/stats.ts.

import { useEffect, useMemo, useState } from "preact/hooks";
import { cutAtLevel, deathsByLevel, headToHead, levelRace, routeByLevel, routeFacts, sharedLevel, winner, type H2HRow } from "../../lib/compare";
import type { Journey } from "../../lib/journey";
import { slugFromLink } from "../../lib/search";
import { duration, gold, played } from "../../lib/insights";
import { km } from "../../lib/path";
import { deathStats, goldStats, levelStats, professionStats, pvpStats, SKILL_CAPS } from "../../lib/stats";
import { api, type PublicHit, type StoredCharacter } from "../api";
import { classColor, describeCharacter, plural } from "../format";
import { navigate } from "../router";
import { loadDemoJourneys } from "../source";
import { ReplayDuo } from "./CompareReplay";
import { labelEvery, LineChart, levelTicks, niceMax } from "./JourneyTabs";

const COLOR = { a: "var(--gold)", b: "var(--lilac)" } as const;

interface Side {
  j: Journey;
  slug?: string; // undefined for the samples
}

const TABS = ["Overview", "Route", "Replay", "Levels", "Deaths", "Gold", "Professions", "PvP"] as const;
type Tab = (typeof TABS)[number];

// ---------------------------------------------------------------- loading

function usePublic(slug: string | undefined): { side?: Side; error?: string } {
  const [state, setState] = useState<{ side?: Side; error?: string }>({});
  useEffect(() => {
    if (!slug) return;
    let live = true;
    setState({});
    api
      .publicJourneyData(slug)
      .then((j) => live && setState({ side: { j, slug } }))
      .catch((e: Error) => live && setState({ error: e.message }));
    return () => {
      live = false;
    };
  }, [slug]);
  return state;
}

function Problem({ title, children }: { title: string; children: preact.ComponentChildren }) {
  return (
    <main class="page narrow">
      <h1>{title}</h1>
      <p class="muted">{children}</p>
    </main>
  );
}

function Loading() {
  return (
    <main class="page narrow">
      <p class="muted" role="status">
        Loading both journeys…
      </p>
    </main>
  );
}

export function ComparePage({ a, b, signedIn }: { a: string; b?: string; signedIn: boolean }) {
  const left = usePublic(a);
  const right = usePublic(b);
  if (left.error) return <Problem title="Couldn't open this journey">{left.error}. Only public characters can be compared.</Problem>;
  if (b && right.error) return <Problem title="Couldn't open the second journey">{right.error}. Only public characters can be compared.</Problem>;
  if (!left.side || (b && !right.side)) return <Loading />;
  if (!b) return <Picker keep={left.side} signedIn={signedIn} />;
  return <CompareView a={left.side} b={right.side!} />;
}

export function DemoComparePage() {
  const [sides, setSides] = useState<[Side, Side]>();
  useEffect(() => {
    loadDemoJourneys().then((js) => {
      const by = (n: string) => js.find((j) => j.character.name === n) ?? js[0];
      setSides([{ j: by("Brannoc") }, { j: by("Lyssira") }]);
    });
  }, []);
  if (!sides) return <Loading />;
  return <CompareView a={sides[0]} b={sides[1]} demo />;
}

// ---------------------------------------------------------------- picker

function Avatar({ name, className, size = "" }: { name: string; className?: string; size?: string }) {
  return (
    <div class={`avatar ${size}`} style={{ background: classColor(className) }} aria-hidden="true">
      {name.charAt(0)}
    </div>
  );
}

function Picker({ keep, signedIn }: { keep: Side; signedIn: boolean }) {
  const c = keep.j.character;
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<PublicHit[]>();
  const [mine, setMine] = useState<StoredCharacter[]>();
  const [link, setLink] = useState("");
  const [linkError, setLinkError] = useState<string>();

  useEffect(() => {
    if (signedIn) api.characters().then((r) => setMine(r.characters)).catch(() => setMine([]));
  }, [signedIn]);

  useEffect(() => {
    if (q.trim().length < 2) {
      setHits(undefined);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      api
        .searchPublic(q)
        .then((r) => live && setHits(r.results.filter((h) => h.slug !== keep.slug)))
        .catch(() => live && setHits([]));
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [q]);

  const go = (slug: string) => navigate(`/compare/${encodeURIComponent(keep.slug!)}/${encodeURIComponent(slug)}`);
  const useLink = (e: Event) => {
    e.preventDefault();
    const slug = slugFromLink(link);
    if (!slug) setLinkError("That doesn't look like a journey link. It should contain /j/ and the character's name.");
    else if (slug === keep.slug) setLinkError(`That's ${c.name}. Pick someone else.`);
    else go(slug);
  };
  const others = (mine ?? []).filter((m) => m.slug !== keep.slug);

  return (
    <main class="page">
      <div class="stack">
        <h1>Compare {c.name}</h1>
        <p class="lead">Pick a second public character. Both journeys are shown side by side, lined up at the same level.</p>
      </div>
      <section class="two-col compare-pick">
        <div class="card">
          <span class="eyebrow">Left</span>
          <div class="row" style={{ flexWrap: "nowrap" }}>
            <Avatar name={c.name} className={c.className} />
            <div class="stack" style={{ gap: "2px", minWidth: 0 }}>
              <h2>{c.name}</h2>
              <span class="small muted">
                Level {c.level} {describeCharacter(c)} · {c.realm}
              </span>
            </div>
          </div>
          <a class="small" href={`/j/${encodeURIComponent(keep.slug!)}`}>
            Back to {c.name}'s journey
          </a>
        </div>
        <div class="card">
          <label class="eyebrow" for="compare-search">
            Compare with
          </label>
          <input
            id="compare-search"
            class="text-input"
            type="search"
            placeholder="Search public characters by name"
            autocomplete="off"
            value={q}
            onInput={(e) => setQ((e.target as HTMLInputElement).value)}
          />
          {hits && (
            <div class="list" role="list" aria-live="polite">
              {hits.length ? (
                hits.map((h) => (
                  <a key={h.slug} role="listitem" class="item pick" href={`/compare/${encodeURIComponent(keep.slug!)}/${encodeURIComponent(h.slug)}`}>
                    <Avatar name={h.name} className={h.className} size="sm" />
                    <span class="stack" style={{ gap: "0", flex: 1, minWidth: 0 }}>
                      <strong>{h.name}</strong>
                      <span class="small muted">
                        Level {h.level} {describeCharacter(h)} · {h.realm}
                      </span>
                    </span>
                    <span class="small" style={{ color: "var(--accent)" }}>
                      Compare
                    </span>
                  </a>
                ))
              ) : (
                <div class="item small muted">No public character's name starts with "{q.trim()}".</div>
              )}
            </div>
          )}
          {signedIn && others.length > 0 && (
            <div class="stack">
              <span class="eyebrow">Your characters</span>
              <div class="row" style={{ gap: "8px" }}>
                {others.map((m) =>
                  m.isPublic && m.slug ? (
                    <a key={m.key} class="chip-link" href={`/compare/${encodeURIComponent(keep.slug!)}/${encodeURIComponent(m.slug)}`}>
                      <Avatar name={m.summary.name} className={m.summary.className} size="xs" />
                      {m.summary.name} {m.summary.level}
                    </a>
                  ) : (
                    <a key={m.key} class="chip-link off" href={`/c/${encodeURIComponent(m.key)}`} title="Private: make it public on its page to compare it">
                      <Avatar name={m.summary.name} className={m.summary.className} size="xs" />
                      {m.summary.name} {m.summary.level} · private
                    </a>
                  ),
                )}
              </div>
              {others.some((m) => !m.isPublic) && <span class="tiny muted">Private characters can't be compared. Open one and make it public first.</span>}
            </div>
          )}
          <form class="stack" onSubmit={useLink}>
            <label class="eyebrow" for="compare-link">
              Or paste a journey link
            </label>
            <div class="row" style={{ flexWrap: "nowrap" }}>
              <input
                id="compare-link"
                class="text-input"
                placeholder={`${location.origin}/j/…`}
                value={link}
                onInput={(e) => {
                  setLink((e.target as HTMLInputElement).value);
                  setLinkError(undefined);
                }}
              />
              <button class="btn" type="submit" style={{ flex: "none" }}>
                Use link
              </button>
            </div>
            {linkError && <span class="tiny tone-red">{linkError}</span>}
          </form>
        </div>
      </section>
    </main>
  );
}

// ---------------------------------------------------------------- the comparison

function Who({ side, other, right, demo }: { side: Side; other: Side; right?: boolean; demo?: boolean }) {
  const c = side.j.character;
  const p = played(side.j);
  return (
    <div class={`vs-side${right ? " right" : ""}`}>
      <div class="avatar lg" style={{ background: classColor(c.className), boxShadow: `0 0 0 3px ${right ? COLOR.b : COLOR.a}` }} aria-hidden="true">
        {c.name.charAt(0)}
      </div>
      <div class="stack" style={{ gap: "2px", minWidth: 0 }}>
        <h2 class="vs-name">{side.slug ? <a href={`/j/${encodeURIComponent(side.slug)}`}>{c.name}</a> : c.name}</h2>
        <span class="small muted">{[`Level ${c.level} ${describeCharacter(c)}`, c.realm, p !== undefined && `${duration(p)} played`].filter(Boolean).join(" · ")}</span>
        {!demo && other.slug && (
          <a class="small" href={`/compare/${encodeURIComponent(other.slug)}`}>
            Change
          </a>
        )}
      </div>
    </div>
  );
}

function CompareView({ a, b, demo }: { a: Side; b: Side; demo?: boolean }) {
  const level = sharedLevel(a.j, b.j);
  const [mode, setMode] = useState<"level" | "all">("level");
  // The tab is in the link (#replay), so a shared link opens on it.
  const [tab, setTabState] = useState<Tab>(() => TABS.find((t) => `#${t.toLowerCase()}` === location.hash) ?? "Overview");
  const setTab = (t: Tab) => {
    setTabState(t);
    history.replaceState(history.state, "", t === "Overview" ? location.pathname + location.search : `#${t.toLowerCase()}`);
  };
  const cut = mode === "level" && level ? level : undefined;
  const ja = useMemo(() => (cut ? cutAtLevel(a.j, cut) : a.j), [a, cut]);
  const jb = useMemo(() => (cut ? cutAtLevel(b.j, cut) : b.j), [b, cut]);
  const names = { a: a.j.character.name, b: b.j.character.name };

  useEffect(() => {
    document.title = `${names.a} vs ${names.b} · Journey Forever`;
    return () => {
      document.title = "Journey Forever";
    };
  }, [names.a, names.b]);

  const props: TabProps = { ja, jb, names, cut };
  return (
    <main class="page">
      <section class="vs">
        <Who side={a} other={b} demo={demo} />
        <span class="vs-badge" aria-hidden="true">
          vs
        </span>
        <Who side={b} other={a} right demo={demo} />
      </section>
      {demo && <div class="notice small">Two made-up sample journeys, built from the sample saved files that ship with the site.</div>}
      {level ? (
        <section class="align">
          <div class="seg" role="group" aria-label="What to compare">
            <button type="button" aria-pressed={mode === "level"} onClick={() => setMode("level")}>
              Up to level {level}
            </button>
            <button type="button" aria-pressed={mode === "all"} onClick={() => setMode("all")}>
              Whole journey
            </button>
          </div>
          <span class="small muted">
            {mode === "level" ? `Both characters from level 1 until each reached level ${level}.` : "Everything each character has done so far, whatever their level."}
          </span>
        </section>
      ) : null}
      <nav class="tabs" aria-label="Compare sections">
        {TABS.map((t) => (
          <a
            key={t}
            href={`#${t.toLowerCase()}`}
            class={t === tab ? "active" : undefined}
            aria-current={t === tab ? "page" : undefined}
            onClick={(e) => {
              e.preventDefault();
              setTab(t);
            }}
          >
            {t}
          </a>
        ))}
      </nav>
      {tab === "Overview" ? (
        <OverviewTab {...props} />
      ) : tab === "Route" ? (
        <RouteTab {...props} />
      ) : tab === "Replay" ? (
        <ReplayDuo ja={ja} jb={jb} />
      ) : tab === "Levels" ? (
        <LevelsTab {...props} />
      ) : tab === "Deaths" ? (
        <DeathsTab {...props} />
      ) : tab === "Gold" ? (
        <GoldTab {...props} />
      ) : tab === "Professions" ? (
        <ProfessionsTab {...props} />
      ) : (
        <PvpTab {...props} />
      )}
    </main>
  );
}

interface TabProps {
  ja: Journey;
  jb: Journey;
  names: { a: string; b: string };
  cut?: number;
}

function Key({ names }: { names: { a: string; b: string } }) {
  return (
    <span class="tiny muted">
      <span class="key" style={{ background: COLOR.a }} /> {names.a} <span class="key" style={{ background: COLOR.b, marginLeft: "12px" }} /> {names.b}
    </span>
  );
}

// One figure for each of the two, side by side.
function Duo({ label, a, b, sub, wordy }: { label: string; a?: string | number; b?: string | number; sub?: string; wordy?: boolean }) {
  return (
    <div class="tile duo">
      <span class="label">{label}</span>
      <div class={`duo-vals${wordy ? " words" : ""}`}>
        <span style={{ color: COLOR.a }}>{a ?? "—"}</span>
        <span style={{ color: COLOR.b }}>{b ?? "—"}</span>
      </div>
      {sub && <span class="sub">{sub}</span>}
    </div>
  );
}

function fmt(r: H2HRow, v: number | undefined): string {
  if (v === undefined) return "—";
  switch (r.kind) {
    case "time":
      return duration(v);
    case "gold":
      return gold(v);
    case "km":
      return `${km(v)} km`;
    case "pct":
      return `${Math.round(v * 100)}%`;
    default:
      return v.toLocaleString("en-US");
  }
}

function OverviewTab({ ja, jb, names, cut }: TabProps) {
  const rows = headToHead(ja, jb, cut);
  const ra = levelRace(ja), rb = levelRace(jb);
  const maxH = niceMax(Math.max(0.5, ...ra.map((p) => p[0]), ...rb.map((p) => p[0])));
  const maxL = Math.max(2, ja.character.level, jb.character.level);
  const hourStep = maxH <= 5 ? 1 : maxH <= 20 ? 5 : maxH <= 100 ? 20 : 100;
  const xTicks = [];
  for (let h = 0; h <= maxH; h += hourStep) xTicks.push({ at: h, label: `${h}h` });
  const reachedA = ra.find((p) => p[1] === cut)?.[0], reachedB = rb.find((p) => p[1] === cut)?.[0];
  return (
    <>
      <section class="card">
        <div class="h2h">
          {rows.map((r) => {
            const w = winner(r);
            const max = Math.max(r.a ?? 0, r.b ?? 0) || 1;
            return (
              <div class="h2h-row" key={r.label}>
                <span class={`h2h-v left${w === "a" ? " win" : ""}`}>{fmt(r, r.a)}</span>
                <div class={`h2h-bar left${w === "b" ? " lose" : ""}`}>
                  <div style={{ width: `${((r.a ?? 0) / max) * 100}%` }} />
                </div>
                <span class="h2h-what">
                  <b>{r.label}</b>
                  {r.sub && <span>{r.sub}</span>}
                </span>
                <div class={`h2h-bar right${w === "a" ? " lose" : ""}`}>
                  <div style={{ width: `${((r.b ?? 0) / max) * 100}%` }} />
                </div>
                <span class={`h2h-v right${w === "b" ? " win" : ""}`}>{fmt(r, r.b)}</span>
              </div>
            );
          })}
        </div>
        <p class="tiny muted">★ marks the better of the two where there is one: less time and fewer deaths, more quests and gold.</p>
      </section>
      <section class="card">
        <div class="row between" style={{ alignItems: "baseline" }}>
          <h2>The race{cut ? ` to level ${cut}` : ""}</h2>
          <Key names={names} />
        </div>
        <LineChart
          label="Level reached against hours played, for both characters"
          series={[
            { label: names.a, color: COLOR.a, points: ra },
            { label: names.b, color: COLOR.b, points: rb },
          ]}
          x={[0, maxH]}
          y={[1, maxL]}
          xTicks={xTicks}
          yTicks={levelTicks(maxL)}
          endLabels
        />
        <p class="small muted">
          Hours played across, level up the side.
          {reachedA !== undefined && reachedB !== undefined && Math.abs(reachedA - reachedB) * 3600 >= 60
            ? ` ${reachedA < reachedB ? names.a : names.b} reached level ${cut} ${duration(Math.abs(reachedA - reachedB) * 3600)} of play sooner.`
            : ""}
        </p>
      </section>
    </>
  );
}

// Muted colours for zones, picked by name so a zone looks the same in both lanes.
const ZONE_COLORS = ["#9cc3d9", "#a9c98e", "#d39b7e", "#8fd0b0", "#c7b27a", "#b9a6d9", "#d9c38e", "#d98fa6", "#86b6a0", "#c9a37a"];
function zoneColor(zone: string): string {
  let h = 0;
  for (const ch of zone) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return ZONE_COLORS[h % ZONE_COLORS.length];
}

function RouteTab({ ja, jb, names }: TabProps) {
  const max = Math.max(ja.character.level, jb.character.level);
  const facts = { a: routeFacts(ja), b: routeFacts(jb) };
  const lane = (j: Journey, color: string, name: string) => {
    const spans = routeByLevel(j);
    const filler = max - j.character.level;
    return (
      <div class="lane">
        <span class="lane-who" style={{ color }}>
          {name}
        </span>
        <div class="lane-track">
          {spans.map((s) => (
            <div key={s.from} title={`${s.zone ?? "Unknown"}: level ${s.from === s.to ? s.from : `${s.from} to ${s.to}`}`} style={{ flex: s.to - s.from + 1, background: s.zone ? zoneColor(s.zone) : "var(--line-2)" }}>
              {s.zone ?? "?"}
            </div>
          ))}
          {filler > 0 && (
            <div class="not-yet" style={{ flex: filler }}>
              not yet
            </div>
          )}
        </div>
      </div>
    );
  };
  const every = labelEvery(max);
  return (
    <>
      <section class="card">
        <div class="row between" style={{ alignItems: "baseline" }}>
          <h2>Where each of them levelled</h2>
          <span class="tiny muted">the zone most of each level was played in</span>
        </div>
        <div class="lanes">
          <div class="lane">
            <span />
            <div class="lane-ticks">
              {Array.from({ length: max }, (_, i) => (
                <span key={i}>{i === 0 || (i + 1) % every === 0 ? i + 1 : ""}</span>
              ))}
            </div>
          </div>
          {lane(ja, COLOR.a, names.a)}
          {lane(jb, COLOR.b, names.b)}
        </div>
      </section>
      <section class="tiles three">
        <Duo label="Zones visited" a={facts.a.zones} b={facts.b.zones} />
        <Duo
          label="First dungeon, at level"
          a={facts.a.firstDungeon?.level}
          b={facts.b.firstDungeon?.level}
          sub={[facts.a.firstDungeon && `${names.a}: ${facts.a.firstDungeon.name}`, facts.b.firstDungeon && `${names.b}: ${facts.b.firstDungeon.name}`].filter(Boolean).join(" · ") || "neither has run one yet"}
        />
        <Duo label="Flight paths taken" a={facts.a.flights} b={facts.b.flights} />
      </section>
    </>
  );
}

function LevelsTab({ ja, jb, names }: TabProps) {
  const la = levelStats(ja), lb = levelStats(jb);
  const max = Math.max(ja.character.level, jb.character.level);
  const rows = [];
  for (let l = max; l >= 1; l--) {
    const ra = la.rows[l - 1], rb = lb.rows[l - 1];
    const pa = ra && !ra.inProgress ? ra.played : undefined, pb = rb && !rb.inProgress ? rb.played : undefined;
    const d = pa !== undefined && pb !== undefined ? pa - pb : undefined;
    const cell = (r: typeof ra, p?: number) => (!r ? "—" : r.inProgress ? <span class="muted">reached</span> : duration(p));
    rows.push(
      <tr key={l}>
        <td>{l}</td>
        <td class="num">{cell(ra, pa)}</td>
        <td class="num">{cell(rb, pb)}</td>
        <td class="num" style={{ color: d === undefined || Math.abs(d) < 60 ? undefined : d > 0 ? COLOR.b : COLOR.a }}>
          {d === undefined ? "—" : Math.abs(d) < 60 ? "even" : `${d > 0 ? names.b : names.a} by ${duration(Math.abs(d))}`}
        </td>
        <td>{ra?.zone ?? "—"}</td>
        <td>{rb?.zone ?? "—"}</td>
      </tr>,
    );
  }
  const pct = (v?: number) => (v === undefined ? undefined : `${Math.round(v * 100)}%`);
  return (
    <>
      <section class="tiles three">
        <Duo label="Fastest level" a={la.fastest ? `${la.fastest.level} · ${duration(la.fastest.played)}` : undefined} b={lb.fastest ? `${lb.fastest.level} · ${duration(lb.fastest.played)}` : undefined} sub="played" />
        <Duo label="Average per level" a={la.average !== undefined ? duration(la.average) : undefined} b={lb.average !== undefined ? duration(lb.average) : undefined} sub="played" />
        <Duo label="XP from quests" a={pct(la.questShare)} b={pct(lb.questShare)} />
      </section>
      <section class="card">
        <div class="row between" style={{ alignItems: "baseline" }}>
          <h2>Every level, head to head</h2>
          <span class="tiny muted">played time on each level · newest first</span>
        </div>
        <div class="table-wrap">
          <table class="data nowrap">
            <thead>
              <tr>
                <th>Level</th>
                <th class="num" style={{ color: COLOR.a }}>
                  {names.a}
                </th>
                <th class="num" style={{ color: COLOR.b }}>
                  {names.b}
                </th>
                <th class="num">Faster</th>
                <th>{names.a}'s zone</th>
                <th>{names.b}'s zone</th>
              </tr>
            </thead>
            <tbody>{rows}</tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function DeathsTab({ ja, jb, names }: TabProps) {
  const da = deathStats(ja), db = deathStats(jb);
  const max = Math.max(ja.character.level, jb.character.level);
  const ba = deathsByLevel(ja, max), bb = deathsByLevel(jb, max);
  const top = Math.max(1, ...ba, ...bb);
  const every = labelEvery(max);
  const CW = 1000, H = 200, step = (CW - 40) / max, bw = Math.max(2, Math.min(24, step * 0.32));
  const alive = (d: typeof da) => (d.longestAlive ? duration(d.longestAlive.seconds) : undefined);
  return (
    <>
      <section class="tiles four">
        <Duo label="Deaths" a={da.count} b={db.count} />
        <Duo label="Played per death" a={da.perPlayed ? duration(da.perPlayed) : undefined} b={db.perPlayed ? duration(db.perPlayed) : undefined} />
        <Duo label="Longest without dying" a={alive(da)} b={alive(db)} sub="played" />
        <Duo label="Nemesis" a={da.nemesis?.name} b={db.nemesis?.name} wordy />
      </section>
      <section class="card">
        <div class="row between" style={{ alignItems: "baseline" }}>
          <h2>Deaths at each level</h2>
          <Key names={names} />
        </div>
        {da.count || db.count ? (
          <svg viewBox={`0 0 ${CW} ${H}`} class="chart" role="img" aria-label={`Deaths at each level: ${names.a} ${da.count}, ${names.b} ${db.count}`}>
            {ba.map((v, i) => {
              const cx = 30 + i * step + step / 2;
              const ha = (v / top) * (H - 50), hb = (bb[i] / top) * (H - 50);
              return (
                <g key={i}>
                  <title>{`Level ${i + 1}: ${names.a} ${plural(v, "death")}, ${names.b} ${plural(bb[i], "death")}`}</title>
                  {v > 0 && <rect x={cx - bw - 1} y={H - 30 - ha} width={bw} height={ha} rx="2" fill={COLOR.a} />}
                  {bb[i] > 0 && <rect x={cx + 1} y={H - 30 - hb} width={bw} height={hb} rx="2" fill={COLOR.b} />}
                </g>
              );
            })}
            <line x1="30" x2={CW - 10} y1={H - 30} y2={H - 30} class="axis" />
            {ba.map((_, i) =>
              i === 0 || (i + 1) % every === 0 ? (
                <text key={`t${i}`} x={30 + i * step + step / 2} y={H - 10} text-anchor="middle">
                  {i + 1}
                </text>
              ) : null,
            )}
          </svg>
        ) : (
          <p class="muted small">Neither has died yet.</p>
        )}
      </section>
    </>
  );
}

function GoldTab({ ja, jb, names, cut }: TabProps) {
  const ga = goldStats(ja), gb = goldStats(jb);
  const g = (v?: number) => (v === undefined ? undefined : gold(v));
  const max = Math.max(2, ja.character.level, jb.character.level);
  const pa = ga.atLevel.map((p) => [p.level, p.money / 10000] as [number, number]);
  const pb = gb.atLevel.map((p) => [p.level, p.money / 10000] as [number, number]);
  const top = niceMax(Math.max(0.01, ...pa.map((p) => p[1]), ...pb.map((p) => p[1])));
  const yTicks = [0, top / 2, top].map((v) => ({ at: v, label: gold(v * 10000) }));
  return (
    <>
      <section class="tiles four">
        <Duo label={cut ? `Gold at level ${cut}` : "Gold now"} a={g(ga.now?.money)} b={g(gb.now?.money)} />
        <Duo label="Most held" a={g(ga.peak?.money)} b={g(gb.peak?.money)} />
        <Duo label="From quests" a={g(ga.questMoney)} b={g(gb.questMoney)} sub={`${plural(ga.quests, "quest")} · ${plural(gb.quests, "quest")}`} />
        <Duo label="Gold per hour played" a={g(ga.perHour)} b={g(gb.perHour)} sub={cut ? undefined : "over each one's last 7 days"} />
      </section>
      <section class="card">
        <div class="row between" style={{ alignItems: "baseline" }}>
          <h2>Gold held at each level</h2>
          <Key names={names} />
        </div>
        {pa.length || pb.length ? (
          <LineChart
            label="Gold held when each level was reached, for both characters"
            series={[
              { label: names.a, color: COLOR.a, points: pa },
              { label: names.b, color: COLOR.b, points: pb },
            ]}
            x={[1, max]}
            y={[0, top]}
            xTicks={levelTicks(max)}
            yTicks={yTicks}
            endLabels
          />
        ) : (
          <p class="muted small">Gold at each level needs Road to Sixty.</p>
        )}
      </section>
    </>
  );
}

function ProfessionsTab({ ja, jb, names, cut }: TabProps) {
  const pa = professionStats(ja).professions, pb = professionStats(jb).professions;
  const all = [...new Set([...pa, ...pb].filter((p) => p.rank > 0).map((p) => p.name))].sort();
  if (!all.length) {
    return (
      <section class="card">
        <h2>No professions yet</h2>
        <p class="muted small">Neither character had trained a profession{cut ? ` by level ${cut}` : ""}.</p>
      </section>
    );
  }
  const bar = (name: string, list: typeof pa, color: string, who: string) => {
    const p = list.find((x) => x.name === name && x.rank > 0);
    const cap = p?.max ?? SKILL_CAPS.find((c) => (p?.rank ?? 0) <= c) ?? 300;
    return (
      <div class="stack" style={{ gap: "4px" }}>
        <div class="meter">
          <div style={{ width: `${p ? Math.min(100, (p.rank / cap) * 100) : 0}%`, background: color }} />
        </div>
        <span class="tiny muted num">{p ? `${who} ${p.rank} / ${cap}` : `${who}: not learned`}</span>
      </div>
    );
  };
  return (
    <section class="card">
      <div class="row between" style={{ alignItems: "baseline" }}>
        <h2>Skill {cut ? `at level ${cut}` : "now"}</h2>
        <Key names={names} />
      </div>
      <div class="prof-grid">
        {all.map((name) => [
          <span key={`${name}n`}>{name}</span>,
          <div key={`${name}b`} class="stack" style={{ gap: "6px" }}>
            {bar(name, pa, COLOR.a, names.a)}
            {bar(name, pb, COLOR.b, names.b)}
          </div>,
        ])}
      </div>
      <p class="tiny muted">Only professions at least one of them has learned are listed.</p>
    </section>
  );
}

function PvpTab({ ja, jb, cut }: TabProps) {
  const pa = pvpStats(ja), pb = pvpStats(jb);
  const none = (p: typeof pa) => !p.hk && !p.matches.length && !p.duels.length;
  if (none(pa) && none(pb)) {
    return (
      <section class="card">
        <h2>No PvP yet</h2>
        <p class="muted small">Neither character had an honorable kill, battleground or duel{cut ? ` by level ${cut}` : ""}.</p>
      </section>
    );
  }
  const rec = (p: typeof pa) => (p.matches.length ? `${p.won}–${p.lost}` : undefined);
  const rate = (p: typeof pa) => (p.winRate !== undefined ? `${Math.round(p.winRate * 100)}% won` : undefined);
  return (
    <section class="tiles four">
      <Duo label="Honorable kills" a={pa.hk} b={pb.hk} />
      <Duo label="Battlegrounds won–lost" a={rec(pa)} b={rec(pb)} sub={[rate(pa), rate(pb)].filter(Boolean).join(" · ") || undefined} />
      <Duo label="Honor" a={pa.honor || undefined} b={pb.honor || undefined} />
      <Duo label="Duels won" a={pa.duels.length ? `${pa.duelsWon} of ${pa.duels.length}` : undefined} b={pb.duels.length ? `${pb.duelsWon} of ${pb.duels.length}` : undefined} />
    </section>
  );
}
