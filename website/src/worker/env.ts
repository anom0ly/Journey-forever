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
}

export interface User {
  id: string;
  battletag: string | null;
  last_upload_at: number | null;
}
