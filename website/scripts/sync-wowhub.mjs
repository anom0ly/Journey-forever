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
 * served from this site so a change on wowhub.net can't run code here. Three
 * changes from the original, marked "Journey Forever:": links and apps.json
 * always point at wowhub.net, app icons from apps.json are only drawn when
 * they're plain SVG shapes, and app links must be https. To update, run
 * scripts/sync-wowhub.mjs (the "WoWHub sync" workflow does it every 6 hours).
 *
 * WoWHub brand kit: nav.js (v1)`,
  ],
  [
    `  var base = script && script.src ? new URL('.', script.src).href : '/';`,
    `  // Journey Forever: always the hub, wherever this copy is served from.
  var base = 'https://wowhub.net/';`,
  ],
  [
    `  function svgIcon(inner, size) {
    return`,
    `  // Journey Forever: apps.json comes from another site, so an icon is only
  // used when it's nothing but SVG shapes with plain attributes.
  var SAFE_ICON = /^(\\s*(<(path|circle|rect|line|polyline|polygon|ellipse|g)(\\s+(d|cx|cy|r|rx|ry|x|y|x1|y1|x2|y2|width|height|points|transform|fill|stroke|stroke-width|stroke-linecap|stroke-linejoin|opacity)="[^"<>]*")*\\s*\\/?>|<\\/(g|path)>))*\\s*$/;
  function svgIcon(inner, size) {
    if (!SAFE_ICON.test(inner)) inner = '';
    return`,
  ],
  [
    `          if (isLive) item.href = a.url;`,
    `          // Journey Forever: only https links.
          if (isLive && /^https:\\/\\//.test(String(a.url))) item.href = a.url;`,
  ],
];

async function download(name) {
  const res = await fetch(HUB + name, { headers: { "user-agent": "journey-forever wowhub sync" } });
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  return res.text();
}

export function patchNav(src) {
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
