// Loads a map's art: fetches its BLP tiles from the Worker (/maps/<id>.blp,
// copied from the game's files), decodes them and lays them out on one
// canvas. Each map is loaded once per page.

import { decodeBlp } from "../lib/blp";
import { mapInfo, type MapInfo } from "../lib/maps";

const ready = new Map<number, HTMLCanvasElement>();
const soft = new Map<number, HTMLCanvasElement>();
const pending = new Set<number>();
const failed = new Set<number>();

// The art if it has loaded; otherwise starts loading it and calls onLoad
// once it's there. With feathered, the art fades to clear at its edges.
export function mapArt(id: number, onLoad: () => void, feathered = false): HTMLCanvasElement | undefined {
  const done = ready.get(id);
  if (done && feathered) {
    let f = soft.get(id);
    if (!f) soft.set(id, (f = feather(done)));
    return f;
  }
  if (done || pending.has(id) || failed.has(id)) return done;
  const art = mapInfo(id)?.art;
  if (!art) return undefined;
  pending.add(id);
  load(art)
    .then((canvas) => {
      ready.set(id, canvas);
      onLoad();
    })
    .catch(() => failed.add(id))
    .finally(() => pending.delete(id));
  return undefined;
}

async function load(art: NonNullable<MapInfo["art"]>): Promise<HTMLCanvasElement> {
  const canvas = document.createElement("canvas");
  canvas.width = art.w;
  canvas.height = art.h;
  const ctx = canvas.getContext("2d")!;
  await Promise.all(
    art.tiles.map(async ([row, col, file]) => {
      const res = await fetch(`/maps/${file}.blp`);
      if (!res.ok) throw new Error(`Map tile ${file}: ${res.status}`);
      const px = decodeBlp(await res.arrayBuffer());
      ctx.putImageData(new ImageData(px.data, px.width, px.height), col * art.tileW, row * art.tileH);
    }),
  );
  return canvas;
}

// A copy whose edges fade out over FEATHER pixels of the art: two passes
// keep only as much as a left-right, then a top-bottom ramp allows.
const FEATHER = 48;
function feather(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = src.width;
  c.height = src.height;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(src, 0, 0);
  ctx.globalCompositeOperation = "destination-in";
  for (const [len, horizontal] of [[c.width, true], [c.height, false]] as const) {
    const g = horizontal ? ctx.createLinearGradient(0, 0, len, 0) : ctx.createLinearGradient(0, 0, 0, len);
    const edge = Math.min(0.45, FEATHER / len);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(edge, "rgba(0,0,0,1)");
    g.addColorStop(1 - edge, "rgba(0,0,0,1)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, c.width, c.height);
  }
  return c;
}
