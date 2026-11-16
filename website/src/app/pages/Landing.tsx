import { AddonsPanel } from "../Addons";
import type { Me } from "../api";

// Why a sign-in didn't finish (worker/auth.ts), worded for the player.
const SIGNIN_HELP: Record<string, string> = {
  denied: "Sign-in was cancelled at Battle.net. Press Sign in to try again.",
  expired:
    "Sign-in took too long or your browser blocked our sign-in cookie. Try again, and if it keeps happening, allow cookies for journey.wowhub.net.",
  mismatch: "Sign-in got mixed up, often from two sign-in tabs at once. Close the other tab and try again.",
  token: "Battle.net turned down the sign-in. We've been told. Try again in a minute; if it keeps happening, check back later today.",
  userinfo: "Battle.net didn't send your account details. We've been told. Try again in a minute.",
  account: "Battle.net didn't send an account id. We've been told. Try again in a minute.",
};

export function Landing({ me }: { me: Me | null }) {
  const params = new URLSearchParams(location.search);
  const problem = params.get("signin");
  return (
    <main class="page narrow">
      <div class="stack-lg" style={{ maxWidth: "720px" }}>
        <h1>Your WoW Forever journey, level 1 to 60</h1>
        <p class="lead">
          After each session, drop your WTF folder here. Journey Forever reads the saved files of Road to Sixty, our own small addon and,
          if you use it, Journey Tracker, and turns them into a recap for every character: the road you walked, replayed on the map, with every level,
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
          <div class="notice err" role="alert">
            {SIGNIN_HELP[params.get("why") ?? ""] ?? "Battle.net sign-in didn't go through. Try again."}
          </div>
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
      <AddonsPanel />
      <div class="split">
        <div class="card">
          <h2>1. Play</h2>
          <p class="muted">
            Install <a href="#addons">the addons above</a>. They record as you play and write their files when you log out.
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
