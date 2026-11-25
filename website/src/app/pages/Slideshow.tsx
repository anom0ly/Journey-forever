import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Journey } from "../../lib/journey";
import { buildSlides, startIndex, type Slide } from "../../lib/slideshow";
import { reachedCap } from "../../lib/sixty";
import { classColor, date, describeCharacter } from "../format";
import { KIND_TAG } from "../kinds";
import { navigate } from "../router";
import { useJourney, type JourneySource } from "../source";

// A full-screen slideshow of a journey's screenshots and notes. Big screens get
// "falling prints": each picture drops onto a table as a photo print. Phones,
// and anyone who asked for less motion, get a slow pan and fade instead.

const SPEEDS = [
  { ms: 3000, label: "Fast" },
  { ms: 5000, label: "Normal" },
  { ms: 8000, label: "Slow" },
];
const CHAPTER_MS = 3000;
const PILE = 4; // prints left on the table, the newest on top
const MAX_BARS = 60; // past this many slides, one long bar instead of one per slide

function useMedia(q: string): boolean {
  const [on, setOn] = useState(() => typeof matchMedia === "function" && matchMedia(q).matches);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const m = matchMedia(q);
    const f = () => setOn(m.matches);
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, [q]);
  return on;
}

export function SlideshowPage({ source }: { source: JourneySource }) {
  const { data, error } = useJourney(source);
  const params = new URLSearchParams(location.search);
  const at60 = params.get("at60") === "1";
  const from = params.get("from");
  const back = data ? `${data.base}${at60 ? "/at60" : ""}` : "/";

  const slides = useMemo(() => {
    if (!data) return [];
    return buildSlides(data.journey, data.screenshots, { since: at60 ? reachedCap(data.journey) ?? Infinity : undefined });
  }, [data, at60]);

  if (error)
    return (
      <main class="page">
        <div class="notice">Couldn't load this journey: {error}</div>
      </main>
    );
  if (!data) return <div class="slideshow loading" aria-busy="true" />;
  if (!slides.length)
    return (
      <main class="page">
        <p class="muted">No screenshots to show yet.</p>
        <a class="btn" href={back}>
          Back to the journey
        </a>
      </main>
    );
  return <Player slides={slides} start={startIndex(slides, from)} j={data.journey} close={() => navigate(back)} replay={`${data.base}/replay`} />;
}

function Player({ slides, start, j, close, replay }: { slides: Slide[]; start: number; j: Journey; close: () => void; replay: string }) {
  const c = j.character;
  const [idx, setIdx] = useState(start);
  const [dir, setDir] = useState<1 | -1>(1);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const phone = useMedia("(max-width: 640px)");
  const calm = useMedia("(prefers-reduced-motion: reduce)");
  const prints = !phone && !calm;
  const root = useRef<HTMLDivElement>(null);
  const fill = useRef<HTMLElement>(null);
  const elapsed = useRef(0);
  const slide = slides[idx];
  const ms = slide.k === "chapter" ? CHAPTER_MS : SPEEDS[speed].ms;

  const go = (to: number) => {
    const n = Math.max(0, Math.min(slides.length - 1, to));
    if (n === idx) return;
    setDir(n > idx ? 1 : -1);
    elapsed.current = 0;
    setIdx(n);
  };
  const restart = () => {
    setDir(1);
    elapsed.current = 0;
    setIdx(0);
    setPlaying(true);
  };

  // The clock: fills the current bar, then moves on.
  useEffect(() => {
    if (slide.k === "end") return;
    let raf = 0, last = performance.now();
    const tick = (t: number) => {
      if (playing) elapsed.current += t - last;
      last = t;
      const f = Math.min(1, elapsed.current / ms);
      if (fill.current) fill.current.style.width = `${f * 100}%`;
      if (f >= 1) {
        setDir(1);
        elapsed.current = 0;
        setIdx((i) => Math.min(slides.length - 1, i + 1));
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [idx, playing, ms]);

  // Load the next two pictures early so the table is never empty.
  useEffect(() => {
    for (const s of slides.slice(idx + 1, idx + 3)) if (s.k === "shot") new Image().src = s.shot.url;
  }, [idx]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.fullscreenElement) close();
      else if (e.key === "ArrowRight") go(idx + 1);
      else if (e.key === "ArrowLeft") go(idx - 1);
      else if (e.key === " ") {
        e.preventDefault();
        setPlaying((p) => !p);
      } else return;
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [idx]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
  }, []);

  // Tap the left third to go back, anywhere else to go on; swipe down to close.
  const touch = useRef<{ x: number; y: number } | null>(null);
  const onClick = (e: MouseEvent) => {
    if ((e.target as Element).closest("button, a")) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    if (slide.k === "end") return;
    if (e.clientX - r.left < r.width / 3) go(idx - 1);
    else go(idx + 1);
  };
  const onTouchStart = (e: TouchEvent) => (touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY });
  const onTouchEnd = (e: TouchEvent) => {
    const s = touch.current;
    touch.current = null;
    if (!s) return;
    const dx = e.changedTouches[0].clientX - s.x, dy = e.changedTouches[0].clientY - s.y;
    if (dy > 90 && Math.abs(dx) < 60) close();
  };

  const fullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else root.current?.requestFullscreen?.().catch(() => {});
  };

  const bars = slides.length <= MAX_BARS;
  return (
    <div
      ref={root}
      class="slideshow"
      role="dialog"
      aria-label={`Slideshow of ${c.name}'s journey`}
      onClick={onClick}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {prints ? <Table slides={slides} idx={idx} dir={dir} /> : <Pan slides={slides} idx={idx} dir={dir} ms={ms} still={calm} />}
      {(slide.k === "shot" || slide.k === "note") && <Caption s={slide} key={idx} />}
      {slide.k === "chapter" && (
        <div class="ss-chapter" key={idx}>
          <div>
            <div class="ss-kicker">{slide.from === slide.to ? `Level ${slide.from}` : `Levels ${slide.from}–${slide.to}`}</div>
            <h2>{slide.zone}</h2>
            <div class="ss-rule" />
            <div class="ss-sub">{slide.shots === 1 ? "1 screenshot" : `${slide.shots} screenshots`}</div>
          </div>
        </div>
      )}
      {slide.k === "end" && (
        <div class="ss-chapter ss-end">
          <div>
            <div class="ss-kicker">The journey so far</div>
            <h2>{c.name}</h2>
            <div class="ss-sub">
              {[slide.shots && `${slide.shots} screenshot${slide.shots === 1 ? "" : "s"}`, slide.notes && `${slide.notes} note${slide.notes === 1 ? "" : "s"}`, slide.from === slide.to ? `Level ${slide.from}` : `Level ${slide.from} to ${slide.to}`]
                .filter(Boolean)
                .join(" · ")}
            </div>
            <div class="row" style={{ justifyContent: "center", marginTop: "20px" }}>
              <button type="button" class="btn" onClick={restart}>
                ↺ Play again
              </button>
              <a class="btn primary" href={replay}>
                ▶ Replay journey
              </a>
            </div>
          </div>
        </div>
      )}

      <div class="ss-top">
        <div class="ss-bars" aria-hidden="true">
          {bars ? (
            slides.map((_, i) => (
              <i key={i}>
                <b ref={i === idx ? fill : undefined} style={{ width: i < idx ? "100%" : "0%" }} />
              </i>
            ))
          ) : (
            <i>
              <b style={{ width: `${(idx / (slides.length - 1)) * 100}%` }} />
            </i>
          )}
        </div>
        <div class="ss-who">
          <span class="ss-av" style={{ background: classColor(c.className) }}>
            {c.name.charAt(0)}
          </span>
          <span>
            <b>{c.name}</b> <span class="ss-dim">· Level {c.level} {describeCharacter(c)}</span>
          </span>
          <span class="ss-acts">
            <button type="button" class="ss-ib" title="Full screen" aria-label="Full screen" onClick={fullscreen}>
              ⛶
            </button>
            <button type="button" class="ss-ib" title="Close (Esc)" aria-label="Close slideshow" onClick={close}>
              ✕
            </button>
          </span>
        </div>
      </div>
      <div class="ss-bot">
        <button type="button" class="ss-ib" aria-label="Back" title="Back (←)" onClick={() => go(idx - 1)}>
          ‹
        </button>
        <button type="button" class="ss-ib" aria-label={playing ? "Pause" : "Play"} title="Pause (space)" onClick={() => (slide.k === "end" ? restart() : setPlaying((p) => !p))}>
          {playing && slide.k !== "end" ? "❚❚" : "▶"}
        </button>
        <button type="button" class="ss-ib" aria-label="Next" title="Next (→)" onClick={() => go(idx + 1)}>
          ›
        </button>
        <span class="ss-count">
          {idx + 1} of {slides.length}
        </span>
        <span class="ss-speed">
          {SPEEDS.map((s, i) => (
            <button type="button" key={s.label} class={i === speed ? "on" : ""} onClick={() => setSpeed(i)}>
              {s.label}
            </button>
          ))}
        </span>
      </div>
    </div>
  );
}

// A small, steady tilt and nudge for each print, so going back puts it where it was.
function tilt(i: number) {
  return { r: ((i * 37) % 11) - 5, dx: ((i * 53) % 9) - 4 };
}

function Table({ slides, idx, dir }: { slides: Slide[]; idx: number; dir: 1 | -1 }) {
  // The pile is the last few pictures since the last chapter card.
  let lo = idx;
  while (lo > 0 && idx - lo < PILE - 1 && slides[lo - 1].k !== "chapter" && slides[lo - 1].k !== "end") lo--;
  const pile = [];
  for (let i = lo; i <= idx; i++) if (slides[i].k === "shot" || slides[i].k === "note") pile.push(i);
  return (
    <div class="ss-table">
      {pile.map((i) => {
        const s = slides[i];
        const { r, dx } = tilt(i);
        const top = i === idx;
        return (
          <div
            key={i}
            class={`ss-print${s.k === "note" ? " note" : ""}${top ? "" : " under"}${top && dir === 1 ? " fall" : ""}`}
            style={{ "--r": `${r}deg`, "--dx": `${dx}%` }}
          >
            {s.k === "shot" ? (
              <img src={s.shot.url} alt={s.shot.label ?? "Screenshot"} />
            ) : s.k === "note" ? (
              <div class="ss-notebody">“{s.text}”</div>
            ) : null}
            <div class="ss-hand">
              {s.k === "shot" ? s.shot.label ?? "Screenshot" : s.k === "note" ? s.zone ?? "" : ""}
              {(s.k === "shot" || s.k === "note") && ` · ${date(s.t)}`}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Pan({ slides, idx, dir, ms, still }: { slides: Slide[]; idx: number; dir: 1 | -1; ms: number; still: boolean }) {
  // Keep the one before underneath while the new one fades in.
  const show = [idx - 1, idx].filter((i) => i >= 0 && (i === idx || dir === 1));
  return (
    <div class="ss-pan">
      {show.map((i) => {
        const s = slides[i];
        if (s.k !== "shot" && s.k !== "note") return <div key={i} class="ss-layer blank" />;
        const o = ["20% 30%", "80% 40%", "50% 70%", "30% 60%"][i % 4];
        return (
          <div key={i} class={`ss-layer${s.k === "note" ? " note" : ""}${still ? " still" : ""}`} style={{ "--o": o, "--dur": `${ms + 1500}ms` }}>
            {s.k === "shot" ? <img src={s.shot.url} alt={s.shot.label ?? "Screenshot"} /> : <q>{s.text}</q>}
            <div class="ss-shade" />
          </div>
        );
      })}
    </div>
  );
}

function Caption({ s }: { s: Extract<Slide, { k: "shot" | "note" }> }) {
  const tag = s.k === "note" ? { tag: "Note", cls: "" } : KIND_TAG[s.shot.kind] ?? { tag: "Screenshot", cls: "" };
  return (
    <div class="ss-cap">
      <span class={`pill ${tag.cls}`}>{tag.tag}</span>
      {s.k === "shot" && <div class="ss-t">{s.shot.label ?? "Screenshot"}</div>}
      <div class="ss-m">{[s.zone, `Level ${s.level}`, date(s.t)].filter(Boolean).join(" · ")}</div>
    </div>
  );
}
