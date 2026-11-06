// The admin Uploader health page: every PC connected to the Windows
// uploader, what it last reported, and the problems it sent (the last 10 per
// PC). Only accounts in ADMIN_BNET_IDS can load it; the API answers
// "Not found" to anyone else.

import { useEffect, useState } from "preact/hooks";
import { UPLOADER_VERSION } from "../../lib/uploader";
import { api, type UploaderHealthPc, type UploaderProblem } from "../api";
import { dateTime, plural } from "../format";

const WEEK = 7 * 86400;
const AREAS: Record<string, string> = {
  crash: "crash",
  upload: "upload",
  read: "saved file",
  addon: "addon update",
  update: "self-update",
  "update-security": "self-update (security)",
  window: "window",
};

function state(pc: UploaderHealthPc, nowS: number): { tag: string; cls: string } {
  if (pc.ok === false) return { tag: "Failing", cls: "red" };
  if (pc.appVersion && pc.appVersion !== UPLOADER_VERSION) return { tag: "Old version", cls: "gold" };
  if (pc.weekErrors) return { tag: "Problems", cls: "gold" };
  if (pc.ok === null) return { tag: "Waiting", cls: "" };
  if (!pc.lastSeenAt || nowS - pc.lastSeenAt > WEEK) return { tag: "Quiet", cls: "" };
  return { tag: "OK", cls: "teal" };
}

export function UploaderHealthPage() {
  const [pcs, setPcs] = useState<UploaderHealthPc[]>();
  const [error, setError] = useState<string>();
  const [open, setOpen] = useState<string>();
  const [problems, setProblems] = useState<Record<string, UploaderProblem[] | string>>({});

  useEffect(() => {
    api
      .uploaderHealth()
      .then((d) => setPcs(d.pcs))
      .catch((e: Error) => setError(e.message));
  }, []);

  const toggle = (id: string) => {
    setOpen(open === id ? undefined : id);
    if (problems[id]) return;
    api
      .uploaderProblems(id)
      .then((d) => setProblems((p) => ({ ...p, [id]: d.errors })))
      .catch((e: Error) => setProblems((p) => ({ ...p, [id]: e.message })));
  };

  const nowS = Date.now() / 1000;
  const versions = new Map<string, number>();
  for (const pc of pcs ?? []) versions.set(pc.appVersion ?? "Not reported", (versions.get(pc.appVersion ?? "Not reported") ?? 0) + 1);
  const recent = pcs?.filter((pc) => pc.lastUploadAt && nowS - pc.lastUploadAt < WEEK).length ?? 0;
  const failing = pcs?.filter((pc) => pc.ok === false).length ?? 0;
  const old = pcs?.filter((pc) => pc.appVersion && pc.appVersion !== UPLOADER_VERSION).length ?? 0;

  return (
    <main class="page">
      <section class="lb-head">
        <div class="stack">
          <h1>Uploader health</h1>
          <p class="lead">
            Every PC connected to the Windows uploader, from what it reports after each upload and the problems it sends. Reports carry no names,
            files or screenshots. Select a row to see that PC's last 10 problems.
          </p>
        </div>
      </section>
      {error && <div class="notice err">{error}</div>}
      {!pcs && !error && <p class="muted">Loading…</p>}
      {pcs && (
        <div class="stack-lg">
          <div class="row" style={{ gap: "12px", flexWrap: "wrap" }}>
            {[
              [pcs.length, plural(pcs.length, "connected PC")],
              [recent, "uploaded in the last 7 days"],
              [failing, "failing now"],
              [old, `not on ${UPLOADER_VERSION}`],
            ].map(([n, label]) => (
              <div class="card flat" key={label} style={{ flex: "1 1 160px", padding: "14px 16px" }}>
                <div style={{ fontSize: "26px", fontWeight: 700 }}>{n}</div>
                <div class="tiny muted">{label}</div>
              </div>
            ))}
          </div>
          {versions.size > 0 && (
            <p class="small muted">
              Versions in use:{" "}
              {[...versions]
                .sort((a, b) => b[1] - a[1])
                .map(([v, n]) => `${v} (${n})`)
                .join(", ")}
            </p>
          )}
          {!pcs.length ? (
            <div class="card flat">
              <p class="muted">No PCs are connected yet.</p>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table class="data nowrap">
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>PC</th>
                    <th>App</th>
                    <th>Addon</th>
                    <th>Windows</th>
                    <th>Last upload</th>
                    <th>State</th>
                    <th>Last problem</th>
                  </tr>
                </thead>
                <tbody>
                  {pcs.map((pc) => {
                    const s = state(pc, nowS);
                    const list = problems[pc.id];
                    return [
                      <tr
                        key={pc.id}
                        tabIndex={0}
                        aria-expanded={open === pc.id}
                        style={{ cursor: "pointer" }}
                        onClick={() => toggle(pc.id)}
                        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), toggle(pc.id))}
                      >
                        <td>{pc.battletag}</td>
                        <td>{pc.name}</td>
                        <td>{pc.appVersion ?? "–"}</td>
                        <td>{pc.addonVersion ?? "–"}</td>
                        <td>{pc.osVersion ?? "–"}</td>
                        <td>{pc.lastUploadAt ? dateTime(pc.lastUploadAt) : "Never"}</td>
                        <td>
                          <span class={`pill ${s.cls}`}>{s.tag}</span>
                        </td>
                        <td style={{ whiteSpace: "normal", minWidth: "220px" }}>
                          {pc.lastError ? (
                            <>
                              {AREAS[pc.lastError.area] ?? pc.lastError.area} · {pc.lastError.message}
                              <span class="tiny muted">
                                {" "}
                                · {dateTime(pc.lastError.t)}
                                {pc.weekErrors > 1 ? ` · ${pc.weekErrors}× this week` : ""}
                              </span>
                            </>
                          ) : pc.ok === false && pc.message ? (
                            pc.message
                          ) : (
                            <span class="muted">None</span>
                          )}
                        </td>
                      </tr>,
                      open === pc.id && (
                        <tr key={`${pc.id}-problems`}>
                          <td colSpan={8} style={{ whiteSpace: "normal", background: "var(--panel, transparent)" }}>
                            {!list ? (
                              <span class="muted">Loading…</span>
                            ) : typeof list === "string" ? (
                              <span class="notice err">{list}</span>
                            ) : !list.length ? (
                              <span class="muted">This PC hasn't sent any problems.</span>
                            ) : (
                              <ul class="stack" style={{ gap: "6px", margin: 0, paddingLeft: "18px" }}>
                                {list.map((e, i) => (
                                  <li key={i} class="small">
                                    <span class="muted">{dateTime(e.t)}</span> · {AREAS[e.area] ?? e.area}
                                    {e.appVersion ? ` · ${e.appVersion}` : ""} · {e.message}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </td>
                        </tr>
                      ),
                    ];
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
