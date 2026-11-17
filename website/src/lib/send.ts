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
