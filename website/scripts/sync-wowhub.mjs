// Brings public/wowhub/ up to date with the WoWHub brand kit on wowhub.net:
// downloads nav.js and brand.css, puts our safety changes back into nav.js,
// and writes them. The "WoWHub sync" workflow runs this every 6 hours and
// opens a pull request when anything changed, so every update is reviewed
// before it reaches the site.
//
//   node scripts/sync-wowhub.mjs
//
// If wowhub.net's nav.js changes shape so a change can't be put back, this
// stops with an error (the workflow then fails and GitHub emails you), and
// the change has to be made by hand.

import { writeFile } from "node:fs/promises";

const HUB = "https://wowhub.net/";
const OUT = new URL("../public/wowhub/", import.meta.url);

// Each change: the original text, and what replaces it.
const NAV_CHANGES = [
  [
    `/*
 * WoWHub brand kit: nav.js (v1)`,
    `/*
 * Journey Forever's own copy of the WoWHub nav (https://wowhub.net/nav.js, v1),
 * served from this site so a change on wowhub.net can't run code here. One
 * change from the original, marked "Journey Forever:": links and apps.json
 * always point at wowhub.net. To update, run scripts/sync-wowhub.mjs (the
 * "WoWHub sync" workflow does it every 6 hours).
 *
 * WoWHub brand kit: nav.js (v1)`,
  ],
  [
    `  var base = hubAttr ? new URL(hubAttr, location.href).href
    : (script && script.src ? new URL('/', script.src).href : '/');`,
    `  // Journey Forever: always the hub, wherever this copy is served from.
  var base = 'https://wowhub.net/';`,
  ],
];

// wowhub.net's own protections for what comes from apps.json. If a new
// nav.js drops any of these, stop so the change is looked at by hand.
const NAV_MUST_HAVE = [
  // icons rebuilt shape by shape from an allow-list, never inserted as HTML
  `var ICON_TAGS = { path: 1, circle: 1, ellipse: 1, line: 1, polyline: 1, polygon: 1, rect: 1 };`,
  `var shape = document.createElementNS(SVG_NS, n.localName);`,
  `item.firstChild.appendChild(svgIcon(a.icon, 20));`,
  // links only https:// or a path on the hub
  `if (/^https:\\/\\/[^\\s"'<>]+$/i.test(u)) return u;`,
  `var url = safeUrl(a.url);`,
  `if (isLive) item.href = url;`,
];

async function download(name) {
  const res = await fetch(HUB + name, { headers: { "user-agent": "journey-forever wowhub sync" } });
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  return res.text();
}

export function patchNav(src) {
  for (const line of NAV_MUST_HAVE) {
    if (!src.includes(line)) throw new Error(`nav.js changed shape: a safety check is missing:\n${line}`);
  }
  if (/svgIcon\([^)]*\)\s*\+/.test(src)) throw new Error("nav.js changed shape: an icon is inserted as HTML again");
  let out = src;
  for (const [from, to] of NAV_CHANGES) {
    const n = out.split(from).length - 1;
    if (n !== 1) throw new Error(`nav.js changed shape: expected this once, found it ${n} times:\n${from}`);
    out = out.replace(from, () => to);
  }
  return out;
}

const [nav, css] = await Promise.all([download("nav.js"), download("brand.css")]);
await writeFile(new URL("nav.js", OUT), patchNav(nav));
await writeFile(new URL("brand.css", OUT), css);
console.log("public/wowhub/ is up to date with wowhub.net");
