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
   Windows startup, finds `World of Warcraft\_forever_`, and opens the site.
   Click **Allow**.

From then on it works in the background. When you log out, /reload or quit,
WoW writes the saved files; 15 seconds later the uploader reads them, merges
them with what's on the site and uploads, then shows a notification.

Double-click it again any time to open its status page (Upload now, Pause,
Change WoW folder, Remove from this PC). The switches for screenshots,
notifications and addon updates are on the site's Account page, which also
lists each connected PC and can disconnect it.

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
  requests addressed to 127.0.0.1/localhost, and its buttons need a token
  printed in the page.
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
`uploader-v<version>`. Installed copies don't update themselves yet: download
the new one and double-click it, and it replaces the running one.
