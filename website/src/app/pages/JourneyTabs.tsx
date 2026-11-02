// The journey page's stats tabs: Deaths, Gold, Professions, PvP and Levels
// (the Overview is Journey.tsx). Each reads its numbers from lib/stats.ts.

import { useState } from "preact/hooks";
import type { Journey } from "../../lib/journey";
import { duration, gold, goldFlows } from "../../lib/insights";
import { km } from "../../lib/path";
import {
  deathLabel,
  deathStats,
  duelResult,
  goldStats,
  levelStats,
  professionStats,
  pvpStats,
  SKILL_CAPS,
  tierName,
  type LevelRow,
} from "../../lib/stats";
import { QUALITY_COLORS } from "../../lib/wow";
import { day, dateTime, plural } from "../format";

export const TABS = [
  { id: "", label: "Overview" },
  { id: "deaths", label: "Deaths" },
  { id: "gold", label: "Gold" },
  { id: "professions", label: "Professions" },
  { id: "pvp", label: "PvP" },
  { id: "levels", label: "Levels" },
] as const;
export type TabId = (typeof TABS)[number]["id"];

export function isTab(s: string): s is Exclude<TabId, ""> {
  return TABS.some((t) => t.id === s && s !== "");
}

export function TabNav({ base, tab }: { base: string; tab: TabId }) {
  return (
    <nav class="tabs" aria-label="Journey sections">
      {TABS.map((t) => (
        <a key={t.id} href={t.id ? `${base}/${t.id}` : base} class={t.id === tab ? "active" : undefined} aria-current={t.id === tab ? "page" : undefined}>
          {t.label}
        </a>
      ))}
    </nav>
  );
}

// ---------------------------------------------------------------- pieces

function Tile({ label, value, sub, tone }: { label: string; value?: string | number; sub?: string; tone?: "gold" | "good" }) {
  // A name (a nemesis, say) is set smaller than a number.
  const wordy = typeof value === "string" && /[a-z]{3}/i.test(value) && value.length > 10;
  return (
    <div class="tile">
      <span class="label">{label}</span>
      <span class={`value${value === undefined ? " none" : ""}${tone ? ` tone-${tone}` : ""}${wordy ? " words" : ""}`}>{value ?? "—"}</span>
      {sub && <span class="sub">{sub}</span>}
    </div>
  );
}

function Empty({ children }: { children: preact.ComponentChildren }) {
  return <p class="muted small">{children}</p>;
}

function ShowMore<T>({ rows, first, render }: { rows: T[]; first: number; render: (r: T) => preact.JSX.Element }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, first);
  return (
    <>
      {shown.map(render)}
      {rows.length > first && (
        <tr>
          <td colSpan={99}>
            <button type="button" class="linkish" style={{ color: "var(--gold)" }} onClick={() => setAll(!all)}>
              {all ? "Show fewer" : `Show ${rows.length - first} more`}
            </button>
          </td>
        </tr>
      )}
    </>
  );
}

const W = 1000; // chart width in SVG units; charts scale to the card

interface Series {
  label: string;
  color: string;
  points: [number, number][];
}

// A line chart in SVG: x and y domains given, ticks labelled.
export function LineChart(props: {
  series: Series[];
  x: [number, number];
  y: [number, number];
  xTicks: { at: number; label: string }[];
  yTicks: { at: number; label: string }[];
  guides?: number[]; // dashed horizontal lines (y values)
  marks?: { x: number; y: number; label: string; color: string }[];
  now?: { x: number; label: string };
  area?: boolean;
  label: string;
  height?: number;
  endLabels?: boolean;
}) {
  const H = props.height ?? 300;
  const L = 56, R = props.endLabels ? 170 : 16, T = 16, B = 32;
  const sx = (v: number) => L + ((v - props.x[0]) / (props.x[1] - props.x[0] || 1)) * (W - L - R);
  const sy = (v: number) => H - B - ((v - props.y[0]) / (props.y[1] - props.y[0] || 1)) * (H - T - B);
  const path = (pts: [number, number][]) => pts.map(([x, y], i) => `${i ? "L" : "M"}${sx(x).toFixed(1)} ${sy(y).toFixed(1)}`).join(" ");
  // Labels at the lines' ends, nudged apart so they never overlap.
  const ends = props.endLabels
    ? props.series
        .filter((s) => s.points.length)
        .map((s) => ({ s, y: sy(s.points.at(-1)![1]) }))
        .sort((a, b) => a.y - b.y)
    : [];
  for (let i = 1; i < ends.length; i++) ends[i].y = Math.max(ends[i].y, ends[i - 1].y + 18);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={props.label} class="chart">
      {props.yTicks.map((t) => (
        <g key={`y${t.at}`}>
          <line x1={L} x2={W - R} y1={sy(t.at)} y2={sy(t.at)} class="grid" />
          <text x={L - 8} y={sy(t.at) + 4} text-anchor="end">
            {t.label}
          </text>
        </g>
      ))}
      {(props.guides ?? []).map((g) => (
        <line key={`g${g}`} x1={L} x2={W - R} y1={sy(g)} y2={sy(g)} class="guide" />
      ))}
      <line x1={L} x2={W - R} y1={H - B} y2={H - B} class="axis" />
      {props.xTicks.map((t) => (
        <text key={`x${t.at}`} x={sx(t.at)} y={H - 10} text-anchor="middle">
          {t.label}
        </text>
      ))}
      {props.now && (
        <g>
          <line x1={sx(props.now.x)} x2={sx(props.now.x)} y1={T} y2={H - B} class="now" />
          <text x={sx(props.now.x) + 6} y={T + 12} class="strong">
            {props.now.label}
          </text>
        </g>
      )}
      {props.series.map((s) =>
        s.points.length ? (
          <g key={s.label}>
            {props.area && <path d={`${path(s.points)} L${sx(s.points.at(-1)![0])} ${sy(props.y[0])} L${sx(s.points[0][0])} ${sy(props.y[0])} Z`} fill={s.color} fill-opacity="0.08" />}
            <path d={path(s.points)} fill="none" stroke={s.color} stroke-width="3" stroke-linejoin="round" stroke-linecap="round" />
            {s.points.length === 1 && <circle cx={sx(s.points[0][0])} cy={sy(s.points[0][1])} r="4" fill={s.color} />}
          </g>
        ) : null,
      )}
      {(props.marks ?? []).map((m) => (
        <g key={`m${m.x}${m.label}`}>
          <circle cx={sx(m.x)} cy={sy(m.y)} r="5" fill={m.color} />
          <text x={Math.min(sx(m.x), W - R - 8)} y={Math.max(sy(m.y) - 12, T + 10)} text-anchor={sx(m.x) > W * 0.7 ? "end" : "start"} fill={m.color} class="strong">
            {m.label}
          </text>
        </g>
      ))}
      {ends.map(({ s, y }) => (
        <text key={`e${s.label}`} x={sx(s.points.at(-1)![0]) + 8} y={y + 4} fill={s.color} class="strong">
          {s.label}
        </text>
      ))}
    </svg>
  );
}

// Which levels to label on an axis of max levels.
export function labelEvery(max: number): number {
  return max <= 12 ? 1 : max <= 30 ? 5 : 10;
}

export function levelTicks(max: number): { at: number; label: string }[] {
  const every = labelEvery(max);
  const out = [{ at: 1, label: "1" }];
  for (let l = every === 1 ? 2 : every; l <= max; l += every) out.push({ at: l, label: String(l) });
  return out;
}

export function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

const pct = (n: number) => `${Math.round(n * 100)}%`;
const n = (v: number) => v.toLocaleString("en-US");

// ---------------------------------------------------------------- deaths

const TONES: Record<string, string> = { teal: "var(--teal)", gold: "var(--gold)", red: "var(--red)", grey: "var(--grey)" };

export function DeathsTab({ j, map }: { j: Journey; map: preact.JSX.Element }) {
  const d = deathStats(j);
  if (!d.count) {
    return (
      <div class="card">
        <h2>No deaths yet</h2>
        <Empty>Keep it that way. Each death shows up here with what killed you, where, and how long you'd stayed alive.</Empty>
      </div>
    );
  }
  const maxBar = Math.max(1, ...d.byLevel.map((b) => b.world + b.instance));
  const hasKillers = d.rows.some((r) => r.kind !== "unknown");
  const CW = 640; // drawn narrower: this chart sits in a narrower card
  const step = (CW - 40) / Math.max(1, d.byLevel.length);
  const H = 200;
  const every = labelEvery(d.byLevel.length);
  return (
    <>
      <section class="tiles five">
        <Tile label="Deaths" value={d.count} sub={d.perPlayed ? `1 every ${duration(d.perPlayed)} played` : undefined} />
        <Tile label="Deadliest level" value={d.deadliest?.level} sub={d.deadliest ? [plural(d.deadliest.count, "death"), d.deadliest.zone].filter(Boolean).join(", ") : undefined} />
        <Tile label="Nemesis" value={d.nemesis?.name} sub={d.nemesis ? `killed you ${plural(d.nemesis.count, "time")}` : hasKillers ? undefined : "needs Road to Sixty 1.18"} />
        <Tile
          label="Longest without dying"
          value={d.longestAlive ? duration(d.longestAlive.seconds) : undefined}
          sub={d.longestAlive ? `played, ${d.longestAlive.ongoing ? "and counting" : d.longestAlive.fromLevel === d.longestAlive.toLevel ? `at level ${d.longestAlive.fromLevel}` : `levels ${d.longestAlive.fromLevel} to ${d.longestAlive.toLevel}`}` : undefined}
        />
        <Tile label="Since last death" value={d.sinceLast !== undefined ? duration(d.sinceLast) : undefined} sub="played" />
      </section>

      <section class="split">
        <div class="card wide">
          <div class="row between" style={{ alignItems: "baseline" }}>
            <h2>Deaths by level</h2>
            <span class="tiny muted">
              <span class="key" style={{ background: "var(--teal)" }} /> Open world <span class="key" style={{ background: "var(--gold)", marginLeft: "12px" }} /> In a dungeon
            </span>
          </div>
          <svg viewBox={`0 0 ${CW} ${H}`} class="chart" role="img" aria-label={`Deaths at each level; most at level ${d.deadliest?.level ?? "?"}`}>
            {d.byLevel.map((b, i) => {
              const x = 30 + i * step + step * 0.15, w = Math.max(2, step * 0.7);
              const hw = (b.world / maxBar) * (H - 50), hi = (b.instance / maxBar) * (H - 50);
              return (
                <g key={b.level}>
                  <title>{`Level ${b.level}: ${plural(b.world + b.instance, "death")}`}</title>
                  {b.world > 0 && <rect x={x} y={H - 30 - hw} width={w} height={hw} rx="2" fill="var(--teal)" />}
                  {b.instance > 0 && <rect x={x} y={H - 30 - hw - hi} width={w} height={hi} rx="2" fill="var(--gold)" />}
                </g>
              );
            })}
            <line x1="30" x2={CW - 10} y1={H - 30} y2={H - 30} class="axis" />
            {d.byLevel.filter((b) => b.level === 1 || b.level % every === 0).map((b) => (
              <text key={b.level} x={30 + (b.level - 1) * step + step / 2} y={H - 10} text-anchor="middle">
                {b.level}
              </text>
            ))}
          </svg>
          {d.rows.length >= 4 && <p class="small muted">{lateShare(d.byLevel)}</p>}
        </div>
        <div class="card">
          <h2>What killed you</h2>
          {d.causes.map((c) => (
            <div class="stack small" style={{ gap: "4px" }} key={c.label}>
              <div class="row between">
                <span>{c.label}</span>
                <span class="num">{c.count}</span>
              </div>
              <div class="meter">
                <div style={{ width: `${Math.round((c.count / d.count) * 100)}%`, background: TONES[c.tone] }} />
              </div>
            </div>
          ))}
          {d.topKillers.length > 0 && (
            <>
              <h3 class="tiny muted" style={{ fontFamily: "var(--sans)", fontWeight: 600 }}>
                Top killers
              </h3>
              <ol class="small" style={{ margin: 0, paddingLeft: "20px", display: "flex", flexDirection: "column", gap: "6px" }}>
                {d.topKillers.slice(0, 5).map((k) => (
                  <li key={k.name}>
                    {k.name} · {k.count}
                  </li>
                ))}
              </ol>
            </>
          )}
          <p class="tiny muted">Players are never named, only counted.</p>
        </div>
      </section>

      <section class="split">
        <div class="card">
          <h2>Where you died</h2>
          {map}
          <span class="small muted">Deaths inside a dungeon show at its entrance.</span>
        </div>
        <div class="card">
          <h2>Deaths by zone</h2>
          <div class="kv small">
            {d.byZone.slice(0, 10).map((z) => [<span key={`${z.zone}n`}>{z.zone}</span>, <span key={`${z.zone}c`} class="num" style={{ textAlign: "right" }}>{z.count}</span>])}
          </div>
        </div>
      </section>

      <section class="card">
        <div class="row between" style={{ alignItems: "baseline" }}>
          <h2>Every death</h2>
          <span class="tiny muted">Newest first · {plural(d.count, "death")}</span>
        </div>
        <div class="table-wrap">
          <table class="data nowrap">
            <thead>
              <tr>
                <th>Level</th>
                <th>Killed by</th>
                <th>Killing blow</th>
                <th>Where</th>
                <th>When</th>
                <th>Alive for</th>
              </tr>
            </thead>
            <tbody>
              <ShowMore
                rows={[...d.rows].reverse()}
                first={10}
                render={(r) => (
                  <tr key={r.t}>
                    <td>{r.level ?? "—"}</td>
                    <td>
                      {deathLabel(r)}
                      {r.inInstance && r.kind === "creature" && <span class="tone-gold"> (dungeon)</span>}
                    </td>
                    <td>{r.spell ?? (r.kind === "creature" && r.killer ? "Melee" : "—")}</td>
                    <td>{r.where ?? "—"}</td>
                    <td>{dateTime(r.t)}</td>
                    <td>{r.aliveFor !== undefined ? duration(r.aliveFor) : "—"}</td>
                  </tr>
                )}
              />
            </tbody>
          </table>
        </div>
        {!hasKillers && <span class="tiny muted">Killers and killing blows come from Road to Sixty 1.18 or Journey Tracker.</span>}
      </section>
    </>
  );
}

function lateShare(byLevel: { level: number; world: number; instance: number }[]): string {
  const total = byLevel.reduce((a, b) => a + b.world + b.instance, 0);
  const top = byLevel.length;
  const cut = Math.max(1, top - 11);
  const late = byLevel.filter((b) => b.level >= cut).reduce((a, b) => a + b.world + b.instance, 0);
  return `${late} of ${total} deaths came in the last ${top - cut + 1} levels.`;
}

// ---------------------------------------------------------------- gold

export function GoldTab({ j }: { j: Journey }) {
  const g = goldStats(j);
  const flows = goldFlows(j);
  const [axis, setAxis] = useState<"level" | "date">("level");
  const pts = g.points;
  const maxMoney = niceMax(Math.max(...pts.map((p) => p.money), 1));
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => ({ at: maxMoney * f, label: f ? gold(maxMoney * f) : "0" }));
  const maxLevel = Math.max(10, Math.ceil(Math.max(...pts.map((p) => p.level), j.character.level)));
  const t0 = pts[0]?.t ?? 0, t1 = pts.at(-1)?.t ?? 1;
  const xOf = (p: { t: number; level: number }) => (axis === "level" ? p.level : p.t);
  const dateTicks = () => {
    const out: { at: number; label: string }[] = [];
    const days = Math.max(1, Math.ceil((t1 - t0) / 86400));
    const every = Math.max(1, Math.ceil(days / 6));
    for (let t = t0; t <= t1; t += every * 86400) out.push({ at: t, label: day(t).replace(/^\w+ /, "") });
    return out;
  };
  return (
    <>
      <section class="tiles five">
        <Tile label="Gold held now" value={g.now ? gold(g.now.money) : undefined} sub={g.now ? (g.now.why === "logout" ? "at last logout" : "last seen") : "needs Road to Sixty"} tone="gold" />
        <Tile label="Most ever held" value={g.peak ? gold(g.peak.money) : undefined} sub={g.peak ? `level ${Math.floor(g.peak.level)}, ${day(g.peak.t)}` : undefined} />
        <Tile label="Best session" value={g.bestSession?.change !== undefined ? `${g.bestSession.change >= 0 ? "+" : ""}${gold(g.bestSession.change)}` : undefined} sub={g.bestSession ? `${day(g.bestSession.start)}, ${duration(g.bestSession.played)}` : "needs Road to Sixty 1.18"} />
        <Tile label="Gold per hour" value={g.perHour !== undefined ? gold(g.perHour) : undefined} sub={g.perHour !== undefined ? "change in gold held, last 7 days" : undefined} />
        <Tile label="From quests" value={g.questMoney ? gold(g.questMoney) : undefined} sub={g.quests ? `${plural(g.quests, "quest")} turned in` : undefined} />
      </section>

      <section class="card">
        <div class="row between">
          <h2>Gold held over the journey</h2>
          <div class="seg" role="group" aria-label="Across the bottom">
            <button type="button" aria-pressed={axis === "level"} onClick={() => setAxis("level")}>
              By level
            </button>
            <button type="button" aria-pressed={axis === "date"} onClick={() => setAxis("date")}>
              By date
            </button>
          </div>
        </div>
        {pts.length > 1 ? (
          <>
            <LineChart
              label={`Gold held from ${gold(pts[0].money)} to ${gold(pts.at(-1)!.money)}${g.peak ? `, most ${gold(g.peak.money)} at level ${Math.floor(g.peak.level)}` : ""}`}
              series={[{ label: "Gold", color: "var(--gold)", points: pts.map((p) => [xOf(p), p.money]) }]}
              area
              x={axis === "level" ? [1, maxLevel] : [t0, t1]}
              y={[0, maxMoney]}
              xTicks={axis === "level" ? levelTicks(maxLevel) : dateTicks()}
              yTicks={yTicks}
              marks={[
                ...(g.peak ? [{ x: xOf(g.peak), y: g.peak.money, label: `Peak ${gold(g.peak.money)}`, color: "var(--gold)" }] : []),
                ...g.drops.slice(-4).map((dr) => {
                  const after = pts.find((p) => p.t === dr.t)!;
                  return { x: xOf(after), y: after.money, label: `−${gold(dr.amount)}${dr.label ? ` ${dr.label}` : ""}`, color: "var(--red)" };
                }),
              ]}
            />
            <p class="small muted">Points come from the gold held at every login, logout and level up. Big drops are marked, named when you learned riding or a mount then.</p>
          </>
        ) : (
          <Empty>The gold line needs gold held at logins or level ups, which Road to Sixty records (1.18 adds every login and logout).</Empty>
        )}
      </section>

      <section class="split">
        <div class="card wide">
          <div class="row between" style={{ alignItems: "baseline" }}>
            <h2>Sessions</h2>
            <span class="tiny muted">Gold at login and logout</span>
          </div>
          {g.sessions.length ? (
            <div class="table-wrap">
              <table class="data nowrap">
                <thead>
                  <tr>
                    <th>Session</th>
                    <th>Levels</th>
                    <th>Start</th>
                    <th>End</th>
                    <th style={{ textAlign: "right" }}>Change</th>
                  </tr>
                </thead>
                <tbody>
                  <ShowMore
                    rows={g.sessions}
                    first={8}
                    render={(s) => (
                      <tr key={s.start}>
                        <td>
                          {day(s.start)} · {duration(s.played)}
                        </td>
                        <td>{s.startLevel !== undefined && s.endLevel !== undefined && s.endLevel !== s.startLevel ? `${s.startLevel} → ${s.endLevel}` : s.endLevel ?? "—"}</td>
                        <td class="num">{s.startMoney !== undefined ? gold(s.startMoney) : "—"}</td>
                        <td class="num">{s.endMoney !== undefined ? gold(s.endMoney) : "—"}</td>
                        <td class={`num ${s.change === undefined ? "" : s.change >= 0 ? "tone-good" : "tone-red"}`} style={{ textAlign: "right" }}>
                          {s.change === undefined ? "—" : `${s.change >= 0 ? "+" : ""}${gold(s.change)}`}
                        </td>
                      </tr>
                    )}
                  />
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>No sessions recorded yet.</Empty>
          )}
        </div>
        <div class="card">
          <h2>Gold at each level</h2>
          {g.atLevel.length ? (
            <div class="lvbars small">
              {g.atLevel.slice(-12).map((l) => {
                const max = Math.max(...g.atLevel.map((x) => x.money), 1);
                return [
                  <span key={`${l.level}a`} class="num">
                    {l.level}
                  </span>,
                  <div key={`${l.level}b`} class="meter">
                    <div style={{ width: `${Math.max(1, Math.round((l.money / max) * 100))}%` }} />
                  </div>,
                  <span key={`${l.level}c`} class="num">
                    {gold(l.money)}
                  </span>,
                ];
              })}
            </div>
          ) : (
            <Empty>Gold at each level up comes from Road to Sixty.</Empty>
          )}
          {g.atLevel.length > 12 && <span class="tiny muted">The last 12 levels. Every level is on the Levels tab.</span>}
        </div>
      </section>

      <section class="card">
        <div class="row between" style={{ alignItems: "baseline" }}>
          <h2>Gold in and out</h2>
          <span class="tiny muted">From Journey Tracker</span>
        </div>
        {flows.earned !== undefined || flows.incoming.length ? (
          <>
            <div class="row" style={{ gap: "32px" }}>
              {flows.earned !== undefined && (
                <span class="small muted">
                  Earned <strong class="num tone-gold" style={{ fontSize: "20px" }}>{gold(flows.earned)}</strong>
                </span>
              )}
              {flows.spent !== undefined && (
                <span class="small muted">
                  Spent <strong class="num" style={{ fontSize: "20px", color: "var(--text)" }}>{gold(flows.spent)}</strong>
                </span>
              )}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "24px" }}>
              {(
                [
                  ["Where it came from", flows.incoming, ""],
                  ["Where it went", flows.outgoing, "grey"],
                ] as const
              ).map(([title, rows, cls]) => {
                const max = Math.max(1, ...rows.map((r) => r.amount));
                return (
                  <div class="stack" style={{ gap: "10px" }} key={title}>
                    <span class="tiny muted" style={{ fontWeight: 600 }}>
                      {title}
                    </span>
                    {rows.map((r) => (
                      <div class="stack small" style={{ gap: "4px" }} key={r.label}>
                        <div class="row between">
                          <span>{r.label}</span>
                          <span class="num">{gold(r.amount)}</span>
                        </div>
                        <div class={`meter ${cls}`}>
                          <div style={{ width: `${Math.round((r.amount / max) * 100)}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <Empty>Where your gold came from and went comes from Journey Tracker. Install it and upload again to see it.</Empty>
        )}
      </section>
    </>
  );
}

// ---------------------------------------------------------------- professions

const PROF_COLORS = ["#e0b252", "#5fb8b4", "#f08a7e", "#9db3ff", "#c9b6e4", "#a3d977"];

export function ProfessionsTab({ j }: { j: Journey }) {
  const p = professionStats(j);
  const [pick, setPick] = useState<string>();
  if (!p.professions.length) {
    return (
      <div class="card">
        <h2>No professions yet</h2>
        <Empty>Professions, skill-ups, crafts and gathering show here once Road to Sixty has seen you learn one.</Empty>
      </div>
    );
  }
  const color = (name: string) => PROF_COLORS[p.professions.findIndex((x) => x.name === name) % PROF_COLORS.length];
  const withHistory = p.professions.filter((x) => p.history[x.name]?.length);
  const chosen = pick && p.history[pick] ? pick : withHistory[0]?.name;
  const maxLevel = Math.max(20, Math.min(60, Math.ceil(j.character.level / 10) * 10 + 10));
  const maxRank = Math.max(...p.professions.map((x) => Math.max(x.rank, x.max ?? 0)));
  const yMax = maxRank > 225 ? 300 : maxRank > 150 ? 225 : maxRank > 75 ? 150 : 75;
  const lvlNow = j.character.level;
  return (
    <>
      <section class="tiles four">
        {p.professions.slice(0, 4).map((x) => (
          <div class="tile" key={x.name}>
            <span class="label">
              {x.name}
              {x.max ? ` · ${tierName(x.max)}` : ""}
            </span>
            <span class="value" style={{ color: color(x.name) }}>
              {x.rank}
              {x.max && <span class="small muted" style={{ fontWeight: 500 }}> / {x.max}</span>}
            </span>
            {x.max && (
              <div class="meter">
                <div style={{ width: `${Math.min(100, Math.round((x.rank / x.max) * 100))}%`, background: color(x.name) }} />
              </div>
            )}
            <span class="sub">
              {[
                x.learned && !x.learned.baseline ? `Learned at level ${Math.floor(x.learned.level)}` : x.learned ? "Known before tracking" : undefined,
                x.recipes ? plural(x.recipes, "recipe") : undefined,
                x.made ? `${n(x.made)} made` : undefined,
                x.gathers ? plural(x.gathers, x.name === "Fishing" ? "catch" : "node", x.name === "Fishing" ? "catches" : "nodes") : undefined,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </div>
        ))}
      </section>

      <section class="card">
        <div class="row between" style={{ alignItems: "baseline" }}>
          <h2>Skill against your level</h2>
          <span class="tiny muted">Across: your character level · Up: profession skill</span>
        </div>
        <LineChart
          label={`Profession skill by character level: ${p.professions.map((x) => `${x.name} ${x.rank}`).join(", ")}`}
          series={p.professions.map((x) => ({
            label: `${x.name} ${x.rank}`,
            color: color(x.name),
            points: [
              ...(x.learned && x.points[0]?.level !== x.learned.level ? [[x.learned.level, x.points.length ? Math.min(1, x.points[0].rank) : x.rank] as [number, number]] : []),
              ...x.points.map((pt) => [pt.level, pt.rank] as [number, number]),
              [Math.max(lvlNow, x.points.at(-1)?.level ?? 0), x.rank] as [number, number],
            ],
          }))}
          x={[1, maxLevel]}
          y={[0, yMax]}
          xTicks={levelTicks(maxLevel)}
          yTicks={SKILL_CAPS.filter((c) => c <= yMax).map((c) => ({ at: c, label: String(c) }))}
          guides={SKILL_CAPS.filter((c) => c <= yMax)}
          now={{ x: lvlNow, label: `Now · level ${lvlNow}` }}
          endLabels
        />
        <p class="small muted">Dashed lines are the training caps (75, 150, 225, 300). A flat stretch means the profession waited for training or materials.</p>
      </section>

      <section class="card">
        <h2>Milestones: the level you were when you got there</h2>
        <div class="table-wrap">
          <table class="data nowrap">
            <thead>
              <tr>
                <th>Profession</th>
                <th>Learned</th>
                {SKILL_CAPS.map((c) => (
                  <th key={c}>{c}</th>
                ))}
                <th>Points per level</th>
              </tr>
            </thead>
            <tbody>
              {p.professions.map((x) => (
                <tr key={x.name}>
                  <td style={{ color: color(x.name), fontWeight: 600 }}>{x.name}</td>
                  <td>{x.learned ? (x.learned.baseline ? "Before tracking" : `Lv ${Math.floor(x.learned.level)} · ${day(x.learned.t)}`) : "—"}</td>
                  {x.milestones.map((m) => (
                    <td key={m.cap} class={m.t === undefined ? "muted" : undefined}>
                      {m.t !== undefined ? `Lv ${Math.floor(m.level!)} · ${day(m.t)}` : "not yet"}
                    </td>
                  ))}
                  <td class="num">{x.perLevel !== undefined ? x.perLevel.toFixed(1) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section class="split">
        <div class="card wide">
          <div class="row between">
            <h2>Skill-up history</h2>
            {withHistory.length > 1 && (
              <div class="seg" role="group" aria-label="Profession">
                {withHistory.map((x) => (
                  <button type="button" key={x.name} aria-pressed={x.name === chosen} onClick={() => setPick(x.name)}>
                    {x.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          {chosen ? (
            <div class="table-wrap">
              <table class="data nowrap">
                <thead>
                  <tr>
                    <th>Skill</th>
                    <th>Your level</th>
                    <th>What happened</th>
                    <th>When</th>
                  </tr>
                </thead>
                <tbody>
                  <ShowMore
                    rows={p.history[chosen]}
                    first={10}
                    render={(h) => (
                      <tr key={`${h.t}${h.rank}${h.text}`}>
                        <td class="num">{h.rank !== undefined ? (h.from !== undefined && h.rank - h.from > 1 ? `${h.from} → ${h.rank}` : h.rank) : "—"}</td>
                        <td>{Math.floor(h.level)}</td>
                        <td style={{ color: h.item?.quality !== undefined && h.item.quality >= 2 ? QUALITY_COLORS[h.item.quality] : undefined }}>{h.text}</td>
                        <td>{day(h.t)}</td>
                      </tr>
                    )}
                  />
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>Each skill-up is listed once Road to Sixty 1.18 records them.</Empty>
          )}
        </div>
        <div class="card">
          <h2>Gathered and made</h2>
          <h3 class="tiny muted" style={{ fontFamily: "var(--sans)", fontWeight: 600 }}>
            Most gathered
          </h3>
          {p.gathered.length ? (
            <div class="kv small">
              {p.gathered.map((g) => [<span key={`${g.id}n`}>{g.name}</span>, <span key={`${g.id}c`} class="num" style={{ textAlign: "right" }}>{n(g.count)}</span>])}
            </div>
          ) : (
            <Empty>Nothing gathered yet.</Empty>
          )}
          <h3 class="tiny muted" style={{ fontFamily: "var(--sans)", fontWeight: 600 }}>
            Best things made
          </h3>
          {p.bestMade.length ? (
            <div class="stack small">
              {p.bestMade.map((m) => (
                <span key={`${m.item.id}${m.t}`} style={{ color: QUALITY_COLORS[m.item.quality ?? 1] }}>
                  {m.item.name ?? j.items[m.item.id ?? 0] ?? `Item ${m.item.id}`}
                  {m.count > 1 ? ` × ${m.count}` : ""} · lv {m.level}
                </span>
              ))}
            </div>
          ) : (
            <Empty>Nothing made yet.</Empty>
          )}
        </div>
      </section>
    </>
  );
}

// ---------------------------------------------------------------- PvP

export function PvpTab({ j }: { j: Journey }) {
  const p = pvpStats(j);
  if (!p.matches.length && !p.duels.length) {
    return (
      <div class="card">
        <h2>No battlegrounds or duels yet</h2>
        <Empty>Battleground results and duels show here once Road to Sixty 1.18 records them.</Empty>
      </div>
    );
  }
  const maxHk = Math.max(1, ...p.weeks.map((w) => w.hk));
  const H = 200, CW = 640;
  const bw = Math.min(140, (CW - 80) / Math.max(1, p.weeks.length));
  return (
    <>
      <section class="tiles five">
        <Tile label="Battlegrounds" value={p.matches.length} sub={[`${p.won} won`, `${p.lost} lost`, p.left ? `${p.left} left early` : ""].filter(Boolean).join(" · ")} />
        <Tile label="Win rate" value={p.winRate !== undefined ? pct(p.winRate) : undefined} sub="of finished matches" tone={p.winRate !== undefined && p.winRate >= 0.5 ? "good" : undefined} />
        <Tile label="Honorable kills" value={n(p.hk)} sub={`${n(p.kb)} killing blows`} />
        <Tile label="Honor earned" value={n(p.honor)} sub="bonus honor included" />
        <Tile label="Duels" value={p.duels.length} sub={`${p.duelsWon} won · ${p.duelsLost} lost`} />
      </section>

      {p.maps.length > 0 && (
        <>
          <section class="grid-cards">
            {p.maps.map((m) => (
              <div class="card" key={m.name}>
                <h2 style={{ fontSize: "22px" }}>{m.name}</h2>
                <div class="wl" aria-label={`${m.won} won, ${m.lost} lost, ${m.left} left early`} role="img">
                  {m.won > 0 && <div style={{ flex: m.won, background: "var(--good)" }} />}
                  {m.lost > 0 && <div style={{ flex: m.lost, background: "var(--red)" }} />}
                  {m.left > 0 && <div style={{ flex: m.left, background: "var(--line-2)" }} />}
                </div>
                <div class="kv small">
                  <span class="muted">Played</span>
                  <span>
                    {m.played} · {m.won} won
                  </span>
                  {m.avgLength !== undefined && [<span key="a" class="muted">Average length</span>, <span key="b">{duration(m.avgLength)}</span>]}
                  {m.objectives.map((o) => [<span key={`${o.name}a`} class="muted">{o.name}</span>, <span key={`${o.name}b`} class="num">{n(o.value)}</span>])}
                  {Object.entries(m.rep).map(([f, v]) => [<span key={`${f}a`} class="muted">Reputation</span>, <span key={`${f}b`}>+{n(v)} {f}</span>])}
                  {m.best && [<span key="c" class="muted">Best match</span>, <span key="d">{`${m.best.pvp.kb ?? 0} KB · ${m.best.pvp.hk ?? 0} HK`}</span>]}
                </div>
              </div>
            ))}
          </section>
          <p class="tiny muted" style={{ marginTop: "-16px" }}>
            Green: won · Red: lost · Grey: left before the end. Each map's own objectives come from its score board.
          </p>

          <section class="card">
            <div class="row between" style={{ alignItems: "baseline" }}>
              <h2>Every match</h2>
              <span class="tiny muted">Your row of the score board</span>
            </div>
            <div class="table-wrap">
              <table class="data nowrap">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Battleground</th>
                    <th>Level</th>
                    <th>Result</th>
                    <th>Length</th>
                    <th>KB</th>
                    <th>HK</th>
                    <th>Deaths</th>
                    <th>Honor</th>
                    <th>Damage</th>
                    <th>Healing</th>
                  </tr>
                </thead>
                <tbody>
                  <ShowMore
                    rows={p.matches}
                    first={10}
                    render={(m) => (
                      <tr key={m.t}>
                        <td>{day(m.t)}</td>
                        <td>{m.name}</td>
                        <td>{m.level ?? "—"}</td>
                        <td class={m.result === "won" ? "tone-good" : m.result === "lost" ? "tone-red" : "muted"}>{m.result === "won" ? "Won" : m.result === "lost" ? "Lost" : "Left early"}</td>
                        <td>{m.length !== undefined ? duration(m.length) : "—"}</td>
                        <td class="num">{m.pvp.kb ?? "—"}</td>
                        <td class="num">{m.pvp.hk ?? "—"}</td>
                        <td class="num">{m.pvp.deaths ?? "—"}</td>
                        <td class="num">{m.pvp.honor ?? m.pvp.scoreHonor ?? "—"}</td>
                        <td class="num">{m.pvp.damage !== undefined ? short(m.pvp.damage) : "—"}</td>
                        <td class="num">{m.pvp.healing !== undefined ? short(m.pvp.healing) : "—"}</td>
                      </tr>
                    )}
                  />
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      <section class="split">
        {p.weeks.length > 0 && (
          <div class="card wide">
            <h2>Honorable kills over time</h2>
            <svg viewBox={`0 0 ${CW} ${H}`} class="chart" role="img" aria-label={`Honorable kills per week: ${p.weeks.map((w) => w.hk).join(", ")}`}>
              {p.weeks.map((w, i) => {
                const h = (w.hk / maxHk) * (H - 60);
                const x = 40 + i * bw + bw * 0.2;
                return (
                  <g key={w.week}>
                    <rect x={x} y={H - 30 - h} width={bw * 0.6} height={Math.max(1, h)} rx="3" fill="var(--teal)" />
                    <text x={x + bw * 0.3} y={H - 36 - h} text-anchor="middle" class="strong">
                      {w.hk}
                    </text>
                    <text x={x + bw * 0.3} y={H - 10} text-anchor="middle">
                      Week {w.week}
                    </text>
                  </g>
                );
              })}
              <line x1="30" x2={CW - 10} y1={H - 30} y2={H - 30} class="axis" />
            </svg>
          </div>
        )}
        <div class="card">
          <h2>Duels</h2>
          {p.duels.length ? (
            <>
              <p class="tiny muted">Opponents are shown by class and level only.</p>
              <div class="kv small">
                {p.duels.slice(0, 12).map((d) => [
                  <span key={`${d.t}a`}>
                    {d.label}
                    {d.toDeath ? " (to the death)" : ""}
                  </span>,
                  <span key={`${d.t}b`} class={d.result === "won" || d.result === "theyFled" ? "tone-good" : d.result === "lost" || d.result === "fled" ? "tone-red" : "muted"} style={{ textAlign: "right" }}>
                    {duelResult(d.result)}
                  </span>,
                ])}
              </div>
            </>
          ) : (
            <Empty>No duels yet.</Empty>
          )}
        </div>
      </section>
    </>
  );
}

function short(v: number): string {
  return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v);
}

// ---------------------------------------------------------------- levels

export function LevelsTab({ j, base }: { j: Journey; base: string }) {
  const s = levelStats(j);
  const rows = s.rows;
  const [all, setAll] = useState(false);
  if (rows.length < 2) {
    return (
      <div class="card">
        <h2>Level stats start at level 2</h2>
        <Empty>Each level's time, kills, quests, deaths and distance show here as you level.</Empty>
      </div>
    );
  }
  const H = 220;
  const step = (W - 60) / rows.length;
  const shown = all ? [...rows].reverse() : [...rows].reverse().slice(0, 8);
  return (
    <>
      <section class="tiles five">
        <Tile label={s.fastest && s.fastest.level >= 10 ? "Fastest level (10+)" : "Fastest level"} value={s.fastest?.level} sub={s.fastest ? `${duration(s.fastest.played)} played` : undefined} />
        <Tile label="Slowest level" value={s.slowest?.level} sub={s.slowest ? `${duration(s.slowest.played)} played` : undefined} />
        <Tile label="XP from quests" value={s.questShare !== undefined ? pct(s.questShare) : undefined} sub={s.questShare !== undefined ? `${pct(1 - s.questShare)} from kills` : "needs Road to Sixty"} />
        <Tile label="Most kills in a level" value={s.mostKills?.kills} sub={s.mostKills ? `level ${s.mostKills.level}` : undefined} />
        <Tile label="Average per level" value={s.average !== undefined ? duration(s.average) : undefined} sub={`played, levels 1 to ${j.character.level}`} />
      </section>

      <section class="card">
        <div class="row between">
          <h2>Where each level's XP came from</h2>
          <span class="tiny muted">
            <span class="key" style={{ background: "var(--gold)" }} /> Quests <span class="key" style={{ background: "var(--teal)", marginLeft: "12px" }} /> Kills
          </span>
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} class="chart" role="img" aria-label="Share of each level's XP from quests and from kills">
          <text x="44" y="24" text-anchor="end">
            100%
          </text>
          <text x="44" y={20 + (H - 50) / 2 + 4} text-anchor="end">
            50%
          </text>
          {rows.map((r, i) => {
            const total = r.questXP + r.killXP;
            const x = 52 + i * step + step * 0.1, w = Math.max(2, step * 0.8);
            const q = total ? (r.questXP / total) * (H - 50) : 0;
            return (
              <g key={r.level}>
                <title>{total ? `Level ${r.level}: ${pct(r.questXP / total)} quests, ${pct(r.killXP / total)} kills` : `Level ${r.level}: no XP recorded`}</title>
                <rect x={x} y={20} width={w} height={H - 50} fill={total ? "var(--teal)" : "var(--line)"} />
                {q > 0 && <rect x={x} y={20} width={w} height={q} fill="var(--gold)" />}
              </g>
            );
          })}
          {rows.filter((r) => r.level === 1 || r.level % labelEvery(rows.length) === 0).map((r) => (
            <text key={r.level} x={52 + (r.level - 1) * step + step / 2} y={H - 10} text-anchor="middle">
              {r.level}
            </text>
          ))}
        </svg>
        <p class="small muted">{xpNote(j, rows)}</p>
      </section>

      <section class="card">
        <div class="row between" style={{ alignItems: "baseline" }}>
          <h2>Every level</h2>
          <span class="tiny muted">What happened while you were each level · newest first</span>
        </div>
        <div class="table-wrap">
          <table class="data nowrap">
            <thead>
              <tr>
                <th>Level</th>
                <th>Reached</th>
                <th>Played</th>
                <th>Kills</th>
                <th>Quests</th>
                <th>XP split</th>
                <th>Deaths</th>
                <th>Dungeons</th>
                <th>Walked</th>
                <th>Flown</th>
                <th>Gold at level</th>
                <th>Main zone</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <LevelLine key={r.level} r={r} />
              ))}
              {rows.length > 8 && (
                <tr>
                  <td colSpan={12}>
                    <button type="button" class="linkish" style={{ color: "var(--gold)" }} onClick={() => setAll(!all)}>
                      {all ? "Show fewer" : `Show levels 1 to ${rows.length - 8}`}
                    </button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p class="tiny muted">
          Profession skill at each level is on the <a href={`${base}/professions`}>Professions tab</a>.
        </p>
      </section>
    </>
  );
}

function LevelLine({ r }: { r: LevelRow }) {
  const total = r.questXP + r.killXP;
  return (
    <tr>
      <td style={{ fontWeight: 600 }}>{r.level}</td>
      <td>{r.reached ? day(r.reached) : r.level === 1 ? "Start" : "—"}</td>
      <td class={r.inProgress ? "muted" : undefined}>{r.inProgress ? "in progress" : r.played !== undefined ? duration(r.played) : "—"}</td>
      <td class="num">{r.kills}</td>
      <td class="num">{r.quests}</td>
      <td>
        {total ? (
          <div class="split-bar" role="img" aria-label={`${pct(r.questXP / total)} from quests`}>
            <div style={{ flex: r.questXP, background: "var(--gold)" }} />
            <div style={{ flex: r.killXP, background: "var(--teal)" }} />
          </div>
        ) : (
          "—"
        )}
      </td>
      <td class={`num${r.deaths >= 3 ? " tone-red" : ""}`}>{r.deaths}</td>
      <td class="num">{r.dungeons}</td>
      <td class="num">{r.walked !== undefined ? `${km(r.walked)} km` : "—"}</td>
      <td class="num">{r.flown ? `${km(r.flown)} km` : "—"}</td>
      <td class="num">{r.money !== undefined ? gold(r.money) : "—"}</td>
      <td>{r.zone ?? "—"}</td>
    </tr>
  );
}

function xpNote(j: Journey, rows: LevelRow[]): string {
  const killHeavy = rows.filter((r) => r.dungeons > 0 && r.killXP > r.questXP).map((r) => r.level);
  if (killHeavy.length) return `Kill-heavy levels with a dungeon run: ${killHeavy.slice(0, 8).join(", ")}.`;
  return `XP from turned-in quests and from kills, as Road to Sixty recorded them for ${j.character.name}.`;
}
