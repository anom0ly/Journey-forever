# Journey Forever uploader (Windows)

A small Windows program that uploads your journey and new screenshots to
Journey Forever each time you log out of WoW Forever, and keeps the Journey
Forever addon installed and up to date. **Admin only for now**: only accounts
in the site's `ADMIN_BNET_IDS` can connect a PC.

## Using it

1. On the site, open **Account** and click **Download for Windows**.
2. Double-click `JourneyForeverUploader.exe`. Windows may say it "protected
   your PC" (the file isn't code-signed): click **More info**, then **Run anyway**.
3. It copies itself to `%LOCALAPPDATA%\JourneyForever\`, adds itself to
   the Start menu and Windows startup, finds `World of Warcraft\_forever_`,
   opens its window, and opens the site. Click **Allow**.

From then on it works in the background. When you log out, /reload or quit,
WoW writes the saved files; 15 seconds later the uploader reads them, merges
them with what's on the site and uploads, then shows a notification.

While it runs it has a tray icon by the clock. The dot on it shows the
state: green watching, red uploading, amber needs you, grey paused. Click it
(or double-click the program, or use the Start menu) to open the window:
Upload now, Pause, Change WoW folder, Start with Windows, Check for updates,
Remove from this PC. The tray menu also has Check for updates. Closing the window minimizes it; **Quit** is in the tray
icon's right-click menu. Started with Windows, it's in the tray only.

The switches for screenshots, notifications, addon updates and uploader
updates are on the site's Account page, which also lists each connected PC
and can disconnect it.

## How it works

- It reads the saved files on the PC with the website's own code
  (`website/src/lib`: parsers, merge, screenshot matching, leaderboard
  numbers), exactly like the Upload page does in the browser. Raw saved files
  never leave the PC.
- It signs in with a per-PC upload key. Connecting: the uploader makes a
  secret and opens `/connect?port=…&challenge=<sha256 of the secret>`; Allow
  makes a one-time code and sends the browser to
  `http://127.0.0.1:<port>/connected?code=…`; the uploader swaps code +
  secret for the key (`POST /api/uploader/claim`). The key is stored only in
  `%LOCALAPPDATA%\JourneyForever\config.json` (the site keeps its hash) and
  can only upload (`website/src/worker/uploader.ts`, `UPLOADER_ROUTES`).
- The status page is served on `127.0.0.1` (ports 47213–47222), answers only
  requests addressed to 127.0.0.1/localhost, opens only with the instance
  token from the user's own folder, and its buttons need a token printed in
  the page.
- The window and tray icon are `src/host.ps1`, run by Windows PowerShell 5.1
  with Microsoft's WebView2 control (the Edge engine built into Windows 10
  and 11; DLLs in `vendor/webview2` from NuGet `Microsoft.Web.WebView2`
  1.0.2903.40, BSD licence). It polls `/host/state` once a second with the
  instance token and exits when the uploader stops. Without WebView2 the
  page opens in the browser instead. CI opens it for real on a Windows
  runner (`scripts/host-smoke.ts`).
- Self-update: a minute after starting and then every 6 hours it looks for a
  newer `uploader-v*` release published by `github-actions[bot]`, downloads
  the .exe, checks its SHA-256 against the digest GitHub records, renames
  the running .exe to `.old`, puts the new one in place and restarts into it.
- Addon updates: every 6 hours it compares `Interface\AddOns\JourneyForever\
  JourneyForever.toc` with the newest `addon-v*` release on GitHub and, while
  no WoW game is running, swaps in the new folder.
- Notifications go through Windows PowerShell (built into Windows 10 and 11).
- `uploader.log` in the same folder records what it did.

## Developing

Needs [Bun](https://bun.sh) 1.4.

```sh
cd uploader
bun install
bun test
bun run typecheck
bun run build          # dist/JourneyForeverUploader.exe (cross-compiles from Linux or macOS)
```

To try it against a local site: `JF_SITE=http://localhost:8787 JF_UPLOADER_HOME=/tmp/jfu bun src/main.ts`.
Off Windows, notifications and opening the browser are printed instead.

## Releasing

Bump `UPLOADER_VERSION` in `website/src/lib/uploader.ts` (the Account page
links to that version), merge, then **Actions → Uploader → Run workflow** on
`main`. It builds the .exe on Windows and publishes release
`uploader-v<version>`. Installed copies from 1.1.0 on pick it up within 6
hours (or at once with Check for updates); 1.0.0 needs the new one
downloaded and double-clicked once.

`assets/icon.ico` is the site's `favicon.svg` (also in `assets/`) at 16–256
pixels.
