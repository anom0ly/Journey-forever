// Offering the Windows uploader: the /uploader download page, and the small
// offers on the Upload page and the home strip. Offers show only to accounts
// the uploader is open to (admins, or everyone while it's in Beta), on a
// Windows PC, and only until the account has a connected PC.

import { useEffect, useState } from "preact/hooks";
import { uploaderDownloadUrl } from "../../lib/uploader";
import { api, type Me, type UploaderDownload } from "../api";
import { useMe } from "../me";

export function onWindowsPc(): boolean {
  const ua = navigator.userAgent;
  return /Windows NT/.test(ua) && !/Mobile|Xbox/.test(ua);
}

// Should the site offer the uploader to this account on this device?
export function offerUploader(me: Me | null): boolean {
  const u = me?.user?.uploader;
  return !!u?.allowed && u.pcs === 0 && onWindowsPc();
}

function BetaPill() {
  return <span class="pill beta">Beta</span>;
}

// One line at the top of the Upload page.
export function UploaderPromo() {
  const me = useMe();
  if (!offerUploader(me)) return null;
  return (
    <div class="uploader-promo">
      <span>
        <b>On Windows?</b> <span class="muted">The Journey Forever app can upload for you each time you log out.</span>{" "}
        {me?.user?.uploader?.beta && <BetaPill />}
      </span>
      <a href="/uploader">Get the uploader →</a>
    </div>
  );
}

const NUDGE_KEY = "jf-uploader-nudge-hidden-until";
const NUDGE_DAYS = 30;

function nudgeHidden(): boolean {
  try {
    return Number(localStorage.getItem(NUDGE_KEY) ?? 0) > Date.now();
  } catch {
    return false;
  }
}

// After a manual upload worked: the moment the chore is fresh.
export function UploaderNudge() {
  const me = useMe();
  const [hidden, setHidden] = useState(nudgeHidden);
  if (hidden || !offerUploader(me)) return null;
  const notNow = () => {
    try {
      localStorage.setItem(NUDGE_KEY, String(Date.now() + NUDGE_DAYS * 86400_000));
    } catch {
      // private window: hidden for this visit only
    }
    setHidden(true);
  };
  return (
    <section class="card flat uploader-nudge">
      <div class="stack" style={{ gap: "6px", flex: "1 1 300px" }}>
        <h2>Skip this next time</h2>
        <p class="small muted">
          The uploader for Windows reads the same files from your PC when you log out and uploads them by itself, with new screenshots. It can
          keep the Journey Forever addon up to date too.
        </p>
      </div>
      <div class="row">
        <a class="btn primary" href="/uploader">
          Get the uploader
        </a>
        <button type="button" class="btn" onClick={notNow}>
          Not now
        </button>
      </div>
    </section>
  );
}

// A link in the home page's addon strip.
export function UploaderStripLink() {
  const me = useMe();
  if (!offerUploader(me)) return null;
  return (
    <>
      <span class="addons-strip-sep" aria-hidden="true">
        |
      </span>
      <span class="addons-strip-item tiny">
        <span class="muted">Windows:</span>
        <a href="/uploader">Auto-upload app</a>
        {me?.user?.uploader?.beta && <BetaPill />}
      </span>
    </>
  );
}

function megabytes(bytes: number | undefined): string | undefined {
  return bytes ? `${Math.round(bytes / 1_000_000)} MB` : undefined;
}

// /uploader: what it is, what it does on your PC, and the download.
export function UploaderPage() {
  const me = useMe();
  const [dl, setDl] = useState<UploaderDownload>();
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState(false);
  const [showSum, setShowSum] = useState(false);

  useEffect(() => {
    api.uploaderDownload().then(setDl, (e: Error) => setError(e.message));
  }, []);

  const admin = !!me?.user?.isAdmin;
  const open = !!dl && (dl.beta || admin);
  const windows = onWindowsPc();
  const size = megabytes(dl?.size);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      setCopied(true);
    } catch {
      // the address bar has it anyway
    }
  };

  if (dl && !open) {
    return (
      <main class="page narrow">
        <div class="stack">
          <h1>Auto-upload for Windows</h1>
          <p class="lead">The Windows uploader is still being tested and isn't open yet. Keep using the Upload page for now.</p>
          <div class="row">
            <a class="btn primary" href="/upload">
              Go to Upload
            </a>
          </div>
        </div>
      </main>
    );
  }

  let download;
  if (!dl) download = error ? <div class="notice err">{error}</div> : <p class="muted small">Loading…</p>;
  else if (!dl.version) download = <div class="notice warn">There's no build to download right now. Check back soon.</div>;
  else if (!windows) {
    download = (
      <div class="stack" style={{ gap: "10px", alignItems: "flex-start" }}>
        <div class="notice warn">This is a Windows app. Open this page on your gaming PC to download it.</div>
        <button type="button" class="btn" onClick={copy}>
          {copied ? "Link copied" : "Copy link"}
        </button>
      </div>
    );
  } else {
    download = (
      <div class="stack" style={{ gap: "10px", alignItems: "flex-start" }}>
        {!dl.connect && !admin && <div class="notice warn">New PCs can't be connected right now. Check back later.</div>}
        <a class="btn primary big" href={uploaderDownloadUrl(dl.version)}>
          Download for Windows
        </a>
        <div class="uploader-meta">
          <span>Version {dl.version}</span>
          {size && <span>{size}</span>}
          <span>Built by GitHub from the public source</span>
          <a href="https://github.com/anom0ly/Journey-forever/tree/main/uploader" target="_blank" rel="noopener">
            Source code
          </a>
          {dl.sha256 && (
            <button type="button" class="linklike" aria-expanded={showSum} onClick={() => setShowSum(!showSum)}>
              Check the file (SHA-256)
            </button>
          )}
        </div>
        {showSum && dl.sha256 && (
          <div class="notice small" style={{ wordBreak: "break-all" }}>
            In PowerShell, run <code>Get-FileHash .\JourneyForeverUploader.exe</code> in your Downloads folder. It should show{" "}
            <code>{dl.sha256.toUpperCase()}</code>
          </div>
        )}
      </div>
    );
  }

  return (
    <main class="page uploader-page">
      <section class="uploader-hero">
        <div class="stack" style={{ gap: "14px" }}>
          <span class="row" style={{ gap: "10px" }}>
            {dl?.beta && <BetaPill />}
            <span class="small muted">Windows 10 and 11</span>
          </span>
          <h1>Upload every session without lifting a finger</h1>
          <p class="lead">
            A small app that sits by your clock. Each time you log out of WoW Forever it reads your saved files, updates your journey and adds new
            screenshots. No more dragging folders.
          </p>
          {download}
        </div>
      </section>

      <div class="tiles three">
        <div class="card flat stack">
          <h3>Log out, done</h3>
          <p class="small muted">Uploads 15 seconds after WoW saves, with a small notification when it's on the site.</p>
        </div>
        <div class="card flat stack">
          <h3>Your files stay home</h3>
          <p class="small muted">It reads the saved files on your PC with the same code as the Upload page. Only the journey goes up, never the raw files.</p>
        </div>
        <div class="card flat stack">
          <h3>Addon kept current</h3>
          <p class="small muted">Installs and updates the Journey Forever addon while WoW is closed. You can turn that off on your Account page.</p>
        </div>
      </div>

      <div class="two-col">
        <div class="card flat stack uploader-list ok">
          <h3>What it does on your PC</h3>
          <ul class="small muted">
            <li>
              Installs to <b>your user folder</b> (AppData\Local\JourneyForever). No admin rights asked.
            </li>
            <li>
              Reads the <b>WTF saved files and Screenshots</b> in your WoW Forever folder.
            </li>
            <li>
              Writes only its own folder and the <b>JourneyForever addon folder</b>.
            </li>
            <li>Adds a Start menu shortcut and starts with Windows in the tray. You can switch that off.</li>
            <li>Talks only to this site and to GitHub, for updates.</li>
          </ul>
        </div>
        <div class="card flat stack uploader-list no">
          <h3>What it never does</h3>
          <ul class="small muted">
            <li>Ask for your Battle.net password. You approve it on this site.</li>
            <li>Read anything outside your WoW folder and its own folder.</li>
            <li>Touch other addons or game files.</li>
            <li>Update the addon while WoW is running, or send names in error reports.</li>
          </ul>
          <p class="small muted">
            To remove it: open it from the tray icon and choose <b>Remove from this PC</b>. You can also disconnect it from your Account page.
          </p>
        </div>
      </div>

      <section class="card flat stack">
        <h3>First run</h3>
        <ol class="uploader-steps">
          <li>
            <b>Open the download.</b> Double-click JourneyForeverUploader.exe.
          </li>
          <li>
            <b>If Windows warns you.</b> The app isn't signed yet, so Windows says "Windows protected your PC" and "Unknown publisher". Click{" "}
            <b>More info</b>, then <b>Run anyway</b>. To be sure the file is ours, check its SHA-256 above.
          </li>
          <li>
            <b>Allow it on the site.</b> It opens this site{me?.user ? "" : " and asks you to sign in with Battle.net"}. Check the PC name and click
            Allow.
          </li>
          <li>
            <b>Play.</b> Log out as usual. Your journey updates by itself.
          </li>
        </ol>
      </section>

      <div class="uploader-faq">
        <div>
          <b>Do I still need the addons?</b>
          <span class="small muted">Yes. Road to Sixty records your journey; the app only uploads it.</span>
        </div>
        <div>
          <b>Mac or Linux?</b>
          <span class="small muted">
            Not yet. Use the <a href="/upload">Upload page</a>.
          </span>
        </div>
        <div>
          <b>Two PCs?</b>
          <span class="small muted">Connect both. Journeys from each are stitched together, as with manual uploads.</span>
        </div>
        <div>
          <b>Is it safe?</b>
          <span class="small muted">The full source is on GitHub, and each release is built there by GitHub, not on someone's PC.</span>
        </div>
      </div>
    </main>
  );
}
