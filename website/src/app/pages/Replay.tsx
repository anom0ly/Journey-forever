import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { describe, duration, levelAt, zoneAt } from "../../lib/insights";
import type { JEvent, Journey } from "../../lib/journey";
import { buildClock, continentsOf, toReal, toReplay, tracksOf, whereAt, type Track } from "../../lib/replay";
import { continentName } from "../../lib/wow";
import { day, time } from "../format";
import { useJourney, type JourneySource } from "../source";

const SPEEDS = [1, 8, 32, 128, 512, 2048];

const LAYERS = [
  { id: "w", label: "On foot or mounted", color: "#5FB8B4", style: "solid" },
  { id: "t", label: "Flight path", color: "#C9B6E4", style: "dashed" },
  { id: "g", label: "Ghost (corpse run)", color: "#ECE6D8", style: "dotted" },
  { id: "die", label: "Deaths", color: "#E07A6A", style: "solid" },
  { id: "lvl", label: "Level ups and quests", color: "#E0B252", style: "dotted" },
  { id: "in", label: "Dungeon entrances", color: "#C9B6E4", style: "solid" },
  { id: "shot", label: "Screenshots and notes", color: "#F0C987", style: "solid" },
] as const;
type LayerId = (typeof LAYERS)[number]["id"];

interface View {
  cx: number; // world y at the canvas centre (screen x)
  cy: number; // world x at the canvas centre (screen y)
  scale: number; // pixels per yard
}

function fitView(tracks: Track[], c: number, w: number, h: number): View {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const tr of tracks) {
    if (tr.c !== c) continue;
    for (let i = 0; i < tr.x.length; i++) {
      if (tr.x[i] < minX) minX = tr.x[i];
      if (tr.x[i] > maxX) maxX = tr.x[i];
      if (tr.y[i] < minY) minY = tr.y[i];
      if (tr.y[i] > maxY) maxY = tr.y[i];
    }
  }
  if (!Number.isFinite(minX)) return { cx: 0, cy: 0, scale: 0.05 };
  const spanX = Math.max(maxX - minX, 400), spanY = Math.max(maxY - minY, 400);
  return { cx: (minY + maxY) / 2, cy: (minX + maxX) / 2, scale: Math.min((w * 0.88) / spanY, (h * 0.88) / spanX) };
}

function draw(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  view: View,
  j: Journey,
  tracks: Track[],
  c: number,
  now: number,
  layers: Set<LayerId>,
  zoneLabels: { name: string; x: number; y: number }[],
) {
  // North up: screen x runs east (world y falls), screen y runs south (world x falls).
  const sx = (y: number) => w / 2 - (y - view.cx) * view.scale;
  const sy = (x: number) => h / 2 - (x - view.cy) * view.scale;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#16211C";
  ctx.fillRect(0, 0, w, h);

  // A faint yard grid for scale: one line per 500 or 1000 yards.
  const step = view.scale > 0.25 ? 500 : view.scale > 0.05 ? 1000 : 5000;
  ctx.strokeStyle = "rgba(62, 82, 71, 0.35)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  const y0 = view.cx + (w / 2) / view.scale, y1 = view.cx - (w / 2) / view.scale;
  for (let y = Math.floor(y1 / step) * step; y <= y0; y += step) {
    ctx.moveTo(sx(y), 0);
    ctx.lineTo(sx(y), h);
  }
  const x0 = view.cy + (h / 2) / view.scale, x1 = view.cy - (h / 2) / view.scale;
  for (let x = Math.floor(x1 / step) * step; x <= x0; x += step) {
    ctx.moveTo(0, sy(x));
    ctx.lineTo(w, sy(x));
  }
  ctx.stroke();

  ctx.font = "13px Inter, sans-serif";
  ctx.fillStyle = "#9DB3A6";
  ctx.textAlign = "center";
  for (const z of zoneLabels) ctx.fillText(z.name, sx(z.y), sy(z.x) - 12);

  const styles: Record<string, { color: string; dash: number[]; width: number }> = {
    w: { color: "#5FB8B4", dash: [], width: 3 },
    t: { color: "#C9B6E4", dash: [6, 6], width: 2.5 },
    g: { color: "#ECE6D8", dash: [1.5, 5], width: 2 },
  };
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const pass of ["future", "past"] as const) {
    for (const tr of tracks) {
      if (tr.c !== c || !layers.has(tr.m as LayerId)) continue;
      const st = styles[tr.m] ?? styles.w;
      const n = tr.t.length;
      if (pass === "past" && tr.t[0] > now) continue;
      ctx.strokeStyle = st.color;
      ctx.globalAlpha = pass === "future" ? 0.16 : 1;
      ctx.lineWidth = st.width;
      ctx.setLineDash(st.dash);
      ctx.beginPath();
      let lx = sx(tr.y[0]), ly = sy(tr.x[0]);
      ctx.moveTo(lx, ly);
      for (let i = 1; i < n; i++) {
        if (pass === "past" && tr.t[i] > now) {
          const here = whereAt([tr], now);
          if (here) ctx.lineTo(sx(here.y), sy(here.x));
          break;
        }
        const px = sx(tr.y[i]), py = sy(tr.x[i]);
        // Points closer than a pixel add nothing at this zoom.
        if (i < n - 1 && Math.abs(px - lx) < 1.2 && Math.abs(py - ly) < 1.2) continue;
        ctx.lineTo(px, py);
        lx = px;
        ly = py;
      }
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);

  for (const e of j.events) {
    if (e.t > now) break;
    if (e.c !== c || e.x === undefined || e.y === undefined) continue;
    const px = sx(e.y as number), py = sy(e.x as number);
    if (px < -20 || py < -20 || px > w + 20 || py > h + 20) continue;
    if (e.k === "die" && layers.has("die")) {
      ctx.strokeStyle = "#E07A6A";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(px - 6, py - 6);
      ctx.lineTo(px + 6, py + 6);
      ctx.moveTo(px + 6, py - 6);
      ctx.lineTo(px - 6, py + 6);
      ctx.stroke();
    } else if ((e.k === "lvl" || e.k === "qd") && layers.has("lvl")) {
      ctx.fillStyle = "#E0B252";
      ctx.globalAlpha = e.k === "lvl" ? 1 : 0.55;
      ctx.beginPath();
      ctx.arc(px, py, e.k === "lvl" ? 4.5 : 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    } else if (e.k === "in" && layers.has("in")) {
      ctx.strokeStyle = "#C9B6E4";
      ctx.lineWidth = 2;
      ctx.strokeRect(px - 8, py - 8, 16, 16);
    } else if ((e.k === "shot" || e.k === "note") && layers.has("shot")) {
      ctx.fillStyle = "#F0C987";
      ctx.beginPath();
      ctx.moveTo(px, py - 7);
      ctx.lineTo(px + 6, py);
      ctx.lineTo(px, py + 7);
      ctx.lineTo(px - 6, py);
      ctx.closePath();
      ctx.fill();
    }
  }

  const here = whereAt(tracks, now);
  if (here && here.c === c) {
    const px = sx(here.y), py = sy(here.x);
    ctx.fillStyle = "rgba(224, 178, 82, 0.25)";
    ctx.beginPath();
    ctx.arc(px, py, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#E0B252";
    ctx.strokeStyle = "#12151A";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(px, py, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

function Player({ j, base }: { j: Journey; base: string }) {
  const tracks = useMemo(() => tracksOf(j.segments), [j]);
  const clock = useMemo(() => buildClock(tracks), [tracks]);
  const continents = useMemo(() => continentsOf(j), [j]);
  const zoneLabels = useMemo(() => {
    const seen = new Set<unknown>();
    const out: { name: string; x: number; y: number; c: number }[] = [];
    for (const e of j.events) {
      if (e.k !== "zone" || seen.has(e.mapID) || e.c === undefined) continue;
      seen.add(e.mapID);
      const name = typeof e.mapID === "number" ? j.zones[e.mapID] : undefined;
      if (name) out.push({ name, x: e.x as number, y: e.y as number, c: e.c });
    }
    return out;
  }, [j]);
  const ticks = useMemo(
    () =>
      j.events
        .filter((e) => e.k === "lvl" || e.k === "die")
        .map((e) => ({ at: clock.total ? toReplay(clock, e.t) / clock.total : 0, color: e.k === "die" ? "#E07A6A" : "#ECE6D8", key: `${e.t}${e.k}` })),
    [j, clock],
  );
  const sessionStarts = useMemo(() => j.sessions.map((s) => s.start), [j]);

  const [r, setR] = useState(clock.total);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(128);
  const [continent, setContinent] = useState<number>(continents[0] ?? 0);
  const [follow, setFollow] = useState(false);
  const [layers, setLayers] = useState<Set<LayerId>>(new Set(["w", "t", "g", "die", "lvl", "shot"]));
  const [view, setView] = useState<View>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 860, h: 620 });
  const drag = useRef<{ x: number; y: number; view: View } | null>(null);

  const now = toReal(clock, r);
  const here = whereAt(tracks, now);

  // Size the canvas to its box, at the screen's pixel density.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => setView(fitView(tracks, continent, size.w, size.h)), [continent, size.w, size.h, tracks]);

  // Play: replay seconds advance at speed x real seconds.
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let id = 0;
    const tick = (t: number) => {
      const dt = (t - last) / 1000;
      last = t;
      setR((v) => {
        const next = Math.min(clock.total, v + dt * speed);
        if (next >= clock.total) setPlaying(false);
        return next;
      });
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [playing, speed, clock.total]);

  // While playing, the map moves to whichever continent the character is on.
  useEffect(() => {
    if (playing && here && here.c !== continent) setContinent(here.c);
  }, [playing, here?.c]);

  const shown: View | undefined = view && follow && here && here.c === continent ? { ...view, cx: here.y, cy: here.x } : view;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !shown) return;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(size.w * dpr)) canvas.width = Math.round(size.w * dpr);
    if (canvas.height !== Math.round(size.h * dpr)) canvas.height = Math.round(size.h * dpr);
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(ctx, size.w, size.h, shown, j, tracks, continent, now, layers, zoneLabels.filter((z) => z.c === continent));
  });

  const onWheel = (e: WheelEvent) => {
    if (!view) return;
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const mx = e.clientX - rect.left - size.w / 2, my = e.clientY - rect.top - size.h / 2;
    const k = Math.exp(-e.deltaY * 0.0015);
    const scale = Math.min(20, Math.max(0.002, view.scale * k));
    const f = 1 / view.scale - 1 / scale;
    // Keep the point under the cursor in place.
    setView({ scale, cx: view.cx - mx * f, cy: view.cy - my * f });
  };
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });

  const session = sessionStarts.filter((s) => s <= now).length;
  const zone = zoneAt(j, now);
  const feed = useMemo(() => {
    const out: { e: JEvent; text: string; tone: string }[] = [];
    for (let i = j.events.length - 1; i >= 0 && out.length < 7; i--) {
      const e = j.events[i];
      if (e.t > now) continue;
      const d = describe(j, e);
      if (d && e.k !== "on" && e.k !== "off" && e.k !== "qa") out.push({ e, ...d });
    }
    return out;
  }, [j, Math.floor(now / 5)]);
  const playedSoFar = j.sessions.reduce((n, s) => n + Math.max(0, Math.min(s.end, now) - s.start), 0);

  if (!tracks.length) {
    return (
      <div class="card flat">
        <h2>No path to replay yet</h2>
        <p class="muted">The map replay draws the path Road to Sixty records. Upload a session played with it installed, then come back.</p>
        <a href={base}>Back to the journey</a>
      </div>
    );
  }

  return (
    <div class="replay">
      <section>
        <div class="row between">
          <div class="row" style={{ gap: "8px" }}>
            {continents.map((c) => (
              <button type="button" class="btn chip" aria-pressed={continent === c} onClick={() => setContinent(c)} key={c}>
                {continentName(c)}
              </button>
            ))}
            <button type="button" class="btn chip" aria-pressed={follow} onClick={() => setFollow(!follow)}>
              Follow character
            </button>
            <button type="button" class="btn chip" onClick={() => setView(fitView(tracks, continent, size.w, size.h))}>
              Fit to path
            </button>
          </div>
          <span class="small muted">Scroll to zoom, drag to move</span>
        </div>

        <div
          class="map"
          ref={wrapRef}
          onPointerDown={(e) => {
            if (!view) return;
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            drag.current = { x: e.clientX, y: e.clientY, view };
            setFollow(false);
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d) return;
            setView({ ...d.view, cx: d.view.cx + (e.clientX - d.x) / d.view.scale, cy: d.view.cy + (e.clientY - d.y) / d.view.scale });
          }}
          onPointerUp={() => (drag.current = null)}
        >
          <canvas ref={canvasRef} role="img" aria-label={`Map of ${j.character.name}'s path on ${continentName(continent)}`} />
          <div class="hud">
            <span class="tiny muted">
              {session ? `Session ${session} of ${j.sessions.length} · ${day(now)}` : day(now)}
            </span>
            <span style={{ fontWeight: 600 }}>
              Level {levelAt(j, now)}
              {zone ? ` · ${zone}` : ""}
            </span>
            <span class="tiny muted">
              {time(now)} · {duration(playedSoFar)} played
              {here && here.c !== continent ? ` · now in ${continentName(here.c)}` : ""}
            </span>
          </div>
        </div>

        <div class="card" style={{ padding: "16px 20px", gap: "12px" }}>
          <div class="controls">
            <button
              type="button"
              class="play"
              aria-label={playing ? "Pause" : "Play"}
              onClick={() => {
                if (!playing && r >= clock.total) setR(0);
                setPlaying(!playing);
              }}
            >
              {playing ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="#12151A" aria-hidden="true">
                  <rect x="6" y="5" width="4" height="14" />
                  <rect x="14" y="5" width="4" height="14" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="#12151A" aria-hidden="true">
                  <path d="M7 4l13 8-13 8z" />
                </svg>
              )}
            </button>
            <div class="stack" style={{ flex: "1 1 360px", minWidth: 0, gap: "6px" }}>
              <div class="scrub">
                <div class="rail" />
                <div class="fill" style={{ width: `${clock.total ? (r / clock.total) * 100 : 0}%` }} />
                {ticks.map((t) => (
                  <div class="tick" key={t.key} style={{ left: `${t.at * 100}%`, background: t.color }} />
                ))}
                <div class="knob" style={{ left: `${clock.total ? (r / clock.total) * 100 : 0}%` }} />
                <input
                  type="range"
                  min={0}
                  max={Math.max(1, clock.total)}
                  step={1}
                  value={r}
                  aria-label="Journey timeline"
                  aria-valuetext={`${day(now)} ${time(now)}`}
                  onInput={(e) => setR(Number((e.target as HTMLInputElement).value))}
                />
              </div>
              <div class="row between tiny muted">
                <span>Level 1 · {day(toReal(clock, 0))}</span>
                <span>Now · Level {j.character.level}</span>
              </div>
            </div>
            <div class="speeds" role="group" aria-label="Playback speed">
              {SPEEDS.map((s) => (
                <button type="button" aria-pressed={speed === s} onClick={() => setSpeed(s)} key={s}>
                  {s}x
                </button>
              ))}
            </div>
          </div>
          <span class="tiny muted">
            Ticks on the timeline: white = level up, red = death. The replay skips time spent offline and inside dungeons, where the game gives
            no position.
          </span>
        </div>
      </section>

      <aside>
        <div class="card" style={{ padding: "20px", gap: "12px" }}>
          <h2 style={{ fontSize: "20px" }}>Show on map</h2>
          {LAYERS.map((l) => (
            <label class="layer" key={l.id}>
              <input
                type="checkbox"
                checked={layers.has(l.id)}
                onChange={() => {
                  const next = new Set(layers);
                  if (next.has(l.id)) next.delete(l.id);
                  else next.add(l.id);
                  setLayers(next);
                }}
              />
              <span class="swatch" style={{ borderTopStyle: l.style, borderTopColor: l.color }} />
              <span>{l.label}</span>
            </label>
          ))}
        </div>
        <div class="card" style={{ padding: "20px", gap: "12px" }}>
          <h2 style={{ fontSize: "20px" }}>Happening now</h2>
          <div class="feed stack-lg">
            {feed.length ? (
              feed.map((f) => (
                <div key={`${f.e.t}${f.e.k}${f.text}`}>
                  <span class="muted num">{time(f.e.t)}</span>
                  <span class={`tone-${f.tone}`}>{f.text}</span>
                </div>
              ))
            ) : (
              <span class="small muted">Press play to start the journey.</span>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}

export function ReplayPage({ source }: { source: JourneySource }) {
  const { data, error } = useJourney(source);
  return (
    <main class="page wide">
      <div class="row between">
        {data ? (
          <a href={data.base} class="small" style={{ textDecoration: "none", color: "var(--muted)" }}>
            ← {data.journey.character.name}'s journey
          </a>
        ) : (
          <span />
        )}
        {source.kind === "demo" && <span class="tiny muted">Sample data</span>}
      </div>
      {error ? (
        <div class="notice err">{error}</div>
      ) : data ? (
        <Player j={data.journey} base={data.base} />
      ) : (
        <p class="muted" role="status">
          Loading the journey…
        </p>
      )}
    </main>
  );
}
