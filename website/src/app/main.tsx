import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { api, type Me } from "./api";
import { CharactersPage } from "./pages/Characters";
import { DataPage } from "./pages/Data";
import { JourneyPage } from "./pages/Journey";
import { Landing } from "./pages/Landing";
import { ReplayPage } from "./pages/Replay";
import { UploadPage } from "./pages/Upload";
import { installLinkHandler, match, navigate, usePath } from "./router";
import "./styles.css";

function Header({ me, path, onSignOut }: { me: Me | null; path: string; onSignOut: () => void }) {
  const link = (href: string, label: string, active: boolean) => (
    <a href={href} class={active ? "active" : undefined} aria-current={active ? "page" : undefined}>
      {label}
    </a>
  );
  const signedIn = !!me?.user;
  return (
    <header class="site-header">
      <a class="brand" href={signedIn ? "/characters" : "/"}>
        Journey Forever
      </a>
      <nav class="nav" aria-label="Main">
        {signedIn && link("/upload", "Upload", path === "/upload")}
        {signedIn && link("/characters", "Characters", path === "/characters" || path.startsWith("/c/"))}
        {link("/data", "Data sources", path === "/data")}
        {signedIn ? (
          <button type="button" class="link" onClick={onSignOut} title={me?.user?.battletag ?? undefined}>
            Sign out
          </button>
        ) : (
          <a href="/auth/login">Sign in</a>
        )}
      </nav>
    </header>
  );
}

function NotFound() {
  return (
    <main class="page narrow">
      <h1>Nothing here</h1>
      <p class="muted">
        That page doesn't exist. <a href="/">Go to the start</a>.
      </p>
    </main>
  );
}

function SignInFirst() {
  return (
    <main class="page narrow">
      <h1>Sign in first</h1>
      <p class="lead">Your characters and uploads are tied to your Battle.net account.</p>
      <div class="row">
        <a class="btn primary" href="/auth/login">
          Sign in with Battle.net
        </a>
      </div>
    </main>
  );
}

function App() {
  const path = usePath();
  const [me, setMe] = useState<Me | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api
      .me()
      .then(setMe)
      .catch(() => setMe({ user: null, authMode: "unconfigured" }))
      .finally(() => setLoaded(true));
  }, []);

  const signOut = async () => {
    await api.logout().catch(() => undefined);
    setMe((m) => (m ? { ...m, user: null } : m));
    navigate("/");
  };

  let page;
  let m: Record<string, string> | null;
  const signedIn = !!me?.user;
  const needsUser = (el: preact.JSX.Element) => (!loaded ? null : signedIn ? el : <SignInFirst />);
  if (path === "/") page = loaded ? signedIn ? <CharactersPage /> : <Landing me={me} /> : null;
  else if (path === "/upload") page = needsUser(<UploadPage />);
  else if (path === "/characters") page = needsUser(<CharactersPage />);
  else if (path === "/data") page = <DataPage signedIn={signedIn} />;
  else if (path === "/demo") page = <JourneyPage source={{ kind: "demo" }} />;
  else if (path === "/demo/replay") page = <ReplayPage source={{ kind: "demo" }} />;
  else if ((m = match("/c/:key", path))) page = needsUser(<JourneyPage source={{ kind: "owner", key: m.key }} />);
  else if ((m = match("/c/:key/replay", path))) page = needsUser(<ReplayPage source={{ kind: "owner", key: m.key }} />);
  else if ((m = match("/j/:slug", path))) page = <JourneyPage source={{ kind: "public", slug: m.slug }} />;
  else if ((m = match("/j/:slug/replay", path))) page = <ReplayPage source={{ kind: "public", slug: m.slug }} />;
  else page = <NotFound />;

  return (
    <>
      <Header me={me} path={path} onSignOut={signOut} />
      {page}
    </>
  );
}

installLinkHandler();
render(<App />, document.getElementById("app")!);
