// What the window and tray (host.ps1) show, and asking them to open the
// window. The host polls /host/state every second; see server.ts.

import type { Status } from "./app";

export type Dot = "live" | "busy" | "warn" | "off";

function clock(t: number): string {
  return new Date(t * 1000).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

// The tray icon's dot and its hover text (Windows cuts that at 63 characters).
export function trayState(s: Status): { dot: Dot; tip: string } {
  const last = s.lastUploadAt ? `. Last upload ${clock(s.lastUploadAt)}` : "";
  if (!s.connected) return { dot: "warn", tip: "Journey Forever: not connected. Click to connect." };
  if (!s.forever) return { dot: "warn", tip: "Journey Forever: can't find WoW Forever" };
  if (s.error) return { dot: "warn", tip: "Journey Forever: upload failed. Click for details." };
  if (s.paused) return { dot: "off", tip: "Journey Forever: paused" };
  if (s.busy) return { dot: "busy", tip: `Journey Forever: ${s.busy}…` };
  return { dot: "live", tip: `Journey Forever: watching${last}` };
}

export class WindowControl {
  private seenAt = 0;
  private showCount = 0;
  quitting = false;
  visible = false; // the window is open and not minimized
  noWebView = false; // this PC can't show it: use the browser

  // Called by each poll from the host.
  polled(visible: boolean): { show: number; quit: boolean } {
    this.seenAt = Date.now();
    this.visible = visible;
    return { show: this.showCount, quit: this.quitting };
  }

  get running(): boolean {
    return !this.noWebView && Date.now() - this.seenAt < 5000;
  }

  // False when there's no window to open (then the caller opens the browser).
  show(): boolean {
    if (!this.running) return false;
    this.showCount++;
    return true;
  }
}
