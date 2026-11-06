export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  ASSETS: Fetcher;
  // "battlenet" (the default) or "dev": a local-only sign-in for trying the
  // site without a Battle.net client. Dev sign-in refuses any host but localhost.
  AUTH_MODE?: string;
  BNET_CLIENT_ID?: string;
  BNET_CLIENT_SECRET?: string;
  // Where Battle.net sends people back; defaults to <origin>/auth/callback.
  BNET_REDIRECT_URI?: string;
  // Battle.net account IDs (comma-separated) that can open the review page.
  // Set it as a secret. "dev" is the local dev sign-in.
  ADMIN_BNET_IDS?: string;
  // A GitHub token (fine-grained, public repositories read-only) so the
  // Uploaders page can list releases; set it as a secret. Optional, but
  // without it GitHub often refuses requests from Workers' shared addresses.
  GITHUB_TOKEN?: string;
  // Rate limits (wrangler.jsonc "ratelimits"); see limits.ts.
  RL_REQUESTS?: RateLimit;
  RL_CHANGES?: RateLimit;
  RL_ERRORS?: RateLimit;
}

export interface User {
  id: string;
  bnet_id: string | null;
  battletag: string | null;
  last_upload_at: number | null;
}
