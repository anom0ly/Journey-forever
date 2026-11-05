// The status page's HTML (served by server.ts), in the site's Crimson look.

import type { Status } from "./app";

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function when(t: number): string {
  const d = new Date(t * 1000);
  const today = new Date();
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (d.toDateString() === today.toDateString()) return `Today ${time}`;
  const y = new Date(today.getTime() - 86400_000);
  if (d.toDateString() === y.toDateString()) return `Yesterday ${time}`;
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${time}`;
}

const STYLE = `
:root { --bg:#120D0D; --surface:#1C1515; --raised:#251B1B; --border:#3A2B2B; --text:#F0E6E2; --muted:#B39F9B; --accent:#E5675C; --on-accent:#1C0806; --live:#7FE0A8; --warn:#F2C46D; color-scheme: dark; }
* { box-sizing: border-box; }
[hidden] { display: none !important; }
body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.5 "Segoe UI", system-ui, sans-serif; }
main { max-width: 900px; margin: 0 auto; padding: 32px 16px 56px; display: grid; gap: 20px; }
h1 { margin: 0; font: 600 24px Georgia, serif; letter-spacing: .02em; }
h2 { margin: 0; font-size: 16px; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; align-items: start; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 18px; display: grid; gap: 14px; min-width: 0; }
.status { display: flex; gap: 10px; align-items: center; }
.dot { width: 10px; height: 10px; border-radius: 50%; background: var(--live); box-shadow: 0 0 0 4px rgba(95,207,154,.14); flex: none; }
.dot.off { background: var(--muted); box-shadow: none; }
.dot.warn { background: var(--warn); box-shadow: 0 0 0 4px rgba(242,196,109,.14); }
dl { display: grid; grid-template-columns: max-content 1fr; gap: 6px 18px; margin: 0; font-size: 14px; }
dt { color: var(--muted); } dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
.mono { font-family: Consolas, ui-monospace, monospace; font-size: 13px; }
.row { display: flex; gap: 10px; flex-wrap: wrap; }
button, a.btn { font: 600 14px "Segoe UI", system-ui, sans-serif; border-radius: 8px; padding: 9px 16px; border: 1px solid var(--border); background: var(--raised); color: var(--text); cursor: pointer; text-decoration: none; }
button.primary, a.btn.primary { background: var(--accent); color: var(--on-accent); border-color: var(--accent); }
button.ghost { background: transparent; }
button:disabled { opacity: .5; cursor: default; }
button:focus-visible, a.btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.log { display: grid; font-size: 13.5px; }
.log div { display: grid; grid-template-columns: 110px 1fr; gap: 12px; padding: 7px 0; border-top: 1px solid var(--border); }
.muted { color: var(--muted); } .bad { color: var(--warn); }
.note { font-size: 13px; color: var(--muted); margin: 0; }
.foot { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; font-size: 13px; color: var(--muted); border-top: 1px solid var(--border); padding-top: 14px; }
.foot label { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; }
.foot input { accent-color: var(--accent); width: 16px; height: 16px; }
.link { background: none; border: 0; padding: 0; color: var(--accent); font: inherit; cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
.err { border: 1px solid #6b3a35; color: var(--warn); border-radius: 10px; padding: 12px 14px; font-size: 14px; }
`;

function shell(title: string, body: string, script = ""): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title><style>${STYLE}</style></head><body><main>${body}</main>${script}</body></html>`;
}

export function messagePage(title: string, message: string, ok: boolean): string {
  return shell(
    title,
    `<h1>${esc(title)}</h1><div class="card"><div class="status"><span class="dot ${ok ? "" : "warn"}"></span><span>${esc(message)}</span></div>
     <p class="note">You can close this tab. Double-click the uploader any time to see its page.</p></div>`,
  );
}

// JSON inside a <script>: "</script>" in a name or message must not end it.
export function scriptJson(v: unknown): string {
  return JSON.stringify(v).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

export function statusPage(s: Status, token: string): string {
  const headline = !s.connected
    ? "Not connected yet"
    : !s.forever
      ? "Can't find WoW Forever"
      : s.paused
        ? "Paused"
        : s.busy
          ? `${s.busy}…`
          : s.error
            ? "Something went wrong"
            : "Watching for WoW saves";
  const dot = !s.connected || !s.forever || s.error ? "warn" : s.paused ? "off" : "";
  const rows: [string, string][] = [];
  if (s.connected) rows.push(["Account", esc(s.account ?? "Connected")]);
  rows.push(["WoW folder", s.forever ? `<span class="mono">${esc(s.forever)}</span>` : `<span class="bad">Not found. Choose it below.</span>`]);
  if (s.characters.length) rows.push(["Characters", esc(s.characters.join(", "))]);
  rows.push(["Last upload", s.lastUploadAt ? esc(when(s.lastUploadAt)) : "Not yet"]);
  rows.push(["Addon", s.addonVersion ? `Journey Forever ${esc(s.addonVersion)}${s.addonNote ? ` · ${esc(s.addonNote)}` : ""}` : esc(s.addonNote ?? "Not installed yet")]);

  const main: string[] = [];
  if (!s.connected) main.push(`<button class="primary" data-action="connect">Connect this PC</button>`);
  if (!s.forever) main.push(`<button class="${s.connected ? "primary" : ""}" data-action="pick">Choose WoW folder</button>`);
  if (s.connected && s.forever) main.push(`<button class="primary" data-action="sync" ${s.busy || s.paused ? "disabled" : ""}>Upload now</button>`);
  main.push(`<a class="btn" href="${esc(s.site)}/characters" target="_blank" rel="noopener">Open my journey</a>`);

  const log = s.log.length
    ? s.log.slice(0, 12).map((l) => `<div><span class="muted">${esc(when(l.t))}</span><span class="${l.ok ? "" : "bad"}">${esc(l.text)}</span></div>`).join("")
    : `<div><span class="muted">—</span><span class="muted">Nothing yet</span></div>`;

  const body = `
<h1>Journey Forever uploader</h1>
${s.error ? `<div class="err">${esc(s.error)}</div>` : ""}
<div class="grid">
  <section class="card">
    <div class="status"><span class="dot ${dot}"></span><h2>${esc(headline)}</h2></div>
    <dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>
    <div class="row">${main.join("")}</div>
    ${!s.connected ? `<p class="note">Connect opens Journey Forever in your browser. Click Allow there and come back.</p>` : ""}
  </section>
  <section class="card">
    <h2>Recent</h2>
    <div class="log">${log}</div>
    <div class="row">
      ${s.forever ? `<button class="ghost" data-action="pick">Change WoW folder</button>` : ""}
      ${s.connected ? `<button class="ghost" data-action="${s.paused ? "resume" : "pause"}">${s.paused ? "Resume" : "Pause"}</button>` : ""}
      <button class="ghost" id="remove">Remove from this PC</button>
    </div>
    <div class="row" id="confirm" hidden>
      <span class="note">Stop uploading, take it out of Windows startup and disconnect this PC?</span>
      <button class="ghost" id="keep">Keep it</button>
      <button class="primary" data-action="remove">Remove</button>
    </div>
  </section>
</div>
<div class="foot">
  <label><input type="checkbox" id="startup" ${s.startup ? "checked" : ""}> Start with Windows</label>
  <span>Version ${esc(s.version)}${s.update ? ` · ${esc(s.update.note)}${s.update.auto ? "" : " (automatic updates are off)"} · <button class="link" data-action="check-update" ${s.update.canCheck ? "" : "disabled"}>Check for updates</button>` : ""}</span>
</div>
<p class="note">Settings for screenshots, notifications and updates are on your Account page on the site.</p>`;

  const script = `<script>
const token = ${scriptJson(token)};
let last = ${scriptJson(JSON.stringify(s))};
async function act(action) {
  document.querySelectorAll("button").forEach((b) => (b.disabled = true));
  const r = await fetch("/action", { method: "POST", headers: { "x-token": token, "content-type": "application/json" }, body: JSON.stringify({ action }) }).then((r) => r.json()).catch(() => ({}));
  if (r.removed) { document.querySelector("main").innerHTML = "<h1>Removed</h1><div class='card'>The uploader has stopped and won't start with Windows any more. You can close this tab.</div>"; return; }
  location.reload();
}
document.querySelectorAll("[data-action]").forEach((b) => b.addEventListener("click", () => act(b.dataset.action)));
document.getElementById("remove").addEventListener("click", () => { document.getElementById("confirm").hidden = false; });
document.getElementById("startup").addEventListener("change", (e) => act(e.target.checked ? "startup-on" : "startup-off"));
document.getElementById("keep").addEventListener("click", () => { document.getElementById("confirm").hidden = true; });
setInterval(async () => {
  const s = await fetch("/state", { headers: { "x-token": token } }).then((r) => r.text()).catch(() => null);
  if (s && s !== last && document.getElementById("confirm").hidden) location.reload();
}, 3000);
</script>`;
  return shell("Journey Forever uploader", body, script);
}
