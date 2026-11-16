// The journey page's Life at 60 tab: shown once a character reaches 60.
// The numbers are lib/sixty.ts; cards whose data no addon gave are left out.

import type { Journey } from "../../lib/journey";
import { duration, gold } from "../../lib/insights";
import { sixtyStats, STANDINGS, EXALTED, type RaidRow, type SixtyRun } from "../../lib/sixty";
import { QUALITY_COLORS } from "../../lib/wow";
import { dateTime, day, plural } from "../format";
import { LineChart, niceMax, ShowMore, Tile } from "./JourneyTabs";

const qColor = (q?: number) => (q !== undefined ? QUALITY_COLORS[q] : undefined);

function ItemText({ name, quality }: { name?: string; quality?: number }) {
  return <span style={{ color: qColor(quality) }}>{name ?? "an item"}</span>;
}

function firstLabel(f: { t: number; by?: boolean } | undefined): string | undefined {
  if (!f) return undefined;
  return `${f.by ? "first by" : "first"} ${day(f.t)}`;
}

export function SixtyTab({ j, gallery }: { j: Journey; gallery: preact.JSX.Element }) {
  const s = sixtyStats(j);
  if (!s) return <p class="muted small">This tab fills in once the character reaches level 60.</p>;
  const net = s.goldAt60 !== undefined && s.goldNow !== undefined ? s.goldNow - s.goldAt60 : undefined;
  const raidsWithBosses = s.bossSource ? s.raids.filter((r) => r.killed > 0 || r.visits > 0) : [];
  const m = j.stats.money ?? {};

  return (
    <>
      <section class="card sixty-hero">
        <div class="stack" style={{ gap: "6px" }}>
          <span class="small muted">Reached level 60</span>
          <span class="sixty-date">{dateTime(s.reached)}</span>
          <span class="muted">
            {[s.zone && `in ${s.zone}`, s.playedTo60 !== undefined && `after ${duration(s.playedTo60)} played`, s.daysTo60 && plural(s.daysTo60, "day")].filter(Boolean).join(", ")}.
          </span>
          <span class="small muted">
            Since then: {duration(s.playedSince)} played over {plural(s.daysSince, "day")}.
          </span>
        </div>
        <div class="sixty-tiles">
          {s.bossSource ? (
            <Tile label="Raid bosses killed" value={s.bossKills} sub={`${plural(s.bossesKilled, "different boss", "different bosses")}${s.wipes !== undefined ? ` · ${plural(s.wipes, "wipe")}` : ""}`} />
          ) : (
            <Tile label="Raid visits" value={s.raidVisits} sub={s.raids.filter((r) => r.visits).map((r) => `${r.raid.name} ×${r.visits}`).join(" · ") || "none yet"} />
          )}
          <Tile label="Dungeon runs" value={s.dungeonRuns} sub={s.topDungeon ? `most: ${s.topDungeon.name} ×${s.topDungeon.n}` : undefined} />
          <Tile label="Epics" value={s.epics} sub="looted since 60" />
          <Tile label="Gear upgrades" value={s.upgrades.length} sub={s.upgrades.length ? `${plural(s.slotsChanged, "slot")} changed` : undefined} />
          <Tile label="Gold since 60" value={net !== undefined ? `${net >= 0 ? "+" : "−"}${gold(Math.abs(net))}` : undefined} sub={net !== undefined ? "change in gold held" : undefined} tone="gold" />
          <Tile label="Exalted" value={s.exalted.length} sub={s.exalted.join(", ") || undefined} />
        </div>
      </section>

      {raidsWithBosses.length ? <RaidProgress raids={raidsWithBosses} source={s.bossSource!} /> : s.raids.length ? <RaidVisits raids={s.raids} /> : null}

      {s.runs.length > 0 && <Runs runs={s.runs} showBosses={s.runs.some((r) => r.bosses !== undefined)} />}

      {s.gear.length > 0 && (
        <section class="split">
          <div class="card wide">
            <div class="row between" style={{ alignItems: "baseline" }}>
              <h2>Gear now</h2>
              <span class="tiny muted">{s.gear.some((g) => g.worn) ? "what's equipped, and how long you've worn it" : "what's equipped, and since when"}</span>
            </div>
            <div class="gear-doll">
              {s.gear.map((g) => (
                <div class="gear-slot" key={g.slot} style={{ color: qColor(g.item.quality) }}>
                  <div class="gear-ic" aria-hidden="true" />
                  <div class="stack" style={{ gap: "2px", minWidth: 0 }}>
                    <span class="gear-name">{g.item.name ?? `Item ${g.item.id ?? ""}`}</span>
                    <span class="tiny muted">{[g.label, g.how, g.worn ? `worn ${duration(g.worn)}` : `since ${day(g.since)}`].filter(Boolean).join(" · ")}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div class="card">
            <h2>Upgrades since 60</h2>
            {s.upgrades.length ? (
              <div class="timeline">
                {s.upgrades.slice(0, 8).map((u) => (
                  <div class="tl-ev" key={`${u.t}${u.slot}`}>
                    <b>
                      <ItemText name={u.item.name} quality={u.item.quality} />
                    </b>
                    <span class="tiny muted">
                      {[u.slot, day(u.t), u.how].filter(Boolean).join(" · ")}
                      {u.replaced?.name && (
                        <>
                          {" · replaced "}
                          <ItemText name={u.replaced.name} quality={u.replaced.quality} />
                        </>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p class="muted small">No gear changed since 60 yet.</p>
            )}
            {Object.keys(s.rarity).length > 0 && (
              <p class="tiny muted">
                Equipped now:{" "}
                {[4, 3, 2].filter((q) => s.rarity[q]).map((q, i) => (
                  <span key={q} style={{ color: qColor(q) }}>
                    {i ? " · " : ""}
                    {s.rarity[q]} {q === 4 ? "epic" : q === 3 ? "rare" : "uncommon"}
                  </span>
                ))}
              </p>
            )}
          </div>
        </section>
      )}

      <section class="split">
        {s.gold.length > 1 && (
          <div class="card">
            <h2>Gold since 60</h2>
            <GoldLine j={j} s={s} />
            {(m.repairs || m.auctionIncome || m.loot) && (
              <table class="data" style={{ marginTop: "8px" }}>
                <tbody>
                  {m.repairs ? (
                    <tr>
                      <td>Repairs</td>
                      <td class="num tone-red">−{gold(m.repairs)}</td>
                    </tr>
                  ) : null}
                  {m.auctionIncome ? (
                    <tr>
                      <td>Auction house sales</td>
                      <td class="num tone-gold">+{gold(m.auctionIncome)}</td>
                    </tr>
                  ) : null}
                  {m.loot ? (
                    <tr>
                      <td>Looted gold</td>
                      <td class="num tone-gold">+{gold(m.loot)}</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            )}
            {(m.repairs || m.auctionIncome || m.loot) && <p class="tiny muted">The table is the whole journey, from Journey Tracker.</p>}
          </div>
        )}
        {s.reps.length > 0 && (
          <div class="card">
            <div class="row between" style={{ alignItems: "baseline" }}>
              <h2>Reputation</h2>
              <span class="tiny muted">standing changes since 60</span>
            </div>
            {s.reps.slice(0, 8).map((r) => (
              <div class="rep" key={r.faction}>
                <div class="row between">
                  <span>{r.faction}</span>
                  <b style={{ color: r.standing === EXALTED ? "var(--teal)" : undefined }}>{STANDINGS[r.standing] ?? r.standing}</b>
                </div>
                <div class="meter">
                  <div style={{ width: `${Math.max(4, ((r.standing - 4) / 4) * 100)}%`, background: r.standing === EXALTED ? "var(--teal)" : "var(--lilac)" }} />
                </div>
                <span class="tiny muted">
                  {r.from !== undefined && STANDINGS[r.from] ? `${STANDINGS[r.from]} → ${STANDINGS[r.standing]}, ` : ""}
                  {day(r.t)}
                </span>
              </div>
            ))}
            <p class="tiny muted">Road to Sixty logs each step to a new standing, so the bar shows the standing, not progress inside it.</p>
          </div>
        )}
      </section>

      <section class="split">
        {s.milestones.length > 0 && (
          <div class="card">
            <h2>Milestones</h2>
            <div class="timeline">
              {s.milestones.map((ms) => (
                <div class={`tl-ev ${ms.tone}`} key={`${ms.t}${ms.title}`}>
                  <b>{ms.title}</b>
                  <span class="tiny muted">{[day(ms.t), ms.sub].filter(Boolean).join(" · ")}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {s.time.length > 0 && (
          <div class="card">
            <div class="row between" style={{ alignItems: "baseline" }}>
              <h2>Where the time goes</h2>
              <span class="tiny muted">{duration(s.playedSince)} played since 60</span>
            </div>
            <div class="time-bar" role="img" aria-label={s.time.map((t) => `${t.label} ${duration(t.seconds)}`).join(", ")}>
              {s.time.map((t) => (
                <div key={t.label} style={{ flex: t.seconds, background: t.color }} />
              ))}
            </div>
            <table class="data">
              <tbody>
                {s.time.map((t) => (
                  <tr key={t.label}>
                    <td>
                      <span style={{ color: t.color }}>■</span> {t.label}
                    </td>
                    <td class="num">{duration(t.seconds)}</td>
                    <td class="num muted">{Math.round((t.seconds / Math.max(1, s.time.reduce((n, x) => n + x.seconds, 0))) * 100)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {s.topZones.length > 0 && <p class="tiny muted">Most time out in the world: {s.topZones.join(", ")}.</p>}
          </div>
        )}
      </section>

      {gallery}
    </>
  );
}

function RaidProgress({ raids, source }: { raids: RaidRow[]; source: "jt" | "shots" }) {
  return (
    <section class="card">
      <div class="row between" style={{ alignItems: "baseline" }}>
        <h2>Raid progress</h2>
        <span class="tiny muted">{source === "jt" ? "Journey Tracker counts every boss attempt, kill and wipe" : "From our addon's boss screenshots"}</span>
      </div>
      <div class="raid-grid">
        {raids.map((r) => (
          <div key={r.raid.name} class="stack" style={{ gap: "8px" }}>
            <h3>{r.raid.name}</h3>
            <div class="progress">
              <div style={{ width: `${(r.killed / r.raid.bosses.length) * 100}%` }} />
            </div>
            <span class="tiny muted">
              {r.killed} of {plural(r.raid.bosses.length, "boss", "bosses")}
              {r.firstBoss ? ` · ${r.raid.bosses.length === 1 ? "first kill" : "first boss killed"} ${r.firstBoss.by ? "by " : ""}${day(r.firstBoss.t)}` : ""}
              {r.visits ? ` · ${plural(r.visits, "visit")}` : ""}
            </span>
            <div class="boss-grid">
              {r.bosses.map((b) => (
                <div class={`boss${b.kills ? "" : " no"}`} key={b.name}>
                  <b>{b.name}</b>
                  <span class="tiny muted">{b.kills ? `${plural(b.kills, "kill")}${b.wipes ? ` · ${plural(b.wipes, "wipe")}` : ""}` : b.wipes ? `not yet · ${plural(b.wipes, "wipe")}` : "not yet"}</span>
                  {b.kills > 0 && firstLabel(b.first) && <span class="tiny boss-first">{firstLabel(b.first)}</span>}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <p class="tiny muted">
        {source === "jt"
          ? "Journey Tracker keeps kill counts without dates, so a first kill is dated by the raid run it showed up in. Turn on our addon's boss screenshot for the exact time."
          : "Every boss our addon took a screenshot of. Turn on its boss screenshot to catch every boss, not just each raid's last."}
      </p>
    </section>
  );
}

function RaidVisits({ raids }: { raids: RaidRow[] }) {
  return (
    <section class="card">
      <div class="row between" style={{ alignItems: "baseline" }}>
        <h2>Raids</h2>
        <span class="tiny muted">every visit, from Road to Sixty</span>
      </div>
      <div class="raid-grid">
        {raids.map((r) => (
          <div key={r.raid.name} class="stack" style={{ gap: "4px" }}>
            <h3>{r.raid.name}</h3>
            <span class="small muted">
              {[plural(r.visits, "visit"), `${duration(r.inside)} inside`, plural(r.deaths, "death"), plural(r.epics, "epic")].join(" · ")}
            </span>
            {r.firstVisit && (
              <span class="tiny muted">
                First visit {day(r.firstVisit)}
                {r.lastVisit && r.lastVisit !== r.firstVisit ? ` · last ${day(r.lastVisit)}` : ""}
              </span>
            )}
          </div>
        ))}
      </div>
      <p class="tiny muted">Which bosses died needs Journey Tracker or our addon's boss screenshots: Road to Sixty counts a kill only when it gives XP, and nothing does at 60.</p>
    </section>
  );
}

function Runs({ runs, showBosses }: { runs: SixtyRun[]; showBosses: boolean }) {
  return (
    <section class="card">
      <div class="row between" style={{ alignItems: "baseline" }}>
        <h2>Dungeon and raid runs since 60</h2>
        <span class="tiny muted">{plural(runs.length, "run")}</span>
      </div>
      <div class="table-wrap">
        <table class="data">
          <thead>
            <tr>
              <th>When</th>
              <th>Where</th>
              <th style={{ textAlign: "right" }}>Time</th>
              {showBosses && <th style={{ textAlign: "right" }}>Bosses</th>}
              <th style={{ textAlign: "right" }}>Deaths</th>
              <th>Loot</th>
              <th style={{ textAlign: "right" }}>Gold</th>
            </tr>
          </thead>
          <tbody>
            <ShowMore
              rows={runs}
              first={8}
              render={(r) => (
                <tr key={`${r.start}${r.name}`}>
                  <td class="nowrap">{day(r.start)}</td>
                  <td>
                    {r.name}{" "}
                    <span class={`run-tag ${r.raid ? "raid" : "dng"}`}>
                      {r.raid ? "raid" : "dungeon"}
                      {r.groupSize ? ` · ${r.groupSize}` : ""}
                    </span>
                  </td>
                  <td class="num" style={{ textAlign: "right" }}>{r.duration ? duration(r.duration) : "—"}</td>
                  {showBosses && <td class="num" style={{ textAlign: "right" }}>{r.bosses ?? "—"}</td>}
                  <td class="num" style={{ textAlign: "right" }}>{r.deaths ?? "—"}</td>
                  <td>
                    {r.items.length
                      ? r.items
                          .slice()
                          .sort((a, b) => (b.quality ?? 0) - (a.quality ?? 0))
                          .slice(0, 3)
                          .map((i, n) => (
                            <span key={n}>
                              {n ? ", " : ""}
                              <ItemText name={i.name} quality={i.quality} />
                            </span>
                          ))
                      : "—"}
                  </td>
                  <td class={`num ${r.money === undefined ? "" : r.money >= 0 ? "tone-good" : "tone-red"}`} style={{ textAlign: "right" }}>
                    {r.money === undefined ? "—" : `${r.money >= 0 ? "+" : "−"}${gold(Math.abs(r.money))}`}
                  </td>
                </tr>
              )}
            />
          </tbody>
        </table>
      </div>
    </section>
  );
}

function GoldLine({ j, s }: { j: Journey; s: NonNullable<ReturnType<typeof sixtyStats>> }) {
  const pts = s.gold;
  const t0 = pts[0].t, t1 = pts.at(-1)!.t;
  const max = niceMax(Math.max(...pts.map((p) => p.money), 1));
  const peak = pts.reduce((a, p) => (p.money > a.money ? p : a), pts[0]);
  const drops: { x: number; y: number; label: string; color: string }[] = [];
  for (let i = 1; i < pts.length; i++) {
    const lost = pts[i - 1].money - pts[i].money;
    if (lost < 50 * 10000 || lost < pts[i - 1].money * 0.25) continue;
    const learned = j.events.find((e) => e.t >= pts[i - 1].t && e.t <= pts[i].t && (e.k === "mount" || e.k === "ride"));
    drops.push({ x: pts[i].t, y: pts[i].money, label: `−${gold(lost)}${learned?.name ? ` ${learned.name}` : ""}`, color: "var(--red)" });
  }
  const days = Math.max(1, Math.ceil((t1 - t0) / 86400));
  const every = Math.max(1, Math.ceil(days / 5));
  const xTicks: { at: number; label: string }[] = [];
  for (let t = t0; t <= t1; t += every * 86400) xTicks.push({ at: t, label: day(t).replace(/^\w+ /, "") });
  return (
    <>
      <LineChart
        label={`Gold held since 60, from ${gold(pts[0].money)} to ${gold(pts.at(-1)!.money)}`}
        series={[{ label: "Gold", color: "var(--gold)", points: pts.map((p) => [p.t, p.money]) }]}
        area
        height={240}
        x={[t0, Math.max(t1, t0 + 1)]}
        y={[0, max]}
        xTicks={xTicks}
        yTicks={[0, 0.5, 1].map((f) => ({ at: max * f, label: f ? gold(max * f) : "0" }))}
        marks={[{ x: peak.t, y: peak.money, label: `Peak ${gold(peak.money)}`, color: "var(--gold)" }, ...drops.slice(-3)]}
      />
      <p class="tiny muted">Gold held at each login and logout. Big drops are named when you learned a mount or riding then.</p>
    </>
  );
}
