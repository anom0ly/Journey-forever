export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  if (!headers.has("cache-control")) headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function now(): number {
  return Math.floor(Date.now() / 1000);
}

export function isLocal(url: URL): boolean {
  return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
}

export function parseCookies(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function cookie(name: string, value: string, url: URL, maxAge: number): string {
  const secure = url.protocol === "https:" ? "; Secure" : "";
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export function randomToken(bytes = 32): string {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// State-changing requests must come from this site's own pages: the
// Origin header matches, and the custom header a form post can't send.
export function checkSameOrigin(req: Request, url: URL): void {
  if (req.method === "GET" || req.method === "HEAD") return;
  const origin = req.headers.get("origin");
  if (origin && origin !== url.origin) throw new HttpError(403, "Cross-site request refused");
  if (req.headers.get("x-journey-forever") !== "1") throw new HttpError(403, "Missing request header");
}

// Reads a request body up to limit bytes, refusing a larger one.
export async function readBody(req: Request, limit: number): Promise<ArrayBuffer> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > limit) throw new HttpError(413, `Too large (limit ${Math.round(limit / 1e6)} MB)`);
  const buf = await req.arrayBuffer();
  if (buf.byteLength > limit) throw new HttpError(413, `Too large (limit ${Math.round(limit / 1e6)} MB)`);
  return buf;
}

// The pages' security headers live in public/_headers. What the Worker
// answers itself is JSON, images and redirects, so it gets a stricter
// policy: nothing in it may run or be framed.
const SECURITY_HEADERS: Record<string, string> = {
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'; sandbox",
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "cross-origin-resource-policy": "same-origin",
};

export function withSecurityHeaders(res: Response): Response {
  // Response.redirect() gives immutable headers; copy those first. (Other
  // responses are changed in place, which keeps a manually gzipped body as it is.)
  let out = res;
  try {
    out.headers.set("x-content-type-options", "nosniff");
  } catch {
    out = new Response(res.body, res);
  }
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) if (!out.headers.has(k)) out.headers.set(k, v);
  return out;
}
