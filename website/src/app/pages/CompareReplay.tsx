// The compare page's Replay tab: both characters on one map, on one clock.
// The clock is time played (both start at 0 and count only time logged in)
// or level (each moves through a level at their own pace). When the two are
// on different continents the map splits in two.

import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { describe, duration, zoneAt } from "../../lib/insights";
import type { JEvent, Journey } from "../../lib/journey";
import { continentMap } from "../../lib/maps";
import { levelAtPlayed, levelCurve, levelKnownAt, playClock, playedAt, playedAtLevel, realAt, type LevelCurve, type PlayClock } from "../../lib/playclock";
import { continentsOf, tracksOf, whereAt, type Here, type Track } from "../../lib/replay";
import { visits, type Visit } from "../../lib/stats";
import { continentName } from "../../lib/wow";
import { classColor, describeCharacter } from "../format";
import { mapArt } from "../mapArt";
import { drawMap, fitView, screen, type Fade, type View } from "./Replay";
import type { Screenshot } from "../api";
import { pinsAt, pinsOf, type Pin } from "../../lib/pins";
import { CLICK_SLOP, drawPin, drawPinMark, PinCard } from "../PinCard";

const INK = { a: "#E0B252", b: "#C9B6E4" } as const;
const SPEEDS = [
  { per: 300, label: "5 min" },
  { per: 900, label: "15 min" },
  { per: 2700, label: "45 min" },
];
const FEED_KINDS = new Set(["lvl", "die", "in", "out", "qd", "rare", "zone", "shot", "note", "ride", "mount"]);

type Mode = "time" | "level";
type Cam = "both" | "all";

interface Prep {
  key: "a" | "b";
  j: Journey;
  ink: string;
  tracks: Track[];
  clock: PlayClock;
  curve: LevelCurve;
  visits: Visit[];
  feed: JEvent[];
  visited: Set<number>;
  pins: Pin[];
}

// Where one character is at the replay's current moment.
interface Now {
  p: Prep;
  played: number; // played seconds
  t: number; // real time
  here?: Here;
  inside?: Visit;
  before: boolean; // before the record starts
  over: boolean; // past the end of the record
}

function prep(j: Journey, key: "a" | "b", shots: Screenshot[]): Prep {
  const clock = playClock(j);
  return {
    key,
    j,
    ink: INK[key],
    tracks: tracksOf(j.segments),
    clock,
    curve: levelCurve(j, clock),
    visits: visits(j).filter((v) => !v.pvp || v.to > v.from),
    feed: j.events.filter((e) => FEED_KINDS.has(e.k)),
    visited: new Set(j.events.filter((e) => e.k === "zone" && typeof e.mapID === "number").map((e) => e.mapID as number)),
    pins: pinsOf(j, shots),
  };
}

function at(p: Prep, played: number | undefined): Now {
  const over = played === undefined || played > p.clock.total + 1;
  const before = played !== undefined && played < p.clock.first;
  const t = over ? p.clock.end.at(-1) ?? 0 : realAt(p.clock, played!);
  const inside = p.visits.find((v) => v.from <= t && (v.to > t || (v.to === v.from && !over && t >= v.from)));
  return { p, played: over ? p.clock.total : played!, t, here: before ? undefined : whereAt(p.tracks, t), inside, before, over };
}

function doing(n: Now): string {
  if (n.before) return "Not recorded yet";
  if (n.over) return "Journey so far ends here";
  if (n.inside) return `In ${n.inside.name ?? "an instance"}`;
  const tr = n.p.tracks.find((tr) => tr.t[0] <= n.t && tr.t[tr.t.length - 1] >= n.t);
  if (tr?.m === "t") return "On a flight path";
  if (tr?.m === "g") return "Running back as a ghost";
  const zone = zoneAt(n.p.j, n.t);
  return zone ? `In ${zone}` : n.here ? `Out in ${continentName(n.here.c)}` : "Somewhere without a recorded path";
}

// ---------------------------------------------------------------- map

function targetView(panes: Now[], all: Now[], c: number, cam: Cam, w: number, h: number): View {
  if (cam === "all") return fitView(all.flatMap((n) => n.p.tracks), c, w, h);
  const pts = panes.filter((n) => n.here && n.here.c === c).map((n) => n.here!);
  if (!pts.length) return fitView(all.flatMap((n) => n.p.tracks), c, w, h);
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  // At least a zone's worth of map around them.
  const spanX = Math.max((maxX - minX) * 1.4, 1600), spanY = Math.max((maxY - minY) * 1.4, 1600);
  return { cx: (minY + maxY) / 2, cy: (minX + maxX) / 2, scale: Math.min(w / spanY, h / spanX) };
}

function drawSide(ctx: CanvasRenderingContext2D, n: Now, c: number, sx: (y: number) => number, sy: (x: number) => number) {
  const dash: Record<string, number[]> = { w: [], t: [7, 6], g: [1.5, 5.5] };
  const trace = (tr: Track, upTo: number) => {
    ctx.beginPath();
    let lx = sx(tr.y[0]), ly = sy(tr.x[0]);
    ctx.moveTo(lx, ly);
    for (let i = 1; i < tr.t.length; i++) {
      if (tr.t[i] > upTo) {
        const here = whereAt([tr], upTo);
        if (here) ctx.lineTo(sx(here.y), sy(here.x));
        break;
      }
      const px = sx(tr.y[i]), py = sy(tr.x[i]);
      if (i < tr.t.length - 1 && Math.abs(px - lx) < 1.2 && Math.abs(py - ly) < 1.2) continue;
      ctx.lineTo(px, py);
      lx = px;
      ly = py;
    }
  };
  const tracks = n.p.tracks.filter((tr) => tr.c === c);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.globalAlpha = 0.28;
  ctx.strokeStyle = n.p.ink;
  ctx.lineWidth = 2;
  for (const tr of tracks) {
    ctx.setLineDash(dash[tr.m] ?? []);
    trace(tr, Infinity);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  for (const part of ["halo", "line"] as const) {
    for (const tr of tracks) {
      if (tr.t[0] > n.t || n.before) continue;
      ctx.strokeStyle = part === "halo" ? "rgba(18, 13, 13, 0.8)" : n.p.ink;
      ctx.lineWidth = part === "halo" ? 7 : 3.2;
      ctx.setLineDash(dash[tr.m] ?? []);
      trace(tr, n.t);
      ctx.stroke();
    }
  }
  ctx.setLineDash([]);
  for (const e of n.p.j.events) {
    if (e.t > n.t || n.before) break;
    if (e.k !== "die" || e.c !== c || e.x === undefined || e.y === undefined) continue;
    const px = sx(e.y as number), py = sy(e.x as number);
    for (const [color, width] of [["rgba(18, 13, 13, 0.85)", 6], ["#F29C93", 3]] as const) {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(px - 5, py - 5);
      ctx.lineTo(px + 5, py + 5);
      ctx.moveTo(px + 5, py - 5);
      ctx.lineTo(px - 5, py + 5);
      ctx.stroke();
    }
  }
}

// Each side's screenshots and notes: purple diamonds edged in its colour.
function drawPins(ctx: CanvasRenderingContext2D, n: Now, c: number, sx: (y: number) => number, sy: (x: number) => number) {
  if (n.before) return;
  for (const p of n.p.pins) {
    if (p.t > n.t) break;
    if (p.c === c) drawPin(ctx, sx(p.y), sy(p.x), n.p.ink);
  }
}

// The diamonds under a point, from whichever side has one there.
function pinsUnder(all: Now[], c: number, px: number, py: number, sx: (y: number) => number, sy: (x: number) => number): { n: Now; pins: Pin[] } | undefined {
  for (const n of all) {
    if (n.before) continue;
    const pins = pinsAt(n.p.pins, c, n.t, px, py, sx, sy);
    if (pins.length) return { n, pins };
  }
  return undefined;
}

function drawDot(ctx: CanvasRenderingContext2D, n: Now, x: number, y: number) {
  const name = n.p.j.character.name;
  const hollow = !!n.inside && !n.over;
  ctx.globalAlpha = n.over ? 0.55 : 1;
  ctx.fillStyle = "rgba(18, 13, 13, 0.6)";
  ctx.beginPath();
  ctx.arc(x, y, 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, 10, 0, Math.PI * 2);
  if (hollow) {
    ctx.strokeStyle = n.p.ink;
    ctx.lineWidth = 3;
    ctx.stroke();
  } else {
    ctx.fillStyle = n.p.ink;
    ctx.fill();
  }
  ctx.fillStyle = hollow ? n.p.ink : "#120D0D";
  ctx.font = "700 12px Spectral, Georgia, serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(name.charAt(0), x, y + 0.5);
  const tag = hollow ? `${name} · in ${n.inside!.name ?? "an instance"}` : name;
  ctx.font = "600 12px Inter, system-ui, sans-serif";
  const tw = ctx.measureText(tag).width;
  const tx = n.p.key === "a" ? x - 18 - tw - 12 : x + 18;
  ctx.fillStyle = "rgba(18, 13, 13, 0.85)";
  ctx.beginPath();
  ctx.roundRect(tx, y - 11, tw + 12, 22, 6);
  ctx.fill();
  ctx.fillStyle = n.p.ink;
  ctx.textAlign = "left";
  ctx.fillText(tag, tx + 6, y + 0.5);
  ctx.globalAlpha = 1;
}

function MapPane({
  c,
  panes,
  all,
  cam,
  playing,
  label,
  onOpen,
  onJump,
}: {
  c: number;
  panes: Now[];
  all: Now[];
  cam: Cam;
  playing: boolean;
  label?: string;
  onOpen: () => void;
  onJump: (key: "a" | "b", t: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 860, h: 560 });
  const [, setFrame] = useState(0);
  const fade = useRef<Fade>({ at: 0, busy: false });
  const view = useRef<{ v: View; c: number; cam: Cam }>();
  const press = useRef<{ x: number; y: number } | null>(null);
  const [hover, setHover] = useState<{ key: "a" | "b"; pins: Pin[] }>();
  const [open, setOpen] = useState<{ key: "a" | "b"; pins: Pin[] }>();
  const nowOf = (key: "a" | "b") => all.find((n) => n.p.key === key)!;
  // A card shows while its diamond does.
  const shownCard = open && open.pins[0].c === c && !nowOf(open.key).before && open.pins[0].t <= nowOf(open.key).t ? open : undefined;
  const under = (e: PointerEvent) => {
    const v = view.current?.v;
    if (!v) return undefined;
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const { sx, sy } = screen(v, size.w, size.h);
    const hit = pinsUnder(all, c, e.clientX - box.left, e.clientY - box.top, sx, sy);
    return hit && { key: hit.n.p.key, pins: hit.pins };
  };

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !size.w || !size.h) return;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(size.w * dpr)) canvas.width = Math.round(size.w * dpr);
    if (canvas.height !== Math.round(size.h * dpr)) canvas.height = Math.round(size.h * dpr);
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // The camera glides while playing and jumps when scrubbing.
    const target = targetView(panes, all, c, cam, size.w, size.h);
    const old = view.current;
    let v = target, moving = false;
    if (old && old.c === c && old.cam === cam && playing) {
      const k = 0.12;
      v = { cx: old.v.cx + (target.cx - old.v.cx) * k, cy: old.v.cy + (target.cy - old.v.cy) * k, scale: old.v.scale * Math.pow(target.scale / old.v.scale, k) };
      moving = Math.abs(v.cx - target.cx) * v.scale > 0.5 || Math.abs(v.cy - target.cy) * v.scale > 0.5 || Math.abs(v.scale / target.scale - 1) > 0.005;
    }
    view.current = { v, c, cam };

    const redraw = () => setFrame((n) => n + 1);
    const visited = new Set([...all[0].p.visited, ...all[1].p.visited]);
    drawMap(ctx, size.w, size.h, v, c, visited, (id, soft) => mapArt(id, redraw, soft), fade.current);
    const { sx, sy } = screen(v, size.w, size.h);
    for (const n of [...all].reverse()) drawSide(ctx, n, c, sx, sy);
    for (const n of [...all].reverse()) drawPins(ctx, n, c, sx, sy);
    for (const [m, isOpen] of [[hover, false], [shownCard, true]] as const) {
      const p = m?.pins[0];
      if (p) drawPinMark(ctx, sx(p.y), sy(p.x), isOpen, nowOf(m.key).p.ink);
    }
    const dots = panes.filter((n) => n.here && n.here.c === c).map((n) => ({ n, x: sx(n.here!.y), y: sy(n.here!.x) }));
    // Two dots on the same spot: nudge the second so both show.
    if (dots.length === 2 && Math.hypot(dots[0].x - dots[1].x, dots[0].y - dots[1].y) < 18) {
      dots[1].x += 12;
      dots[1].y -= 8;
    }
    for (const d of dots.reverse()) drawDot(ctx, d.n, d.x, d.y);
    if (fade.current.busy || moving) {
      const id = requestAnimationFrame(redraw);
      return () => cancelAnimationFrame(id);
    }
  });

  const names = panes.map((n) => n.p.j.character.name).join(" and ");
  const at = (p: Pin) => {
    const v = view.current?.v ?? targetView(panes, all, c, cam, size.w, size.h);
    const { sx, sy } = screen(v, size.w, size.h);
    return { x: sx(p.y), y: sy(p.x) };
  };
  return (
    <div
      class="map duo-map"
      ref={wrapRef}
      style={hover ? { cursor: "pointer" } : undefined}
      onPointerDown={(e) => (press.current = { x: e.clientX, y: e.clientY })}
      onPointerMove={(e) => {
        if (press.current) return;
        const h = under(e);
        if ((h?.pins[0].t ?? -1) !== (hover?.pins[0].t ?? -1) || h?.key !== hover?.key) setHover(h);
      }}
      onPointerUp={(e) => {
        const p = press.current;
        press.current = null;
        if (!p || Math.hypot(e.clientX - p.x, e.clientY - p.y) >= CLICK_SLOP) return;
        const h = under(e);
        setOpen(h);
        if (h) onOpen();
      }}
      onPointerLeave={() => setHover(undefined)}
    >
      <canvas ref={canvasRef} role="img" aria-label={`Map of ${continentName(c)}${names ? ` with ${names}` : ""}`} />
      {label && <span class="duo-map-label">{label}</span>}
      {continentMap(c)?.art && <span class="credit">Map art © Blizzard Entertainment</span>}
      {hover && !shownCard && (
        <span class="pin-tip" style={{ left: `${at(hover.pins[0]).x}px`, top: `${at(hover.pins[0]).y}px` }}>
          {nowOf(hover.key).p.j.character.name}: {hover.pins[0].k === "note" ? "Note" : hover.pins[0].title}
          {hover.pins.length > 1 ? ` +${hover.pins.length - 1}` : ""}
        </span>
      )}
      {shownCard && (
        <PinCard
          pins={shownCard.pins}
          {...at(shownCard.pins[0])}
          w={size.w}
          ink={nowOf(shownCard.key).p.ink}
          who={`${nowOf(shownCard.key).p.j.character.name}'s ${shownCard.pins[0].k === "note" ? "note" : "screenshot"}`}
          onClose={() => setOpen(undefined)}
          onJump={(t) => onJump(shownCard.key, t)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- cards

function SideCard({ n, mode }: { n: Now; mode: Mode }) {
  const c = n.p.j.character;
  const lv = levelAtPlayed(n.p.curve, n.played);
  const known = !n.over && levelKnownAt(n.p.curve, n.played);
  const whole = Math.floor(lv + 1e-9);
  const frac = known ? lv - whole : 0;
  const deaths = n.before ? 0 : n.p.j.events.filter((e) => e.k === "die" && e.t <= n.t).length;
  const recent: { e: JEvent; text: string; tone: string }[] = [];
  if (!n.before) {
    for (let i = n.p.feed.length - 1; i >= 0 && recent.length < 3; i--) {
      const e = n.p.feed[i];
      if (e.t > n.t) continue;
      const d = describe(n.p.j, e);
      if (d) recent.push({ e, ...d });
    }
  }
  return (
    <div class="card duo-card" style={{ boxShadow: `inset 3px 0 0 ${n.p.ink}` }}>
      <div class="row" style={{ gap: "10px", flexWrap: "nowrap" }}>
        <div class="avatar sm" style={{ background: classColor(c.className) }} aria-hidden="true">
          {c.name.charAt(0)}
        </div>
        <div class="stack" style={{ gap: 0, minWidth: 0 }}>
          <strong class="duo-name" style={{ color: n.p.ink }}>
            {c.name}
          </strong>
          <span class="tiny muted">{describeCharacter(c)}</span>
        </div>
      </div>
      <span class="duo-doing">{doing(n)}</span>
      <div class="stack" style={{ gap: "6px" }}>
        <div class="row between small">
          <span class="muted">Level</span>
          <span class="num">
            {whole}
            {known && <span class="muted"> · {Math.round(frac * 100)}%</span>}
          </span>
        </div>
        <div class="lvlbar" aria-hidden="true">
          <i style={{ width: `${frac * 100}%`, background: n.p.ink }} />
        </div>
      </div>
      <dl class="duo-facts small">
        <dt class="muted">Played</dt>
        <dd class="num">{duration(n.played)}</dd>
        <dt class="muted">Deaths</dt>
        <dd class="num">{deaths}</dd>
      </dl>
      <div class="duo-feed">
        {recent.length ? (
          recent.map((r) => (
            <div key={`${r.e.t}${r.e.k}${r.text}`}>
              <span class="muted num">{duration(playedAt(n.p.clock, r.e.t))}</span>
              <span class={`tone-${r.tone}`}>{r.text}</span>
            </div>
          ))
        ) : (
          <div>
            <span />
            <span class="muted">{mode === "time" ? "Nothing yet" : "Just started"}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- chart

function Race({ a, b, mode, u, maxP, maxL, onSeek }: { a: Prep; b: Prep; mode: Mode; u: number; maxP: number; maxL: number; onSeek: (u: number) => void }) {
  const ref = useRef<SVGSVGElement>(null);
  const [w, setW] = useState(800);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(240, el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const h = 132, padL = 40, padR = 12, padT = 12, padB = 34;
  const X = (f: number) => padL + f * (w - padL - padR);

  const drawn = useMemo(() => {
    const topL = Math.max(a.curve.level.at(-1)!, b.curve.level.at(-1)!, 2);
    const maxH = mode === "time" ? 1 : Math.max(1, ...[a, b].map((p) => playedAtLevel(p.curve, maxL) ?? 0)) / 3600;
    const Y = mode === "time" ? (l: number) => h - padB - ((l - 1) / (topL - 1)) * (h - padT - padB) : (hrs: number) => h - padB - (hrs / maxH) * (h - padT - padB);
    // Where a moment sits along the axis, or undefined when off it.
    const xOf = (p: Prep, t: number) => {
      const played = playedAt(p.clock, t);
      if (mode === "time") return played / maxP;
      const l = levelAtPlayed(p.curve, played);
      return l <= maxL && levelKnownAt(p.curve, played) ? (l - 1) / (maxL - 1) : undefined;
    };
    const yOf = (p: Prep, t: number) => {
      const played = playedAt(p.clock, t);
      return mode === "time" ? Y(levelAtPlayed(p.curve, played)) : Y(played / 3600);
    };
    const lines = [a, b].map((p) => {
      const pts: [number, number][] = [];
      if (mode === "time") {
        p.curve.played.forEach((pl, i) => pts.push([X(pl / maxP), Y(p.curve.level[i])]));
        if (p.clock.total > p.curve.played.at(-1)!) pts.push([X(p.clock.total / maxP), Y(p.curve.level.at(-1)!)]);
      } else {
        p.curve.level.forEach((l, i) => l <= maxL && pts.push([X((l - 1) / (maxL - 1)), Y(p.curve.played[i] / 3600)]));
      }
      return { p, d: pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join("") };
    });
    const bars = [a, b].flatMap((p, k) =>
      p.visits.map((v) => {
        const x0 = xOf(p, v.from), x1 = xOf(p, Math.max(v.to, v.from));
        return x0 === undefined ? undefined : { k, x: X(x0), w: Math.max(3, X(Math.min(1, x1 ?? 1)) - X(x0)), key: `${p.key}${v.from}` };
      }),
    );
    const deaths = [a, b].flatMap((p) =>
      p.j.events
        .filter((e) => e.k === "die")
        .map((e) => {
          const x = xOf(p, e.t);
          return x === undefined || x > 1 ? undefined : { x: X(x), y: yOf(p, e.t), key: `${p.key}${e.t}` };
        }),
    );
    const xTicks: { x: number; label: string }[] = [];
    const yTicks: { y: number; label: string }[] = [];
    if (mode === "time") {
      const hrs = maxP / 3600;
      const step = hrs <= 3 ? 0.5 : hrs <= 10 ? 1 : hrs <= 40 ? 5 : hrs <= 120 ? 20 : 50;
      for (let t = 0; t <= hrs + 1e-9; t += step) xTicks.push({ x: X((t * 3600) / maxP), label: `${t}h` });
      const ls = topL <= 10 ? 2 : topL <= 30 ? 5 : 10;
      for (let l = 1; l <= topL; l = l === 1 ? ls : l + ls) yTicks.push({ y: Y(l), label: `${l}` });
    } else {
      const ls = maxL <= 10 ? 1 : maxL <= 30 ? 5 : 10;
      for (let l = 1; l <= maxL; l = l === 1 && ls > 1 ? ls : l + ls) xTicks.push({ x: X((l - 1) / (maxL - 1)), label: `L${l}` });
      const hs = maxH <= 1.5 ? 0.5 : maxH <= 6 ? 1 : maxH <= 15 ? 2 : maxH <= 40 ? 5 : maxH <= 120 ? 20 : 50;
      for (let t = 0; t <= maxH; t += hs) yTicks.push({ y: Y(t), label: `${t}h` });
    }
    return { lines, bars: bars.filter((x) => !!x), deaths: deaths.filter((x) => !!x), xTicks, yTicks };
  }, [a, b, mode, w, maxP, maxL]);

  const seek = (e: PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * w;
    onSeek(Math.min(1, Math.max(0, (x - padL) / (w - padL - padR))));
  };
  const dragging = useRef(false);
  const cx = X(u);
  const valueText = mode === "time" ? `${duration(u * maxP)} played` : `Level ${(1 + u * (maxL - 1)).toFixed(1)}`;
  return (
    <svg
      ref={ref}
      class="chart duo-chart"
      viewBox={`0 0 ${w} ${h}`}
      height={h}
      role="slider"
      tabIndex={0}
      aria-label="Replay position"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(u * 100)}
      aria-valuetext={valueText}
      onPointerDown={(e) => {
        dragging.current = true;
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
        seek(e);
      }}
      onPointerMove={(e) => dragging.current && seek(e)}
      onPointerUp={() => (dragging.current = false)}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 0.1 : 0.01;
        if (e.key === "ArrowRight" || e.key === "ArrowUp") onSeek(Math.min(1, u + step));
        else if (e.key === "ArrowLeft" || e.key === "ArrowDown") onSeek(Math.max(0, u - step));
        else if (e.key === "Home") onSeek(0);
        else if (e.key === "End") onSeek(1);
        else return;
        e.preventDefault();
      }}
    >
      {drawn.yTicks.map((t) => (
        <g key={`y${t.label}`}>
          <line class="grid" x1={padL} x2={w - padR} y1={t.y} y2={t.y} />
          <text x={padL - 8} y={t.y + 4} text-anchor="end">
            {t.label}
          </text>
        </g>
      ))}
      {drawn.xTicks.map((t) => (
        <text key={`x${t.label}`} x={t.x} y={h - 4} text-anchor="middle">
          {t.label}
        </text>
      ))}
      {drawn.bars.map((bar) => (
        <rect key={bar!.key} x={bar!.x} y={h - padB + 4 + bar!.k * 6} width={bar!.w} height={4} rx={2} fill="#7A5FAE" />
      ))}
      {drawn.lines.map((l) => (
        <path key={l.p.key} d={l.d} fill="none" stroke={l.p.ink} stroke-width={2.4} stroke-linejoin="round" />
      ))}
      {drawn.deaths.map((d) => (
        <circle key={d!.key} cx={d!.x} cy={d!.y} r={3.5} fill="#F29C93" stroke="#120D0D" />
      ))}
      <line x1={cx} x2={cx} y1={padT - 6} y2={h - padB} stroke="var(--text)" stroke-width={1.5} />
      <circle cx={cx} cy={padT - 4} r={5} fill="var(--text)" />
    </svg>
  );
}

// ---------------------------------------------------------------- the tab

const NO_SHOTS: Screenshot[] = [];

export function ReplayDuo({ ja, jb, shotsA = NO_SHOTS, shotsB = NO_SHOTS }: { ja: Journey; jb: Journey; shotsA?: Screenshot[]; shotsB?: Screenshot[] }) {
  const a = useMemo(() => prep(ja, "a", shotsA), [ja, shotsA]);
  const b = useMemo(() => prep(jb, "b", shotsB), [jb, shotsB]);
  const maxP = Math.max(1, a.clock.total, b.clock.total);
  const maxL = Math.min(a.curve.level.at(-1)!, b.curve.level.at(-1)!);
  const canLevel = maxL >= 2;
  const [mode, setMode] = useState<Mode>("time");
  const [cam, setCam] = useState<Cam>("both");
  const [u, setU] = useState(0.5);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);

  const level = 1 + u * (maxL - 1);
  const na = at(a, mode === "time" ? u * maxP : playedAtLevel(a.curve, level));
  const nb = at(b, mode === "time" ? u * maxP : playedAtLevel(b.curve, level));

  // Play: the clock runs at the chosen played time per second.
  useEffect(() => {
    if (!playing) return;
    const span = mode === "time" ? maxP : Math.max(1, ((playedAtLevel(a.curve, maxL) ?? 0) + (playedAtLevel(b.curve, maxL) ?? 0)) / 2);
    let last = performance.now();
    let id = 0;
    const tick = (t: number) => {
      const dt = Math.min(0.1, (t - last) / 1000);
      last = t;
      setU((v) => {
        const next = Math.min(1, v + (dt * SPEEDS[speed].per) / span);
        if (next >= 1) setPlaying(false);
        return next;
      });
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [playing, speed, mode, maxP, maxL, a, b]);

  const switchMode = (m: Mode) => {
    if (m === mode) return;
    // Keep roughly the same moment: where the first character is.
    if (m === "level") u2(Math.min(1, Math.max(0, (Math.min(levelAtPlayed(a.curve, na.played), maxL) - 1) / (maxL - 1))));
    else u2(Math.min(1, na.played / maxP));
    setMode(m);
  };
  const u2 = (v: number) => setU(Number.isFinite(v) ? v : 0);
  // "Jump here" on a card: the moment that character took it, a second on
  // so the diamond is there.
  const jump = (key: "a" | "b", t: number) => {
    const p = key === "a" ? a : b;
    const played = playedAt(p.clock, t) + 1;
    const v = mode === "time" ? played / maxP : (levelAtPlayed(p.curve, played) - 1) / (maxL - 1);
    u2(Math.min(1, Math.max(0, v)));
  };
  const pane = { onOpen: () => setPlaying(false), onJump: jump };

  if (!a.tracks.length && !b.tracks.length) {
    return (
      <section class="card flat">
        <h2>No paths to replay yet</h2>
        <p class="muted">The replay draws the paths Road to Sixty records. Once either character has a session played with it installed, it shows here.</p>
      </section>
    );
  }

  // One map while they share a continent; two side by side when they don't.
  const ca = na.here?.c, cb = nb.here?.c;
  const split = ca !== undefined && cb !== undefined && ca !== cb;
  const one = ca ?? cb ?? continentsOf(ja)[0] ?? continentsOf(jb)[0] ?? 0;
  const all = [na, nb];

  let headline: string, lead: preact.ComponentChildren;
  if (mode === "time") {
    headline = `${duration(u * maxP)} played`;
    const g = levelAtPlayed(a.curve, na.played) - levelAtPlayed(b.curve, nb.played);
    const ahead = g > 0 ? na : nb;
    const ended = na.over ? na : nb.over ? nb : undefined;
    lead = na.before && nb.before ? "Neither has started yet" : ended ? (
      <>
        <b style={{ color: ended.p.ink }}>{ended.p.j.character.name}</b>'s record ends at {duration(ended.p.clock.total)} played
      </>
    ) : Math.abs(g) < 0.1 ? "Neck and neck" : (
      <>
        <b style={{ color: ahead.p.ink }}>{ahead.p.j.character.name}</b> is {Math.abs(g) >= 1.95 ? `${Math.round(Math.abs(g))} levels` : `${Math.abs(g).toFixed(1)} levels`} ahead
      </>
    );
  } else {
    const whole = Math.floor(level + 1e-9);
    const pct = Math.round((level - whole) * 100);
    headline = `Level ${whole}${pct ? ` · ${pct}%` : ""}`;
    const g = na.played - nb.played;
    const faster = g < 0 ? na : nb;
    lead = Math.abs(g) < 60 ? "Got here at the same time" : (
      <>
        <b style={{ color: faster.p.ink }}>{faster.p.j.character.name}</b> got here {duration(Math.abs(g))} faster
      </>
    );
  }

  return (
    <div class="stack-lg">
      <section class="row between" style={{ gap: "12px 16px" }}>
        <div class="row" style={{ gap: "10px" }}>
          <span class="eyebrow">Line up by</span>
          <div class="seg" role="group" aria-label="Line up by">
            <button type="button" aria-pressed={mode === "time"} onClick={() => switchMode("time")}>
              Time played
            </button>
            <button type="button" aria-pressed={mode === "level"} onClick={() => switchMode("level")} disabled={!canLevel}>
              Level
            </button>
          </div>
        </div>
        <div class="seg" role="group" aria-label="Camera">
          <button type="button" aria-pressed={cam === "both"} onClick={() => setCam("both")}>
            {split ? "Follow each" : "Keep both in view"}
          </button>
          <button type="button" aria-pressed={cam === "all"} onClick={() => setCam("all")}>
            Whole map
          </button>
        </div>
      </section>
      <p class="small muted" style={{ marginTop: "-8px" }}>
          {mode === "time" ? "Both clocks start at 0 and count only time logged in." : "Each character moves through a level at their own pace, so both are always on the same level."}
      </p>

      <div class="duo-replay">
        <section class="stack" style={{ gap: "12px", minWidth: 0 }}>
          <div class="duo-stage">
            <div class={split ? "duo-maps split" : "duo-maps"}>
              {split ? (
                <>
                  <MapPane c={ca!} panes={[na]} all={all} cam={cam} playing={playing} label={`${continentName(ca!)} · ${ja.character.name}`} {...pane} />
                  <MapPane c={cb!} panes={[nb]} all={all} cam={cam} playing={playing} label={`${continentName(cb!)} · ${jb.character.name}`} {...pane} />
                </>
              ) : (
                <MapPane c={one} panes={all} all={all} cam={cam} playing={playing} {...pane} />
              )}
            </div>
            <div class="duo-hud" aria-live="off">
              <span class="tiny muted">{mode === "time" ? "After" : "Both at"}</span>
              <span class="duo-headline num">{headline}</span>
              <span class="small">{lead}</span>
            </div>
          </div>

          <div class="card" style={{ padding: "14px 16px", gap: "8px" }}>
            <div class="row between" style={{ gap: "10px 16px" }}>
              <div class="row" style={{ gap: "12px" }}>
                <button
                  type="button"
                  class="play"
                  aria-label={playing ? "Pause" : "Play"}
                  onClick={() => {
                    if (!playing && u >= 1) setU(0);
                    setPlaying(!playing);
                  }}
                >
                  {playing ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <rect x="6" y="5" width="4" height="14" />
                      <rect x="14" y="5" width="4" height="14" />
                    </svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d="M7 4l13 8-13 8z" />
                    </svg>
                  )}
                </button>
                <div class="seg" role="group" aria-label="Played time per second">
                  {SPEEDS.map((s, i) => (
                    <button type="button" aria-pressed={speed === i} onClick={() => setSpeed(i)} key={s.label}>
                      {s.label}/s
                    </button>
                  ))}
                </div>
              </div>
              <span class="tiny muted">
                <span class="key" style={{ background: INK.a }} /> {ja.character.name}
                <span class="key" style={{ background: INK.b, marginLeft: "12px" }} /> {jb.character.name}
                <span class="key" style={{ background: "#F29C93", marginLeft: "12px", borderRadius: "50%" }} /> Death
                <span class="key" style={{ background: "#7A5FAE", marginLeft: "12px" }} /> Dungeon
                <span class="key" style={{ background: "#7A3FB0", marginLeft: "12px", transform: "rotate(45deg) scale(0.8)" }} /> Screenshot or note
              </span>
            </div>
            <Race a={a} b={b} mode={mode} u={u} maxP={maxP} maxL={Math.max(2, maxL)} onSeek={(v) => setU(v)} />
            <span class="tiny muted">
              {mode === "time" ? "Level against hours played: the gap between the lines is the lead." : "Hours played to reach each level: the gap between the lines is how much faster one got there."} Drag along the
              chart to move through the replay.
            </span>
          </div>
        </section>
        <aside class="stack" style={{ gap: "12px", minWidth: 0 }}>
          <SideCard n={na} mode={mode} />
          <SideCard n={nb} mode={mode} />
        </aside>
      </div>
    </div>
  );
}
