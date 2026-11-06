// Shared by the site and the Windows auto-uploader (uploader/ in the repo).

// The uploader's version. Bump it to release a new build: the Uploader
// workflow (Actions tab, Run workflow) tags uploader-v<version> and attaches
// the .exe, and the Account page links to that release.
export const UPLOADER_VERSION = "1.3.0";
export const UPLOADER_EXE = "JourneyForeverUploader.exe";
export const UPLOADER_REPO = "anom0ly/Journey-forever";

export function uploaderDownloadUrl(version = UPLOADER_VERSION): string {
  return `https://github.com/${UPLOADER_REPO}/releases/download/uploader-v${version}/${UPLOADER_EXE}`;
}

// The Account page's switches; the uploader reads them before each upload.
export interface UploaderSettings {
  shots: boolean; // upload the addon's screenshots
  manualShots: boolean; // also Print Screen shots from a session (1.3.0 and later; off by default)
  notify: boolean; // a Windows notification after each upload
  addon: boolean; // install the Journey Forever addon and keep it up to date
  update: boolean; // the uploader updates itself (1.1.0 and later)
  reports: boolean; // the uploader sends its problems, cleaned of names (1.2.0 and later)
}

export const UPLOADER_SETTINGS_DEFAULT: UploaderSettings = { shots: true, manualShots: false, notify: true, addon: true, update: true, reports: true };

// A port number from a /connect link, or undefined when it isn't one.
export function connectPort(v: string | null | undefined): number | undefined {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1024 && n <= 65535 ? n : undefined;
}

// The build the site approved (GET /api/uploader/latest): the uploader
// installs only this version, and only a file with this SHA-256.
export interface ApprovedUploader {
  version: string | null;
  sha256?: string;
  size?: number;
}
