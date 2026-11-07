// Journey Forever uploader for Windows. Double-click it: it copies itself to
// %LOCALAPPDATA%\JourneyForever, adds itself to the Start menu and to
// Windows startup, finds WoW Forever, and opens the site once so you can
// click Allow. After that it uploads your journey and new screenshots each
// time you log out.
//
// It has a tray icon while it runs and a window (host.ps1); run it again
// while it's running and the window opens. Started by Windows (--background)
// it's in the tray only. --updated-from=<version>: it just updated itself.

import { spawn } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { UPLOADER_EXE, UPLOADER_VERSION } from "../../website/src/lib/uploader";
import { Uploader } from "./app";
import { prepareHost, startHost } from "./host";
import { Reporter } from "./report";
import { removeOldExe } from "./update";
import { WindowControl } from "./window";
import { APP_NAME, handler } from "./server";
import { Store } from "./store";
import { deleteAfterExit, IS_WINDOWS, notify, openUrl, pickFolder, registryWowPaths, setStartMenu, setStartup } from "./windows";
import { candidateRoots, existingDrives, findForever, foreverIn } from "./wow";

const SITE = process.env.JF_SITE ?? "https://journey.wowhub.net";
const PORTS = Array.from({ length: 10 }, (_, i) => 47213 + i);
const updatedFrom = process.argv.find((a) => a.startsWith("--updated-from="))?.slice("--updated-from=".length);
const background = process.argv.includes("--background") || (!!updatedFrom && !process.argv.includes("--show"));

function randomHex(n = 24): string {
  return [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// A secret only this Windows user can read (it's in their own AppData). It
// opens the status page (/?t=…), so other users of the PC can't, and lets one
// copy of the uploader ask a running older one to quit before replacing it.
function instanceToken(store: Store): string {
  const file = join(store.dir, "instance.token");
  try {
    return readFileSync(file, "utf8").trim();
  } catch {
    const t = randomHex();
    writeFileSync(file, t, { mode: 0o600 });
    return t;
  }
}

async function findRunning(): Promise<{ port: number; version: string } | undefined> {
  for (const port of PORTS) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/ping`, { signal: AbortSignal.timeout(800) });
      const b = (await r.json()) as { app?: string; version?: string };
      if (b.app === APP_NAME) return { port, version: b.version ?? "" };
    } catch {
      // nothing there, or not us
    }
  }
  return undefined;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Asks the running copy to bring up its window (it opens the page in the
// browser itself when it has no window).
async function showRunning(port: number, token: string): Promise<void> {
  const r = await fetch(`http://127.0.0.1:${port}/show`, { method: "POST", headers: { "x-token": token } }).catch(() => undefined);
  if (!r?.ok) await openUrl(`http://127.0.0.1:${port}/?t=${token}`);
}

async function main(): Promise<void> {
  const store = new Store(SITE);
  const token = instanceToken(store);
  const installed = join(store.dir, UPLOADER_EXE);
  const self = process.execPath;
  const compiled = IS_WINDOWS && basename(self).toLowerCase() === UPLOADER_EXE.toLowerCase();
  // After an update the old copy is still quitting: give it a moment.
  if (updatedFrom) await sleep(1500);
  const running = await findRunning();

  // Started from Downloads (or wherever): install this copy, then hand over.
  if (compiled && self.toLowerCase() !== installed.toLowerCase()) {
    if (running) {
      if (running.version === UPLOADER_VERSION) {
        await showRunning(running.port, token);
        return;
      }
      // An older version is running from the installed copy: stop it first.
      await fetch(`http://127.0.0.1:${running.port}/quit`, { method: "POST", headers: { "x-token": token } }).catch(() => undefined);
      await sleep(2000);
    }
    copyFileSync(self, installed);
    spawn(installed, [], { detached: true, stdio: "ignore", windowsHide: true, cwd: store.dir }).unref();
    return;
  }

  if (running) {
    if (!background) await showRunning(running.port, token);
    return;
  }
  if (compiled) removeOldExe(installed);

  let port = 0;
  const windowCtl = new WindowControl();
  const statusUrl = () => `http://127.0.0.1:${port}/?t=${token}`;
  const uploader = new Uploader(
    store,
    () => port,
    compiled
      ? {
          exe: installed,
          restart(version) {
            const args = [`--updated-from=${UPLOADER_VERSION}`, ...(windowCtl.visible ? ["--show"] : [])];
            store.debug(`Restarting as ${version}`);
            windowCtl.quitting = true; // the tray icon goes
            setTimeout(() => {
              spawn(installed, args, { detached: true, stdio: "ignore", windowsHide: true, cwd: store.dir }).unref();
              quit();
            }, 1500);
          },
        }
      : undefined,
  );
  const pageToken = randomHex();
  const quit = () => {
    uploader.stop();
    process.exit(0);
  };
  const hooks = {
    uploader,
    token: pageToken,
    instanceToken: token,
    window: windowCtl,
    async openJourney() {
      await openUrl(`${store.config.site}/characters`);
    },
    async openInBrowser() {
      await openUrl(statusUrl());
    },
    async setStartup(on: boolean) {
      uploader.setStartup(on);
      if (compiled) await setStartup(on ? installed : undefined);
    },
    async pickFolder() {
      const chosen = await pickFolder(store.config.forever);
      if (!chosen) return;
      const forever = foreverIn(chosen);
      if (forever) uploader.setForever(forever);
      else store.log(`No _forever_ folder in ${chosen}. Choose the World of Warcraft folder that has _forever_ in it.`, false);
    },
    async remove() {
      store.log("Removed from this PC");
      await uploader.forget();
      await setStartup(undefined);
      await setStartMenu(undefined);
      windowCtl.quitting = true;
      // Everything it kept goes: key, settings, upload history, log, and the .exe.
      for (const f of ["config.json", "state.json", "uploader.log", "uploader.log.old", "instance.token"]) rmSync(join(store.dir, f), { force: true });
      if (compiled) deleteAfterExit(store.dir);
      setTimeout(quit, 1500); // the window and tray see "quit" and close first
    },
    quit,
  };
  for (const p of PORTS) {
    try {
      Bun.serve({ hostname: "127.0.0.1", port: p, fetch: handler(hooks, () => port) });
      port = p;
      break;
    } catch {
      // in use: try the next
    }
  }
  if (!port) {
    store.debug("No free port for the status page");
    return;
  }
  store.debug(`Started ${UPLOADER_VERSION} on port ${port}${background ? " (background)" : ""}`);

  // The tray icon and window. Elsewhere (development) the page opens in the browser.
  let hasWindow = false;
  if (compiled) {
    try {
      startHost(await prepareHost(store.dir), port, token, !background);
      hasWindow = true;
    } catch (e) {
      store.debug(`No window: ${(e as Error).message}`);
    }
  }
  // The host opens the window itself (JF_SHOW); if it hasn't checked in
  // after a while, something's wrong with it: use the browser.
  const showPage = async () => {
    for (let i = 0; hasWindow && i < 15; i++) {
      if (windowCtl.running || windowCtl.noWebView) return;
      await sleep(1000);
    }
    await openUrl(statusUrl());
  };

  if (compiled) {
    await setStartup(store.config.startup === false ? undefined : installed);
    if (store.state.shortcutVersion !== UPLOADER_VERSION) {
      await setStartMenu(installed);
      store.state.shortcutVersion = UPLOADER_VERSION;
      store.saveState();
    }
  }
  if (updatedFrom) {
    store.log(`Updated from version ${updatedFrom} to ${UPLOADER_VERSION}`);
    await notify(`Uploader updated to ${UPLOADER_VERSION}`, "It restarted itself and is watching for WoW saves again.");
  }

  if (!store.config.forever || !existsSync(store.config.forever)) {
    const forever = findForever(candidateRoots(await registryWowPaths(), existingDrives()));
    if (forever) {
      store.config.forever = forever;
      store.saveConfig();
      store.log(`Found WoW Forever in ${forever}`);
    } else {
      store.config.forever = undefined;
    }
  }

  await uploader.loadKey();
  uploader.start();
  // Crashed last time? Say so now (once the key is loaded, so it counts for this PC).
  void uploader.reporter.sendCrash();

  if (!uploader.isConnected) {
    if (background) await notify("Journey Forever uploader isn't connected", "Click its tray icon to connect this PC.");
    else {
      await showPage();
      await uploader.connect();
    }
  } else if (!background) {
    await showPage();
  }
}

// Anything that stops the uploader is written down and reported on the
// next start (report.ts).
function crashed(e: unknown): never {
  try {
    const store = new Store(SITE);
    store.debug(`Crashed: ${(e as Error)?.stack ?? String(e)}`);
    Reporter.saveCrash(store.dir, e);
  } catch {
    // nowhere to write
  }
  process.exit(1);
}
process.on("uncaughtException", crashed);
process.on("unhandledRejection", crashed);
main().catch(crashed);
