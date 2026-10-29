import { useMemo, useState } from "preact/hooks";
import {
  deathRows,
  duration,
  gold,
  goldFlows,
  levelBars,
  moments,
  played,
  tiles,
  zoneAt,
} from "../../lib/insights";
import type { Journey, JEvent } from "../../lib/journey";
import { firstSeen } from "../../lib/merge";
import { decodeSegment, distanceByMode, km } from "../../lib/path";
import { QUALITY_COLORS } from "../../lib/wow";
import type { Screenshot, StoredCharacter } from "../api";
import { classColor, date, dateTime, day, describeCharacter, plural } from "../format";
import { useJourney, type JourneySource } from "../source";
import { PublicToggle, shareUrl } from "./Characters";

function RouteThumb({ j }: { j: Journey }) {
  const { lines, end, zones } = useMemo(() => {
    // The continent with the most path, drawn north up.
    const byC = new Map<number, number>();
    for (const s of j.segments) byC.set(s.c, (byC.get(s.c) ?? 0) + s.d.length + 1);
    const c = [...byC.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const segs = j.segments.filter((s) => s.c === c);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const pts = segs.map((s) => decodeSegment(s));
    for (const p of pts) for (let i = 0; i < p.x.length; i++) {
      minX = Math.min(minX, p.x[i]); maxX = Math.max(maxX, p.x[i]);
      minY = Math.min(minY, p.y[i]); maxY = Math.max(maxY, p.y[i]);
    }
    const W = 320, H = 220, pad = 18;
    const span = Math.max(maxX - minX, maxY - minY, 200);
    const scale = Math.min((W - pad * 2) / Math.max(maxY - minY, 1), (H - pad * 2) / Math.max(maxX - minX, 1), (W - pad * 2) / span * 3);
    const cx = (minY + maxY) / 2, cy = (minX + maxX) / 2;
    // Screen x grows east (world y shrinks), screen y grows south (world x shrinks).
    const sx = (y: number) => W / 2 - (y - cx) * scale;
    const sy = (x: number) => H / 2 - (x - cy) * scale;
    const lines = pts.map((p) => {
      const step = Math.max(1, Math.floor(p.x.length / 200));
      const out: string[] = [];
      for (let i = 0; i < p.x.length; i += step) out.push(`${sx(p.y[i]).toFixed(1)},${sy(p.x[i]).toFixed(1)}`);
      out.push(`${sx(p.y.at(-1)!).toFixed(1)},${sy(p.x.at(-1)!).toFixed(1)}`);
      return { pts: out.join(" "), flight: segs[pts.indexOf(p)].m === "t" };
    });
    const last = pts.at(-1);
    const end = last ? { x: sx(last.y.at(-1)!), y: sy(last.x.at(-1)!) } : undefined;
    const zones = new Set(j.events.filter((e) => e.k === "zone").map((e) => e.mapID)).size;
    return { lines, end, zones };
  }, [j]);
  const dist = distanceByMode(j.segments);
  return (
    <>
      <svg viewBox="0 0 320 220" style={{ width: "100%", height: "auto", borderRadius: "10px", background: "#1E2A24" }} role="img" aria-label="Thumbnail of the route walked so far">
        {lines.map((l, i) => (
          <polyline
            key={i}
            points={l.pts}
            fill="none"
            stroke={l.flight ? "#C9B6E4" : "#5FB8B4"}
            stroke-width={l.flight ? 2 : 2.5}
            stroke-dasharray={l.flight ? "2 6" : undefined}
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        ))}
        {end && <circle cx={end.x} cy={end.y} r="6" fill="#E0B252" />}
        {!lines.length && (
          <text x="160" y="115" text-anchor="middle" fill="#A7A196" font-size="13">
            No path yet (needs Road to Sixty)
          </text>
        )}
      </svg>
      <span class="small muted">
        {plural(zones, "zone")} · {km(dist.w)} km on foot or mounted{dist.t ? `, ${km(dist.t)} km by flight path` : ""}
        {dist.g ? `, ${km(dist.g)} km as a ghost` : ""}
      </span>
    </>
  );
}

function LevelChart({ j }: { j: Journey }) {
  const bars = levelBars(j);
  const known = bars.filter((b) => b.seconds !== undefined);
  const max = Math.max(60, ...known.map((b) => b.seconds!));
  const slowest = known.reduce<(typeof bars)[number] | undefined>((a, b) => (!a || b.seconds! > a.seconds! ? b : a), undefined);
  return (
    <div class="card wide">
      <div class="row between" style={{ alignItems: "baseline" }}>
        <h2>Time at each level</h2>
        <span class="tiny muted">Played time per level · hover a bar for details</span>
      </div>
      {bars.length > 1 || known.length ? (
        <>
          <div class="bars" role="img" aria-label={`Played time on levels 1 to ${bars.length}`}>
            {bars.map((b) => (
              <div
                key={b.level}
                class={b.seconds === undefined ? "unknown" : b.died ? "died" : ""}
                style={{ height: `${b.seconds === undefined ? 4 : Math.max(2, Math.round((b.seconds / max) * 100))}%` }}
                title={`Level ${b.level}: ${b.seconds === undefined ? "time not recorded" : duration(b.seconds)}${b.died ? " · included a death" : ""}${b.zone ? ` · ${b.zone}` : ""}`}
              />
            ))}
          </div>
          <div class="row between tiny muted">
            <span>Level 1</span>
            <span>Level {bars.length}</span>
          </div>
          <p class="small muted">
            {slowest ? `Slowest level so far: ${slowest.level} (${duration(slowest.seconds)})${slowest.zone ? `, mostly in ${slowest.zone}` : ""}. ` : ""}
            Gold bars mark levels that included a death.
          </p>
        </>
      ) : (
        <p class="muted small">Level times show up once the character has gained a level with Road to Sixty or Journey Tracker running.</p>
      )}
    </div>
  );
}

function GoldCard({ j }: { j: Journey }) {
  const g = goldFlows(j);
  if (g.earned === undefined && !g.incoming.length) {
    return (
      <div class="card">
        <h2>Gold in and out</h2>
        <p class="muted small">The gold breakdown comes from Journey Tracker. Install it and upload again to see where your gold came from and went.</p>
      </div>
    );
  }
  const maxIn = Math.max(1, ...g.incoming.map((r) => r.amount));
  const maxOut = Math.max(1, ...g.outgoing.map((r) => r.amount));
  return (
    <div class="card">
      <h2>Gold in and out</h2>
      <div class="row" style={{ gap: "32px" }}>
        {[["Earned", g.earned, "var(--gold)"], ["Spent", g.spent, "var(--text)"], ["On hand", g.onHand, "var(--text)"]].map(([label, v, color]) =>
          v === undefined ? null : (
            <div class="stack" style={{ gap: "2px" }} key={label as string}>
              <span class="tiny muted">{label}</span>
              <span style={{ fontSize: "24px", fontWeight: 600, color: color as string }} class="num">
                {gold(v as number)}
              </span>
            </div>
          ),
        )}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "24px" }}>
        {[["Where it came from", g.incoming, maxIn, ""], ["Where it went", g.outgoing, maxOut, "grey"]].map(([title, rows, max, cls]) => (
          <div class="stack" style={{ gap: "10px" }} key={title as string}>
            <span class="tiny muted" style={{ fontWeight: 600 }}>
              {title as string}
            </span>
            {(rows as { label: string; amount: number }[]).map((r) => (
              <div class="stack small" style={{ gap: "4px" }} key={r.label}>
                <div class="row between">
                  <span>{r.label}</span>
                  <span class="num">{gold(r.amount)}</span>
                </div>
                <div class={`meter ${cls}`}>
                  <div style={{ width: `${Math.round((r.amount / (max as number)) * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function Deaths({ j }: { j: Journey }) {
  const rows = deathRows(j);
  return (
    <div class="card">
      <h2>Deaths</h2>
      {rows.length ? (
        <div class="rows stack-lg">
          {rows.slice(0, 8).map((d) => (
            <div key={d.t}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#E07A6A" stroke-width="2" stroke-linecap="round" aria-hidden="true" style={{ flex: "none", marginTop: "2px" }}>
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
              <div class="stack" style={{ gap: "2px" }}>
                <span style={{ fontWeight: 600 }}>
                  {d.level ? `Level ${d.level}` : "Death"}
                  {d.killer ? ` · ${d.killer}` : ""}
                </span>
                <span class="small muted">{[d.where, dateTime(d.t)].filter(Boolean).join(" · ")}</span>
              </div>
            </div>
          ))}
          {rows.length > 8 && <span class="tiny muted">And {plural(rows.length - 8, "more death")}.</span>}
        </div>
      ) : (
        <p class="muted small">No deaths yet. Keep it that way.</p>
      )}
    </div>
  );
}

function Moments({ j }: { j: Journey }) {
  const list = moments(j);
  return (
    <div class="card">
      <h2>Milestones and notable loot</h2>
      {list.slice(0, 14).map((m) => (
        <div class="moment" key={`${m.t}${m.title}`}>
          <span class="muted">{m.level ? `Level ${m.level}` : ""}</span>
          <div class="stack" style={{ gap: "2px" }}>
            <span style={{ fontWeight: 600, color: m.quality !== undefined ? QUALITY_COLORS[m.quality] : "var(--text)" }}>{m.title}</span>
            <span class="muted">{[m.where, day(m.t)].filter(Boolean).join(" · ")}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function Sessions({ j }: { j: Journey }) {
  const list = [...j.sessions].reverse().slice(0, 8);
  return (
    <div class="card">
      <h2>Sessions</h2>
      {list.length ? (
        list.map((s) => {
          const zone = zoneAt(j, s.end);
          const lv = s.startLevel !== undefined && s.endLevel !== undefined && s.endLevel !== s.startLevel ? `Level ${s.startLevel} → ${s.endLevel}` : s.endLevel ? `Level ${s.endLevel}` : "";
          return (
            <div class="row between small" key={s.start} style={{ paddingBottom: "12px", borderBottom: "1px solid var(--line)", flexWrap: "nowrap" }}>
              <div class="stack" style={{ gap: "2px" }}>
                <span style={{ fontWeight: 600 }}>{day(s.start)}</span>
                <span class="muted">{[lv, zone].filter(Boolean).join(" · ")}</span>
              </div>
              <span class="muted" style={{ whiteSpace: "nowrap" }}>
                {duration(s.end - s.start)}
              </span>
            </div>
          );
        })
      ) : (
        <p class="muted small">No sessions recorded yet.</p>
      )}
    </div>
  );
}

interface GalleryItem {
  t: number;
  label: string;
  shot?: Screenshot;
  note?: JEvent;
}

function Gallery({ j, shots }: { j: Journey; shots: Screenshot[] }) {
  const [open, setOpen] = useState<Screenshot>();
  const items: GalleryItem[] = [
    ...shots.map((s) => ({ t: s.t, label: s.label ?? "Screenshot", shot: s })),
    ...j.events.filter((e) => e.k === "note").map((e) => ({ t: e.t, label: String(e.text), note: e })),
  ].sort((a, b) => b.t - a.t);
  const logged = j.events.filter((e) => e.k === "shot").length;
  return (
    <div class="card">
      <div class="row between" style={{ alignItems: "baseline" }}>
        <h2>Screenshots and notes</h2>
        <span class="tiny muted">
          {plural(shots.length, "screenshot")} · {plural(items.length - shots.length, "note")}
        </span>
      </div>
      {items.length ? (
        <div class="shots">
          {items.slice(0, 48).map((it) =>
            it.shot ? (
              <button type="button" class="shot" key={it.shot.id} onClick={() => setOpen(it.shot)} style={{ background: "none", border: "none", padding: 0, textAlign: "left", cursor: "zoom-in" }}>
                <div class="img">
                  <img src={it.shot.thumb} alt={it.label} loading="lazy" />
                </div>
                <span class="what">{it.label}</span>
                <span class="tiny muted">{dateTime(it.t)}</span>
              </button>
            ) : (
              <div class="shot" key={`n${it.t}`}>
                <div class="img" style={{ display: "flex", alignItems: "center", padding: "12px", background: "var(--surface-2)", borderColor: "var(--line)" }}>
                  <span class="small" style={{ fontFamily: "var(--serif)", fontStyle: "italic" }}>“{it.label}”</span>
                </div>
                <span class="what">Note{it.note?.zone ? ` · ${it.note.zone}` : ""}</span>
                <span class="tiny muted">{dateTime(it.t)}</span>
              </div>
            ),
          )}
        </div>
      ) : (
        <p class="muted small">
          {logged
            ? `Our addon logged ${plural(logged, "screenshot")}; upload the image files with your next session to see them here.`
            : "Screenshots from Journey Forever (dungeon clears, epic loot, level ups) and your /jf notes show up here."}
        </p>
      )}
      {open && (
        <div class="lightbox" role="dialog" aria-label={open.label ?? "Screenshot"} onClick={() => setOpen(undefined)}>
          <img src={open.url} alt={open.label ?? "Screenshot"} />
          <span>{open.label}</span>
          <span class="small muted">{[dateTime(open.t), zoneAt(j, open.t)].filter(Boolean).join(" · ")}</span>
          <button type="button" class="btn" onClick={() => setOpen(undefined)}>
            Close
          </button>
        </div>
      )}
    </div>
  );
}

function Sources({ j }: { j: Journey }) {
  const notes = j.sources.filter((s) => s.status !== "ok");
  if (!notes.length) return null;
  const names: Record<string, string> = { rts: "Road to Sixty", jt: "Journey Tracker", jf: "Journey Forever" };
  return (
    <div class="notice warn small">
      {notes.map((s) => (
        <div key={s.addon}>
          {names[s.addon]}: {s.message ?? (s.status === "missing" ? "not uploaded, so some sections are empty." : "couldn't be read.")}
        </div>
      ))}
      <a href="/data">What each addon adds</a>
    </div>
  );
}

export function JourneyView({ j, stored, shots, base, onStored }: { j: Journey; stored?: StoredCharacter; shots: Screenshot[]; base: string; onStored?: (c: StoredCharacter) => void }) {
  const c = j.character;
  const start = firstSeen(j);
  const p = played(j);
  return (
    <main class="page">
      <section class="row between" style={{ gap: "24px" }}>
        <div class="row" style={{ gap: "20px", flexWrap: "nowrap" }}>
          <div class="avatar lg" style={{ background: classColor(c.className) }} aria-hidden="true">
            {c.name.charAt(0)}
          </div>
          <div class="stack" style={{ gap: "4px", minWidth: 0 }}>
            <h1>{c.name}</h1>
            <span class="muted">
              {[`Level ${c.level} ${describeCharacter(c)}`, c.realm, start && `Started ${date(start)}`, p && `${duration(p)} played`].filter(Boolean).join(" · ")}
            </span>
          </div>
        </div>
        <div class="row">
          {stored && onStored ? <PublicToggle c={stored} onChange={onStored} /> : stored?.isPublic ? <span class="pill teal">Public</span> : null}
          <a class="btn primary" href={`${base}/replay`}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="#12151A" aria-hidden="true">
              <path d="M7 4l13 8-13 8z" />
            </svg>
            Replay journey
          </a>
        </div>
      </section>
      {stored && onStored && stored.isPublic && stored.slug && (
        <p class="small muted" style={{ marginTop: "-16px", overflowWrap: "anywhere" }}>
          Share link: <a href={`/j/${stored.slug}`}>{shareUrl(stored.slug)}</a>
        </p>
      )}
      {base === "/demo" && <div class="notice small">This is a made-up sample journey, built from the sample saved files that ship with the site. Nothing here is saved.</div>}
      <Sources j={j} />

      <section class="tiles">
        {tiles(j).map((t) => (
          <div class="tile" key={t.label}>
            <span class="label">{t.label}</span>
            <span class={`value${t.value === undefined ? " none" : ""}`}>{t.value ?? "—"}</span>
            <span class="sub">{t.value === undefined && t.needs ? `needs ${t.needs}` : t.sub}</span>
          </div>
        ))}
      </section>

      <section class="split">
        <LevelChart j={j} />
        <a href={`${base}/replay`} class="card" style={{ textDecoration: "none", color: "var(--text)" }}>
          <h2>Route so far</h2>
          <RouteThumb j={j} />
        </a>
      </section>

      <section class="split">
        <div class="wide" style={{ display: "flex" }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
            <GoldCard j={j} />
          </div>
        </div>
        <Deaths j={j} />
      </section>

      <Gallery j={j} shots={shots} />

      <section class="split">
        <div class="wide" style={{ display: "flex", flexDirection: "column" }}>
          <Moments j={j} />
        </div>
        <Sessions j={j} />
      </section>
    </main>
  );
}

export function JourneyPage({ source }: { source: JourneySource }) {
  const { data, error } = useJourney(source);
  const [stored, setStored] = useState<StoredCharacter>();
  if (error) {
    return (
      <main class="page narrow">
        <h1>Couldn't open this journey</h1>
        <p class="muted">{error}</p>
      </main>
    );
  }
  if (!data) {
    return (
      <main class="page narrow">
        <p class="muted" role="status">
          Loading the journey…
        </p>
      </main>
    );
  }
  return (
    <JourneyView
      j={data.journey}
      stored={stored ?? data.stored}
      shots={data.screenshots}
      base={data.base}
      onStored={source.kind === "owner" ? setStored : undefined}
    />
  );
}
