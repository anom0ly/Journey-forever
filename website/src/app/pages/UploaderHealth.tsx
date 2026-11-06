// The admin Uploader health page: every PC connected to the Windows
// uploader, what it last reported, and the problems it sent (the last 10 per
// PC). Only accounts in ADMIN_BNET_IDS can load it; the API answers
// "Not found" to anyone else.

import { useEffect, useState } from "preact/hooks";
import { BETA_MAX_PCS, UPLOADER_VERSION } from "../../lib/uploader";
import { api, type UploaderBuilds, type UploaderHealthPc, type UploaderProblem, type UploaderSwitches } from "../api";
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

// Self-update approvals: uploaders install a new build only after it's
// approved here, and only the exact file GitHub had at that moment.
function UploaderBuildsCard() {
  const [data, setData] = useState<UploaderBuilds>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<string>();

  useEffect(() => {
    api.uploaderBuilds().then(setData, (e: Error) => setError(e.message));
  }, []);

  const run = async (version: string, fn: () => Promise<UploaderBuilds>) => {
    setBusy(version);
    setError(undefined);
    try {
      setData(await fn());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(undefined);
    }
  };

  const builds = data?.builds.slice(0, 6) ?? [];
  return (
    <section class="card flat stack">
      <div class="stack" style={{ gap: "4px" }}>
        <h2>Self-update approvals</h2>
        <p class="small muted">
          Connected PCs update only to a build approved here, and only if GitHub's file still has the checksum it had when you approved it.
          Approve a build after you've tried it. Withdraw it to stop it reaching more PCs.{" "}
          {data && (data.latest ? <>PCs are offered <b>{data.latest}</b>.</> : <>No build is approved, so PCs don't update themselves.</>)}
        </p>
      </div>
      {(error || data?.error) && <div class="notice err">{error ?? data?.error}</div>}
      {!data && !error && <p class="muted small">Loading…</p>}
      {builds.length > 0 && (
        <div class="list">
          {builds.map((b) => (
            <div class="item" key={b.version}>
              <div class="stack" style={{ flex: "1 1 260px", gap: "2px" }}>
                <span>
                  <b>{b.version}</b>{" "}
                  {b.changed ? (
                    <span class="pill red">File changed since approval</span>
                  ) : b.approvedAt ? (
                    <span class="pill teal">Approved</span>
                  ) : (
                    <span class="pill">Not approved</span>
                  )}
                </span>
                <span class="tiny muted" style={{ wordBreak: "break-all" }}>
                  {b.publishedAt ? `Published ${dateTime(Date.parse(b.publishedAt) / 1000)}` : ""}
                  {b.approvedAt ? ` · approved ${dateTime(b.approvedAt)}` : ""}
                  {b.sha256 ? ` · SHA-256 ${b.sha256}` : b.approvedAt ? " · not found on GitHub now" : " · not from the release workflow, can't be approved"}
                </span>
              </div>
              <div class="row" style={{ gap: "8px" }}>
                {b.sha256 && (!b.approvedAt || b.changed) && (
                  <button type="button" class="btn primary" disabled={!!busy} onClick={() => run(b.version, () => api.approveUploader(b.version))}>
                    {busy === b.version ? "Approving…" : b.changed ? "Approve new file" : "Approve"}
                  </button>
                )}
                {b.approvedAt && (
                  <button type="button" class="btn" disabled={!!busy} onClick={() => run(b.version, () => api.withdrawUploader(b.version))}>
                    Withdraw
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// Who can use the uploader, and the brakes if a release goes wrong.
function UploaderSwitchesCard() {
  const [sw, setSw] = useState<UploaderSwitches>();
  const [approved, setApproved] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.uploaderSwitches().then(setSw, (e: Error) => setError(e.message));
    api.uploaderBuilds().then(
      (d) => setApproved(d.builds.filter((b) => b.approvedAt && !b.changed).map((b) => b.version)),
      () => undefined,
    );
  }, []);

  const set = async (s: Partial<UploaderSwitches>) => {
    setBusy(true);
    setError(undefined);
    try {
      setSw(await api.setUploaderSwitches(s));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const rows: { key: "beta" | "connect"; label: string; hint: string }[] = [
    {
      key: "beta",
      label: "Open the Beta to everyone",
      hint: `Every signed-in account can download and connect the uploader (up to ${BETA_MAX_PCS} PCs each). Off: admins only. Turning it off also stops other accounts' PCs uploading.`,
    },
    {
      key: "connect",
      label: "Let new PCs connect",
      hint: "Off: PCs already connected keep working, but nobody else can connect one. Admins still can.",
    },
  ];

  return (
    <section class="card flat stack">
      <div class="stack" style={{ gap: "4px" }}>
        <h2>Release switches</h2>
        <p class="small muted">These take effect at once, no deploy needed.</p>
      </div>
      {error && <div class="notice err">{error}</div>}
      {!sw && !error && <p class="muted small">Loading…</p>}
      {sw && (
        <div class="stack" style={{ gap: "0" }}>
          {rows.map((r) => (
            <label class="row between" key={r.key} style={{ gap: "16px", padding: "12px 0", borderTop: "1px solid var(--line)", cursor: "pointer", flexWrap: "nowrap" }}>
              <span class="stack" style={{ gap: "2px", minWidth: 0 }}>
                <span class="small">{r.label}</span>
                <span class="tiny muted">{r.hint}</span>
              </span>
              <input
                type="checkbox"
                id={`switch-${r.key}`}
                checked={sw[r.key]}
                disabled={busy}
                onChange={(e) => set({ [r.key]: (e.target as HTMLInputElement).checked })}
                style={{ width: "18px", height: "18px", flex: "none", accentColor: "var(--accent)" }}
              />
            </label>
          ))}
          <div class="row between" style={{ gap: "16px", padding: "12px 0", borderTop: "1px solid var(--line)", flexWrap: "wrap" }}>
            <span class="stack" style={{ gap: "2px", minWidth: 0, flex: "1 1 260px" }}>
              <label class="small" for="switch-min">
                Minimum version
              </label>
              <span class="tiny muted">
                Older uploaders can still update themselves but can't upload until they do. Pick an approved build; use it when an old version
                is sending bad data.
              </span>
            </span>
            <select
              id="switch-min"
              value={sw.minVersion ?? ""}
              disabled={busy}
              onChange={(e) => set({ minVersion: (e.target as HTMLSelectElement).value || null })}
            >
              <option value="">None</option>
              {[...new Set([...approved, ...(sw.minVersion ? [sw.minVersion] : [])])].map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
    </section>
  );
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
      <UploaderSwitchesCard />
      <UploaderBuildsCard />
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
