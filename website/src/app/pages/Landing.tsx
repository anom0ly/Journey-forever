import type { Me } from "../api";

export function Landing({ me }: { me: Me | null }) {
  const params = new URLSearchParams(location.search);
  const problem = params.get("signin");
  return (
    <main class="page narrow">
      <div class="stack-lg" style={{ maxWidth: "720px" }}>
        <h1>Your WoW Forever journey, level 1 to 60</h1>
        <p class="lead">
          After each session, drop your WTF folder here. Journey Forever reads the saved files of Road to Sixty, Journey Tracker and our
          own small addon, and turns them into a recap for every character: the road you walked, replayed on the map, with every level,
          death, dungeon, quest and gold piece along the way.
        </p>
        {params.has("deleted") && (
          <div class="notice ok">
            Your account is deleted. Its characters, journeys, screenshots and public links are gone, and you've been signed out.
          </div>
        )}
        {problem === "unconfigured" || me?.authMode === "unconfigured" ? (
          <div class="notice warn">
            Sign-in with Battle.net isn't switched on for this site yet. You can still look around with the sample journey.
          </div>
        ) : problem === "failed" ? (
          <div class="notice err">Battle.net sign-in didn't go through. Try again.</div>
        ) : null}
        <div class="row">
          <a class="btn primary" href="/auth/login">
            {me?.authMode === "dev" ? "Sign in (local dev account)" : "Sign in with Battle.net"}
          </a>
          <a class="btn" href="/demo">
            See a sample journey
          </a>
        </div>
      </div>
      <div class="split">
        <div class="card">
          <h2>1. Play</h2>
          <p class="muted">
            Install Road to Sixty, Journey Tracker and Journey Forever. They record as you play and write their files when you log out.
          </p>
        </div>
        <div class="card">
          <h2>2. Upload</h2>
          <p class="muted">Drop your account's WTF folder and any screenshots. Every character on the account is picked up at once.</p>
        </div>
        <div class="card">
          <h2>3. Relive it</h2>
          <p class="muted">Each character gets a journey page and a map replay. Keep it private, or share it with a link.</p>
        </div>
      </div>
    </main>
  );
}
