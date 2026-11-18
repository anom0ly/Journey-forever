// The pages' fetch for the API (app/api.ts), kept apart so it can be tested.

// Requests that do the same thing however often they're sent, so one that
// got no answer at all can safely go again. POSTs (reports, approvals) don't.
export const RETRY_METHODS = new Set(["GET", "HEAD", "PUT", "DELETE"]);
export const RETRY_DELAYS = [1_000, 3_000];

// fetch, but a request that got no answer (fetch throws: the connection
// dropped, or something on the player's PC such as an ad blocker's HTTPS
// filtering cut it) is sent again, twice at most, before giving up.
export async function send(path: string, init: RequestInit, wait = (ms: number) => new Promise((r) => setTimeout(r, ms))): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetch(path, init);
    } catch (err) {
      if (!(err instanceof TypeError) || !RETRY_METHODS.has(method) || attempt >= RETRY_DELAYS.length) throw err;
      await wait(RETRY_DELAYS[attempt]);
    }
  }
}

// A journey can't be bigger than this unpacked (the Worker checks what it
// can of this when one is uploaded: worker/files.ts).
export const JOURNEY_READ_LIMIT = 200e6;

// A response's JSON, but reading stops (and throws) once the unpacked body
// passes limit bytes, so a file built to unpack into gigabytes can't hang
// the tab.
export async function readJsonCapped<T>(res: Response, limit: number): Promise<T> {
  if (!res.body) return (await res.json()) as T;
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      throw new Error(`This journey is too large to open (over ${Math.round(limit / 1e6)} MB)`);
    }
    parts.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    all.set(p, at);
    at += p.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(all)) as T;
}
