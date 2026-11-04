import { Component, render, type ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { api, type Me } from "./api";
import { AccountPage } from "./pages/Account";
import { CharactersPage } from "./pages/Characters";
import { ComparePage, DemoComparePage } from "./pages/Compare";
import { DataPage } from "./pages/Data";
import { JourneyPage } from "./pages/Journey";
import { isTab } from "./pages/JourneyTabs";
import { Landing } from "./pages/Landing";
import { BoardPageView, isGroup, LeaderboardsPage } from "./pages/Leaderboards";
import { ReviewPage } from "./pages/Review";
import { MeContext } from "./me";
import { ReplayPage } from "./pages/Replay";
import { UploadPage } from "./pages/Upload";
import { installErrorReporting, reportError } from "./report";
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
      <nav class="nav" aria-label="Journey Forever">
        {!signedIn && link("/", "Home", path === "/")}
        {signedIn && link("/upload", "Upload", path === "/upload")}
        {signedIn && link("/characters", "Characters", path === "/characters" || path.startsWith("/c/"))}
        {link("/leaderboards", "Leaderboards", path.startsWith("/leaderboards"))}
        {link("/data", "Data sources", path === "/data")}
        {me?.user?.isAdmin && (
          <a href="/review" class={path === "/review" ? "active" : undefined} aria-current={path === "/review" ? "page" : undefined}>
            Review{me.reviewCount ? <span class="nav-count">{me.reviewCount}</span> : null}
          </a>
        )}
        <span class="push" />
        {signedIn && link("/account", me?.user?.battletag ?? "Account", path === "/account")}
        {signedIn ? (
          <button type="button" class="link" onClick={onSignOut}>
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

// A page that throws while drawing shows this instead of going blank, and
// the error is reported. Keyed by path in App, so moving to another page
// tries again.
class PageBoundary extends Component<{ children: ComponentChildren }, { broken: boolean }> {
  state = { broken: false };

  componentDidCatch(err: unknown) {
    reportError("render", err);
    this.setState({ broken: true });
  }

  render() {
    if (!this.state.broken) return this.props.children;
    return (
      <main class="page narrow">
        <h1>Something broke on this page</h1>
        <p class="lead">It's been reported, so we can fix it. Your journeys are safe.</p>
        <div class="row">
          <button type="button" class="btn primary" onClick={() => location.reload()}>
            Try again
          </button>
          <a class="btn" href="/">
            Go to the start
          </a>
        </div>
      </main>
    );
  }
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

  const accountDeleted = () => {
    setMe((m) => (m ? { ...m, user: null } : m));
    navigate("/?deleted=1");
  };

  let page;
  let m: Record<string, string> | null;
  const signedIn = !!me?.user;
  const needsUser = (el: preact.JSX.Element) => (!loaded ? null : signedIn ? el : <SignInFirst />);
  if (path === "/") page = loaded ? signedIn ? <CharactersPage /> : <Landing me={me} /> : null;
  else if (path === "/upload") page = needsUser(<UploadPage />);
  else if (path === "/characters") page = needsUser(<CharactersPage />);
  else if (path === "/account") page = needsUser(<AccountPage onDeleted={accountDeleted} />);
  else if (path === "/data") page = <DataPage signedIn={signedIn} />;
  else if (path === "/demo") page = <JourneyPage source={{ kind: "demo" }} />;
  else if (path === "/demo/compare") page = <DemoComparePage />;
  else if (path === "/demo/replay") page = <ReplayPage source={{ kind: "demo" }} />;
  else if ((m = match("/demo/:tab", path)) && isTab(m.tab)) page = <JourneyPage source={{ kind: "demo" }} tab={m.tab} />;
  else if ((m = match("/c/:key", path))) page = needsUser(<JourneyPage source={{ kind: "owner", key: m.key }} />);
  else if ((m = match("/c/:key/replay", path))) page = needsUser(<ReplayPage source={{ kind: "owner", key: m.key }} />);
  else if ((m = match("/c/:key/:tab", path)) && isTab(m.tab)) page = needsUser(<JourneyPage source={{ kind: "owner", key: m.key }} tab={m.tab} />);
  else if ((m = match("/j/:slug", path))) page = <JourneyPage source={{ kind: "public", slug: m.slug }} />;
  else if ((m = match("/j/:slug/replay", path))) page = <ReplayPage source={{ kind: "public", slug: m.slug }} />;
  else if ((m = match("/j/:slug/:tab", path)) && isTab(m.tab)) page = <JourneyPage source={{ kind: "public", slug: m.slug }} tab={m.tab} />;
  else if (path === "/leaderboards") page = <LeaderboardsPage />;
  else if ((m = match("/leaderboards/:group", path)) && isGroup(m.group)) page = <LeaderboardsPage group={m.group} />;
  else if ((m = match("/leaderboards/board/:board", path))) page = <BoardPageView id={m.board} />;
  else if ((m = match("/leaderboards/board/:board/:param", path))) page = <BoardPageView id={m.board} param={m.param} />;
  else if (path === "/review") page = !loaded ? null : me?.user?.isAdmin ? <ReviewPage onCount={(n) => setMe((x) => (x ? { ...x, reviewCount: n } : x))} /> : <NotFound />;
  else if ((m = match("/compare/:a", path))) page = loaded ? <ComparePage a={m.a} signedIn={signedIn} /> : null;
  else if ((m = match("/compare/:a/:b", path))) page = <ComparePage a={m.a} b={m.b} signedIn={signedIn} />;
  else page = <NotFound />;

  return (
    <MeContext.Provider value={me}>
      <Header me={me} path={path} onSignOut={signOut} />
      <PageBoundary key={path}>{page}</PageBoundary>
    </MeContext.Provider>
  );
}

installErrorReporting();
installLinkHandler();
render(<App />, document.getElementById("app")!);
