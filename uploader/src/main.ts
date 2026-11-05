// Journey Forever uploader for Windows. Double-click it: it copies itself to
// %LOCALAPPDATA%\JourneyForever, starts with Windows from then on, finds
// WoW Forever, and opens the site once so you can click Allow. After that it
// uploads your journey and new screenshots each time you log out.
//
// Run it again while it's running and it opens its status page instead.
// Started by Windows (--background) it shows nothing until there's news.

import { spawn } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { UPLOADER_EXE, UPLOADER_VERSION } from "../../website/src/lib/uploader";
import { Uploader } from "./app";
import { APP_NAME, handler } from "./server";
import { Store } from "./store";
import { IS_WINDOWS, notify, openUrl, pickFolder, registryWowPaths, setStartup } from "./windows";
import { candidateRoots, existingDrives, findForever, foreverIn } from "./wow";

const SITE = process.env.JF_SITE ?? "https://journey-forever.hi-anomoly.workers.dev";
const PORTS = Array.from({ length: 10 }, (_, i) => 47213 + i);
const background = process.argv.includes("--background");

function randomHex(n = 24): string {
  return [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// A token other copies of the uploader (same Windows user) can read, so one
// can ask a running older one to quit before replacing it.
function instanceToken(store: Store): string {
  const file = join(store.dir, "instance.token");
  try {
    return readFileSync(file, "utf8").trim();
  } catch {
    const t = randomHex();
    writeFileSync(file, t);
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

async function main(): Promise<void> {
  const store = new Store(SITE);
  const token = instanceToken(store);
  const installed = join(store.dir, UPLOADER_EXE);
  const self = process.execPath;
  const compiled = IS_WINDOWS && basename(self).toLowerCase() === UPLOADER_EXE.toLowerCase();
  const running = await findRunning();

  // Started from Downloads (or wherever): install this copy, then hand over.
  if (compiled && self.toLowerCase() !== installed.toLowerCase()) {
    if (running) {
      if (running.version === UPLOADER_VERSION) {
        await openUrl(`http://127.0.0.1:${running.port}/`);
        return;
      }
      // An older version is running from the installed copy: stop it first.
      await fetch(`http://127.0.0.1:${running.port}/quit`, { method: "POST", headers: { "x-token": token } }).catch(() => undefined);
      await sleep(2000);
    }
    copyFileSync(self, installed);
    spawn(installed, [], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    return;
  }

  if (running) {
    if (!background) await openUrl(`http://127.0.0.1:${running.port}/`);
    return;
  }

  let port = 0;
  const uploader = new Uploader(store, () => port);
  const pageToken = randomHex();
  const quit = () => {
    uploader.stop();
    process.exit(0);
  };
  const hooks = {
    uploader,
    token: pageToken,
    instanceToken: token,
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
      setTimeout(quit, 500);
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

  if (compiled) await setStartup(installed);

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

  uploader.start();

  if (!store.config.key) {
    if (background) await notify("Journey Forever uploader isn't connected", "Double-click it to connect this PC.");
    else {
      await openUrl(`http://127.0.0.1:${port}/`);
      await uploader.connect();
    }
  } else if (!background) {
    await openUrl(`http://127.0.0.1:${port}/`);
  }
}

main().catch((e) => {
  try {
    new Store(SITE).debug(`Crashed: ${(e as Error).stack ?? String(e)}`);
  } catch {
    // nowhere to write
  }
  process.exit(1);
});
