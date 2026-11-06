// The Windows auto-uploader on the site: the Account page card (download,
// connected PCs, switches) and the /connect page the uploader opens on its
// first run. Open to admins, and to everyone while the Beta switch is on.

import { useEffect, useState } from "preact/hooks";
import { BETA_MAX_PCS, connectPort, UPLOADER_SETTINGS_DEFAULT, UPLOADER_VERSION, type UploaderSettings } from "../../lib/uploader";
import { api, type UploaderPc } from "../api";
import { dateTime } from "../format";
import { useMe } from "../me";

const SWITCHES: { key: keyof UploaderSettings; label: string; hint?: string }[] = [
  { key: "shots", label: "Upload the addon's screenshots", hint: "Dungeon clears, epic loot, level-ups and the other moments the addon captures" },
  {
    key: "manualShots",
    label: "Also upload Print Screen shots",
    hint: "Screenshots you take yourself during a session. Off by default: they can catch chat or other windows, and they show on public journeys. From version 1.3.0.",
  },
  { key: "notify", label: "Show a notification after each upload" },
  { key: "addon", label: "Keep the Journey Forever addon installed and up to date", hint: "Installs it if it's missing and updates it when a new version is out. Only while WoW is closed." },
  { key: "update", label: "Keep the uploader up to date", hint: "Installs new versions of this program by itself and restarts it. From version 1.1.0." },
  {
    key: "reports",
    label: "Send error reports",
    hint: "When something goes wrong in the uploader, send a report (no names, files or screenshots) so it can be fixed. From version 1.2.0.",
  },
];

function pcState(pc: UploaderPc): { tag: string; cls: string; line: string } {
  const versions = [pc.appVersion && `Uploader ${pc.appVersion}`, pc.addonVersion && `addon ${pc.addonVersion}`].filter(Boolean).join(" · ");
  if (pc.ok === null) {
    return { tag: "Waiting", cls: "", line: [`Connected ${dateTime(pc.createdAt)}. Nothing uploaded yet`, versions].filter(Boolean).join(" · ") };
  }
  const when = pc.lastUploadAt ? `Last upload ${dateTime(pc.lastUploadAt)}` : "No upload yet";
  if (!pc.ok) {
    return { tag: "Needs attention", cls: "gold", line: [`Last try ${pc.lastSeenAt ? dateTime(pc.lastSeenAt) : ""}: ${pc.message ?? "it didn't work"}`, versions].filter(Boolean).join(" · ") };
  }
  return { tag: "Active", cls: "teal", line: [when, pc.message, versions].filter(Boolean).join(" · ") };
}

export function UploaderSection() {
  const me = useMe();
  const [pcs, setPcs] = useState<UploaderPc[]>();
  const [settings, setSettings] = useState<UploaderSettings>(UPLOADER_SETTINGS_DEFAULT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const allowed = !!me?.user?.uploader?.allowed;
  const admin = !!me?.user?.isAdmin;
  const beta = !!me?.user?.uploader?.beta;

  useEffect(() => {
    if (!allowed) return;
    api.uploader().then(
      (r) => {
        setPcs(r.pcs);
        setSettings(r.settings);
      },
      (e) => setError((e as Error).message),
    );
  }, [allowed]);

  if (!allowed) return null;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section class="card flat">
      <div class="row between">
        <div class="stack" style={{ gap: "4px", flex: "1 1 260px" }}>
          <h2>
            Auto-upload from your PC {beta ? <span class="pill beta">Beta</span> : <span class="pill gold">Admin</span>}
          </h2>
          <span class="small muted">Uploads your journey and new screenshots each time you log out of WoW. Windows 10 and 11.</span>
        </div>
        <a class="btn primary" href="/uploader">
          Get the uploader
        </a>
      </div>
      {pcs && pcs.length > 0 && (
        <div class="list">
          {pcs.map((pc) => {
            const s = pcState(pc);
            return (
              <div class="item" key={pc.id}>
                <div class="stack" style={{ flex: "1 1 260px", gap: "2px" }}>
                  <span>
                    <b>{pc.name}</b> <span class={`pill ${s.cls}`}>{s.tag}</span>
                  </span>
                  <span class="small muted">{s.line}</span>
                </div>
                <button
                  type="button"
                  class="btn"
                  disabled={busy}
                  onClick={() => run(async () => setPcs((await api.disconnectPc(pc.id)).pcs))}
                >
                  Disconnect
                </button>
              </div>
            );
          })}
        </div>
      )}
      {pcs && pcs.length === 0 && (
        <p class="small muted">
          No PCs connected yet. <a href="/uploader">Get the uploader</a>, run it, and click Allow when it opens this site.
        </p>
      )}
      <div class="stack" style={{ gap: "0" }}>
        {SWITCHES.map((sw) => (
          <label class="row between" key={sw.key} style={{ gap: "16px", padding: "12px 0", borderTop: "1px solid var(--line)", cursor: "pointer", flexWrap: "nowrap" }}>
            <span class="stack" style={{ gap: "2px", minWidth: 0 }}>
              <span class="small">{sw.label}</span>
              {sw.hint && <span class="tiny muted">{sw.hint}</span>}
            </span>
            <input
              type="checkbox"
              checked={settings[sw.key]}
              disabled={busy}
              onChange={(e) => {
                const on = (e.target as HTMLInputElement).checked;
                run(async () => setSettings(await api.setUploaderSettings({ [sw.key]: on })));
              }}
              style={{ width: "18px", height: "18px", flex: "none", accentColor: "var(--accent)" }}
            />
          </label>
        ))}
      </div>
      {error && <div class="notice err">{error}</div>}
      {beta && !admin && (
        <div class="notice warn small">
          Beta: up to {BETA_MAX_PCS} PCs per account. Something not right? Error reports are on by default, so problems reach us.
        </div>
      )}
      <p class="tiny muted">
        Version {UPLOADER_VERSION}. The uploader reads your saved files on your PC, like the Upload page, so the raw files never leave it.
        Disconnect stops a PC's uploads at once. To stop the uploader itself, open its window from the tray icon and choose Remove from this PC.
      </p>
    </section>
  );
}

// /connect?port=…&challenge=…&pc=…, opened by the uploader on its first run.
export function ConnectPage() {
  const me = useMe();
  const q = new URLSearchParams(location.search);
  const port = connectPort(q.get("port"));
  const challenge = q.get("challenge") ?? "";
  const pc = (q.get("pc") ?? "").replace(/[^\w .-]/g, "").slice(0, 40) || "this PC";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [cancelled, setCancelled] = useState(false);

  const allow = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const { code } = await api.connectPc(pc, challenge);
      // Back to the uploader on this PC, which swaps the code for its key.
      location.href = `http://127.0.0.1:${port}/connected?code=${encodeURIComponent(code)}`;
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  let body;
  if (!port || !/^[0-9a-f]{64}$/.test(challenge)) {
    body = <p class="lead">This connect link is broken. Close this tab and start the uploader again.</p>;
  } else if (!me) {
    body = null;
  } else if (!me.user) {
    body = (
      <>
        <p class="lead">Sign in first, then you can connect {pc}.</p>
        <div class="row">
          <a class="btn primary" href={`/auth/login?to=${encodeURIComponent(location.pathname + location.search)}`}>
            Sign in with Battle.net
          </a>
        </div>
      </>
    );
  } else if (!me.user.uploader?.allowed) {
    body = <p class="lead">Auto-upload isn't available for your account yet. Keep using the Upload page for now.</p>;
  } else if (cancelled) {
    body = <p class="lead">Not connected. You can close this tab.</p>;
  } else {
    body = (
      <>
        <p class="lead">
          The Journey Forever uploader on <b style={{ color: "var(--text)" }}>{pc}</b> wants to upload for{" "}
          <b style={{ color: "var(--text)" }}>{me.user.battletag ?? "your account"}</b>.
        </p>
        <ul class="small" style={{ margin: 0, paddingLeft: "20px", display: "grid", gap: "4px" }}>
          <li>It can upload journeys and screenshots for your characters.</li>
          <li>It can't delete anything, change privacy, or see your account settings.</li>
          <li>You can disconnect it any time from your Account page.</li>
        </ul>
        <p class="tiny muted">Only allow this if you just started the uploader on your own PC.</p>
        {error && <div class="notice err">{error}</div>}
        <div class="row">
          <button type="button" class="btn" disabled={busy} onClick={() => setCancelled(true)}>
            Cancel
          </button>
          <button type="button" class="btn primary" disabled={busy} onClick={allow}>
            {busy ? "Connecting…" : "Allow"}
          </button>
        </div>
      </>
    );
  }

  return (
    <main class="page narrow">
      <div class="stack">
        <h1>Connect {pc}?</h1>
        {body}
      </div>
    </main>
  );
}
