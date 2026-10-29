import { useEffect, useRef, useState } from "preact/hooks";
import { api, type AccountSummary } from "../api";
import { date, dateTime, plural } from "../format";

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
              We store your BattleTag and Battle.net account number, the journeys and screenshots you upload, and your sign-in sessions.
              Nothing else.
            </p>
          </section>
          <DeleteAccount a={a} onDeleted={onDeleted} />
        </>
      )}
    </main>
  );
}
