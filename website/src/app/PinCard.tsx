// The card that opens over a replay map when a purple diamond is clicked:
// the screenshot (or note) pinned to its spot, with a full-size view and a
// jump to that moment in the replay. On a narrow map it's a sheet along the
// bottom instead, so it never covers the diamond.

import { useEffect, useState } from "preact/hooks";
import type { Pin, PinImage } from "../lib/pins";
import { day, time } from "./format";

const CARD_W = 264;
const SHEET_BELOW = 400; // map width under which the card is a sheet
const ROOM_ABOVE = 270; // about a card's height with its image

export function PinCard({
  pins,
  x,
  y,
  w,
  ink,
  who,
  onClose,
  onJump,
}: {
  pins: Pin<PinImage>[];
  x: number; // the diamond on screen, in the map's box
  y: number;
  w: number; // the map's width
  ink?: string; // whose shots, on the compare page
  who?: string;
  onClose: () => void;
  onJump: (t: number) => void;
}) {
  const [i, setI] = useState(0);
  const [full, setFull] = useState(false);
  const key = pins.map((p) => p.t).join();
  useEffect(() => {
    setI(0);
    setFull(false);
  }, [key]);
  const pin = pins[Math.min(i, pins.length - 1)];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (full) setFull(false);
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [full, onClose]);

  if (!pin) return null;
  const sheet = w < SHEET_BELOW;
  const left = Math.min(Math.max(x, CARD_W / 2 + 8), w - CARD_W / 2 - 8);
  const above = y >= ROOM_ABOVE;
  const style = sheet
    ? { borderColor: ink }
    : { left: `${left}px`, top: `${y}px`, "--ax": `${x - left}px`, borderColor: ink };
  const where = [pin.k === "note" ? "Note" : `Level ${pin.level}`, pin.zone, `${day(pin.t)}, ${time(pin.t)}`].filter(Boolean).join(" · ");
  const label = pin.k === "note" ? `Note: ${pin.text}` : pin.title;

  return (
    <>
      <div
        class={`pin-card ${sheet ? "sheet" : above ? "above" : "below"}`}
        style={style}
        role="dialog"
        aria-label={label}
        onPointerDown={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
      >
        {sheet && <div class="pin-grab" aria-hidden="true" />}
        {pin.k === "note" ? (
          <p class="pin-note">“{pin.text}”</p>
        ) : pin.image ? (
          <button type="button" class="pin-img" onClick={() => setFull(true)} aria-label={`Open ${pin.title} full size`}>
            <img src={pin.image.thumb} alt={pin.title} />
          </button>
        ) : (
          <div class="pin-missing">
            {pin.failed ? "The game couldn't save this screenshot." : "Screenshot logged, but the image wasn't uploaded. Add it with your next upload."}
          </div>
        )}
        <button type="button" class="pin-x" aria-label="Close" onClick={onClose}>
          ×
        </button>
        <div class="pin-body">
          {who && (
            <div class="tiny" style={{ color: ink, fontWeight: 600 }}>
              {who}
            </div>
          )}
          {pin.k !== "note" && <div class="pin-title">{pin.title}</div>}
          <div class="tiny muted">{where}</div>
          <div class="pin-row">
            {pins.length > 1 ? (
              <span class="pin-pager">
                <button type="button" aria-label="Previous" disabled={i === 0} onClick={() => setI(i - 1)}>
                  ‹
                </button>
                {i + 1} of {pins.length}
                <button type="button" aria-label="Next" disabled={i >= pins.length - 1} onClick={() => setI(i + 1)}>
                  ›
                </button>
              </span>
            ) : pin.image ? (
              <button type="button" class="pin-link" onClick={() => setFull(true)}>
                Open full size ↗
              </button>
            ) : (
              <span />
            )}
            <button type="button" class="pin-jump" onClick={() => onJump(pin.t)}>
              ⏮ Jump here
            </button>
          </div>
        </div>
      </div>
      {full && pin.image && (
        <div class="lightbox" role="dialog" aria-label={pin.title} onPointerDown={(e) => e.stopPropagation()} onClick={() => setFull(false)}>
          <img src={pin.image.url} alt={pin.title} />
          <span class="small muted">{pin.title} · click anywhere to close</span>
        </div>
      )}
    </>
  );
}

// A diamond under the pointer or open in a card: drawn bigger, with a glow.
export function drawPinMark(ctx: CanvasRenderingContext2D, px: number, py: number, open: boolean, edge = "#FFFFFF") {
  const r = open ? 10 : 9;
  ctx.save();
  ctx.shadowColor = open ? "rgba(196, 150, 255, 0.9)" : "rgba(255, 255, 255, 0.5)";
  ctx.shadowBlur = open ? 14 : 8;
  ctx.fillStyle = "#7A3FB0";
  ctx.strokeStyle = edge;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(px, py - r);
  ctx.lineTo(px + r * 0.875, py);
  ctx.lineTo(px, py + r);
  ctx.lineTo(px - r * 0.875, py);
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.stroke();
  ctx.restore();
}

// The plain diamond, as the replay draws every screenshot and note.
export function drawPin(ctx: CanvasRenderingContext2D, px: number, py: number, edge = "#FFFFFF") {
  ctx.fillStyle = "#7A3FB0";
  ctx.strokeStyle = edge;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(px, py - 8);
  ctx.lineTo(px + 7, py);
  ctx.lineTo(px, py + 8);
  ctx.lineTo(px - 7, py);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

// Up to this far, a press and release on the map is a click, not a drag.
export const CLICK_SLOP = 5;
