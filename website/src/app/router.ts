import { useEffect, useState } from "preact/hooks";

// A small history router: links are plain <a href>, caught here.

export function navigate(to: string, replace = false): void {
  if (replace) history.replaceState(null, "", to);
  else history.pushState(null, "", to);
  dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo(0, 0);
}

export function usePath(): string {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const on = () => setPath(location.pathname);
    addEventListener("popstate", on);
    return () => removeEventListener("popstate", on);
  }, []);
  return path;
}

// Same-site links go through navigate() instead of a page load.
export function installLinkHandler(): void {
  document.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as Element).closest?.("a");
    if (!a || a.target || a.hasAttribute("download")) return;
    const href = a.getAttribute("href");
    if (!href || !href.startsWith("/") || href.startsWith("//") || /^\/(auth|media|api)\//.test(href)) return;
    e.preventDefault();
    navigate(href);
  });
}

// "/c/:key/replay" against "/c/Player-1/replay" gives { key: "Player-1" }.
export function match(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split("/"), s = path.replace(/\/$/, "").split("/");
  if (p.length !== s.length) return null;
  const out: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(":")) out[p[i].slice(1)] = decodeURIComponent(s[i]);
    else if (p[i] !== s[i]) return null;
  }
  return out;
}
