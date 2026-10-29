import { useEffect, useState } from "preact/hooks";
import { JF_KNOWN_VERSION } from "../../lib/parse/jf";
import { JT_KNOWN_VERSION } from "../../lib/parse/jt";
import { RTS_KNOWN_VERSION } from "../../lib/parse/rts";
import { api, type StoredCharacter } from "../api";
import { sourcesLine } from "./Upload";

const PARTS = [
  {
    key: "Road to Sixty",
    title: "The path and the timeline",
    body: "Your walked path, plus every level, quest, kill, death, dungeon, loot drop and gear change with its time and place. Powers the map replay.",
    color: "var(--teal)",
    file: "RoadToSixty.lua",
    reads: `layout ${RTS_KNOWN_VERSION} (v1.15)`,
  },
  {
    key: "Journey Tracker",
    title: "The stats",
    body: "Gold earned and spent by category, time by activity, XP by source, kills and loot by type, professions and habits.",
    color: "var(--gold)",
    file: "JourneyTracker.lua",
    reads: `schema ${JT_KNOWN_VERSION} (v0.6)`,
  },
  {
    key: "Journey Forever (ours)",
    title: "Screenshots and notes",
    body: "A small addon: screenshots on dungeon clears, purple loot and level ups, and your /jf notes.",
    color: "var(--lilac)",
    file: "JourneyForever.lua",
    reads: `schema ${JF_KNOWN_VERSION}`,
  },
];

const EVENTS: [string, string, string, string][] = [
  ["Position trail", "Road to Sixty", "path points every 3 to 20 yards, with travel mode and why it jumped", "Outdoors only; dungeons show as in and out"],
  ["Level up", "Road to Sixty + Journey Tracker", "time, place, played time, gold on hand", "Both agree; Road to Sixty gives the place"],
  ["Quests", "Road to Sixty", "accepted and turned in, XP, money, title, place", ""],
  ["Gold in / out", "Journey Tracker", "earned and spent by category: loot, vendor, training, repairs, flights, auction house, mail", "Totals, not a per-coin timeline"],
  ["Loot", "Road to Sixty + Journey Tracker", "green and better one by one (Road to Sixty), counts of everything by quality (Journey Tracker)", ""],
  ["Deaths", "Road to Sixty + Journey Tracker", "place, level, likely killer, in a group or dungeon", "Matched by time"],
  ["Mob kills", "Road to Sixty", "every kill with time, XP and mob name", "Only kills that give XP"],
  ["Dungeon runs", "Road to Sixty", "in and out, time, kills, XP, deaths, gold, items, group size", ""],
  ["Screenshots", "Journey Forever", "dungeon cleared, purple loot, level up (plus optional triggers)", "Images uploaded with the folder"],
  ["Notes", "Journey Forever", "your /jf note text, time and place", ""],
  ["Close calls", "Not available", "health is hidden from addons on Forever", "Dropped"],
];

export function DataPage({ signedIn }: { signedIn: boolean }) {
  const [chars, setChars] = useState<StoredCharacter[]>();
  useEffect(() => {
    if (signedIn) api.characters().then((r) => setChars(r.characters)).catch(() => undefined);
  }, [signedIn]);
  return (
    <main class="page">
      <div class="stack">
        <h1>Where the data comes from</h1>
        <p class="lead">
          Three addons, each writing one saved file per character when you log out. The site reads all three as they are and merges them
          into one journey.
        </p>
      </div>

      <section class="split">
        {PARTS.map((p) => (
          <div class="card" key={p.key} style={{ borderTop: `3px solid ${p.color}` }}>
            <span class="tiny" style={{ color: p.color, fontWeight: 600 }}>
              {p.key}
            </span>
            <h2>{p.title}</h2>
            <p class="muted small">{p.body}</p>
            <span class="tiny muted">
              <code>{p.file}</code> · this site reads {p.reads}
            </span>
          </div>
        ))}
      </section>

      {chars && chars.length > 0 && (
        <section class="stack-lg">
          <h2>Your characters' files</h2>
          <div class="list">
            {chars.map((c) => {
              const line = sourcesLine(c.summary.sources);
              return (
                <div class="item" key={c.key}>
                  <span style={{ fontWeight: 600, flex: "0 0 160px" }}>{c.summary.name}</span>
                  <span class="small" style={{ flex: "1 1 300px", color: line.ok ? "var(--teal-hi)" : "var(--amber)" }}>
                    {line.text}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section class="stack-lg">
        <h2>Events and where they come from</h2>
        <div class="table-wrap">
          <table class="data">
            <thead>
              <tr>
                <th scope="col">Event</th>
                <th scope="col">Comes from</th>
                <th scope="col">What we get</th>
                <th scope="col">Notes</th>
              </tr>
            </thead>
            <tbody>
              {EVENTS.map(([name, from, what, note]) => (
                <tr key={name}>
                  <td style={{ fontWeight: 600 }}>{name}</td>
                  <td>{from}</td>
                  <td class="muted">{what}</td>
                  <td class="muted">{note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section class="split">
        <div class="card">
          <h2>How the map trail is recorded</h2>
          <ul class="muted small stack" style={{ margin: 0, paddingLeft: "20px" }}>
            <li>Road to Sixty checks your position 4 times a second and keeps a point every 3 to 20 yards, more often where you turn.</li>
            <li>The path is split into stretches on foot or mounted, by flight path, and as a ghost. Each jump is labelled: hearthstone, teleport, death, boat.</li>
            <li>Positions are in world yards. The replay draws them over each zone's outline from the game's own map bounds, with the zones you've been to lit up.</li>
            <li>Inside dungeons the game gives no position, so the trail shows going in and coming out.</li>
          </ul>
        </div>
        <div class="card">
          <h2>What we keep, and what we don't</h2>
          <ul class="muted small stack" style={{ margin: 0, paddingLeft: "20px" }}>
            <li>Your saved files are read in your browser. Only the finished journey and your screenshots are sent to the site.</li>
            <li>Other players are never stored: group members become a count, and names in trades and enchants are dropped.</li>
            <li>No chat, no combat log. Close calls aren't possible: health is hidden from addons on Forever.</li>
            <li>Each character is private until you switch on its public link.</li>
          </ul>
        </div>
      </section>
    </main>
  );
}
