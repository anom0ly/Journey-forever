// One copy of the uploader runs per Windows user. A second copy (the .exe
// double-clicked again, or a new download) finds the running one on its
// local port and asks it to show its window or quit, with the instance
// token from this user's own AppData. Before sending that token it checks
// the copy that answered proves it knows it too, so another program sitting
// on one of these ports (say, another user's on a shared PC) never gets it.

export const APP_NAME = "journey-forever-uploader";
export const PORTS = Array.from({ length: 10 }, (_, i) => 47213 + i);

export function randomHex(n = 24): string {
  return [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Proves to another copy of the uploader that this one knows the instance
// token (it's in this Windows user's own AppData), without sending it: an
// HMAC of the copy's challenge and this port. Something else listening on
// one of our ports can't answer it, so it's never handed the token.
export async function pingProof(token: string, challenge: string, port: number): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(token), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(`journey-forever-ping:${port}:${challenge}`));
  return [...new Uint8Array(mac)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

// Another copy answering on one of our ports. `proven` only when it showed it
// knows this user's instance token; the token is sent to nothing else.
export interface Running {
  port: number;
  version: string;
  proven: boolean;
}

// The proven copy if there is one (something else may hold a lower port),
// else the first that answered at all.
export async function findRunning(
  token: string | undefined,
  get: (url: string) => Promise<Response> = (u) => fetch(u, { signal: AbortSignal.timeout(800) }),
): Promise<Running | undefined> {
  let first: Running | undefined;
  for (const port of PORTS) {
    try {
      const challenge = randomHex(16);
      const r = await get(`http://127.0.0.1:${port}/ping?c=${challenge}`);
      const b = (await r.json()) as { app?: string; version?: string; proof?: string };
      if (b.app !== APP_NAME) continue;
      const proven = !!token && typeof b.proof === "string" && b.proof === (await pingProof(token, challenge, port));
      if (proven) return { port, version: b.version ?? "", proven };
      first ??= { port, version: b.version ?? "", proven };
    } catch {
      // nothing there, or not us
    }
  }
  return first;
}

