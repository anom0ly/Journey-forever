import { useEffect, useRef, useState } from "preact/hooks";
import { api, type AccountSummary, type FriendsInfo } from "../api";
import { date, dateTime, plural } from "../format";
import { setFriends, useFriends } from "../friends";
import { UploaderSection } from "./Uploader";

function megabytes(bytes: number): string {
  return bytes < 1e6 ? "under 1 MB" : `${Math.round(bytes / 1e6).toLocaleString("en-US")} MB`;
}

// Deleting the account removes every journey, screenshot, public link and
// sign-in tied to it. The button stays off until the BattleTag is typed.
function DeleteAccount({ a, onDeleted }: { a: AccountSummary; onDeleted: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const phrase = a.battletag ?? "DELETE";
  const remove = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await api.deleteAccount(typed);
      onDeleted();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <section class="card danger-zone">
      <h2>Delete account</h2>
      <p class="small">
        Permanently removes everything tied to this Battle.net account from Journey Forever, then signs you out everywhere. It can't be
        undone.
      </p>
      <div class="row">
        <button type="button" class="btn danger-outline" onClick={() => ref.current?.showModal()}>
          Delete my account…
        </button>
        <span class="tiny muted">To remove just one character, use Delete on its card under Characters.</span>
      </div>
      <dialog
        ref={ref}
        class="confirm wide"
        aria-labelledby="del-account"
        onClose={() => {
          setTyped("");
          setError(undefined);
        }}
      >
        <h2 id="del-account">Delete your account?</h2>
        <p class="small">This permanently deletes:</p>
        <ul class="small delete-list">
          <li>
            <b>{plural(a.characters.length, "character")}</b>
            {a.characters.length ? ` and ${a.characters.length === 1 ? "its journey" : "their journeys"}: ${a.characters.join(", ")}` : ""}
          </li>
          <li>
            <b>{plural(a.screenshots, "screenshot")}</b>
            {a.screenshots ? ` (${megabytes(a.screenshotBytes)})` : ""}
          </li>
          {a.publicLinks.length > 0 && (
            <li>
              <b>{plural(a.publicLinks.length, "public link")}</b>, which will stop working right away
              <br />
              <span class="tiny muted">{a.publicLinks.map((s) => `/j/${s}`).join(" · ")}</span>
            </li>
          )}
          <li>Your friends list, if you uploaded one</li>
          <li>Your BattleTag, Battle.net account number and every sign-in session</li>
        </ul>
        <p class="tiny muted">Your saved files in WoW aren't touched. Signing in again later starts a fresh, empty account.</p>
        <label class="small confirm-field">
          <span>
            Type <b class="mono">{phrase}</b> to confirm
          </span>
          <input
            type="text"
            class="text-input"
            value={typed}
            onInput={(e) => setTyped((e.target as HTMLInputElement).value)}
            autocomplete="off"
            spellcheck={false}
          />
        </label>
        {error && <div class="notice err">{error}</div>}
        <div class="row" style={{ justifyContent: "flex-end", gap: "12px" }}>
          <button type="button" class="btn" onClick={() => ref.current?.close()} disabled={busy}>
            Cancel
          </button>
          <button type="button" class="btn danger" onClick={remove} disabled={busy || typed !== phrase}>
            {busy ? "Deleting…" : "Delete everything"}
          </button>
        </div>
      </dialog>
    </section>
  );
}

const SOURCE_NAMES: Record<string, string> = { jf: "Journey Forever", rts: "Road to Sixty" };

// The friends we matched, the "show me" switch, and forgetting the list.
function FriendsSection() {
  const info = useFriends();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const run = async (fn: () => Promise<FriendsInfo>) => {
    setBusy(true);
    setError(undefined);
    try {
      setFriends(await fn());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (!info) return null;
  return (
    <section class="card flat">
      <div class="row between">
        <h2>Friends</h2>
        <span class="tiny muted">{info.updatedAt ? `Updated from your upload, ${date(info.updatedAt)}` : "No friends list uploaded yet"}</span>
      </div>
      {info.friends.length ? (
        <div class="list">
          {info.friends.map((f, i) => (
            <div class="item" key={i}>
              <span style={{ flex: "1 1 220px" }}>
                {f.characters.map((c, k) => (
                  <span key={c.slug}>
                    {k > 0 && ", "}
                    <a href={`/j/${encodeURIComponent(c.slug)}`} style={{ color: "var(--teal-hi)", fontWeight: 600, textDecoration: "none" }}>
                      {c.name}
                    </a>
                  </span>
                ))}
                {f.characters.length > 1 && <span class="tiny muted"> · one friend's {f.characters.length} characters</span>}
              </span>
              <span class="tiny muted">{f.sources.length ? f.sources.map((s) => SOURCE_NAMES[s] ?? s).join(" + ") : "Their friends list"}</span>
            </div>
          ))}
        </div>
      ) : (
        <p class="small muted">
          {info.updatedAt
            ? "None of your friends have a public character here yet."
            : "Upload with Journey Forever 1.1 or later (or Road to Sixty's friend sync) and your Battle.net friends' public characters are highlighted on the leaderboards and in Compare."}
        </p>
      )}
      {info.notOnSite > 0 && <p class="small muted">{plural(info.notOnSite, "more friend doesn't", "more friends don't")} use the site yet, or have no public characters.</p>}
      {error && <div class="notice err">{error}</div>}
      <div class="row between" style={{ borderTop: "1px solid var(--line)", paddingTop: "14px" }}>
        <label class="row" style={{ gap: "10px", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={info.visible}
            disabled={busy}
            onChange={(e) => run(() => api.setFriendsVisible((e.target as HTMLInputElement).checked))}
            style={{ width: "18px", height: "18px", accentColor: "var(--accent)" }}
          />
          <span class="small">Show me to my Battle.net friends</span>
        </label>
        {info.updatedAt && (
          <button type="button" class="btn" disabled={busy} onClick={() => run(() => api.forgetFriends())}>
            Forget my friends list
          </button>
        )}
      </div>
      <p class="tiny muted">
        Friends are matched by scrambled BattleTags; we never see or show the tags themselves. Turning the switch off takes your public
        characters out of your friends' highlights without making them private. Forget removes your list until your next upload.
      </p>
    </section>
  );
}

export function AccountPage({ onDeleted }: { onDeleted: () => void }) {
  const [a, setA] = useState<AccountSummary>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    api.account().then(setA, (e) => setError((e as Error).message));
  }, []);
  return (
    <main class="page narrow">
      <div class="stack">
        <h1>Your account</h1>
        {a && (
          <p class="lead">
            Signed in with Battle.net{a.battletag ? <> as <b style={{ color: "var(--text)" }}>{a.battletag}</b></> : null}.
          </p>
        )}
      </div>
      {error && <div class="notice err">{error}</div>}
      {a && (
        <>
          <section class="card flat">
            <h2>What we keep</h2>
            <div class="kv small">
              <span class="muted">Characters</span>
              <span>
                {a.characters.length}
                {a.publicLinks.length ? ` (${a.publicLinks.length} with public links)` : ""}
              </span>
              <span class="muted">Screenshots</span>
              <span>{a.screenshots ? `${a.screenshots.toLocaleString("en-US")} · ${megabytes(a.screenshotBytes)}` : "0"}</span>
              {a.createdAt && (
                <>
                  <span class="muted">Joined</span>
                  <span>{date(a.createdAt)}</span>
                </>
              )}
              <span class="muted">Last upload</span>
              <span>{a.lastUploadAt ? dateTime(a.lastUploadAt) : "Never"}</span>
            </div>
            <p class="tiny muted">
              We store your BattleTag and Battle.net account number, the journeys and screenshots you upload, scrambled copies of your
              Battle.net friends' BattleTags if your upload has a friends list, and your sign-in sessions. Nothing else.
            </p>
          </section>
          <UploaderSection />
          <FriendsSection />
          <DeleteAccount a={a} onDeleted={onDeleted} />
        </>
      )}
    </main>
  );
}
