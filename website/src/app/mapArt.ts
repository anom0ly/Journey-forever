// Loads a map's art: fetches its BLP tiles from the Worker (/maps/<id>.blp,
// copied from the game's files), decodes them and lays them out on one
// canvas. Each map is loaded once per page.

import { decodeBlp } from "../lib/blp";
import { mapInfo, type MapInfo } from "../lib/maps";

const ready = new Map<number, HTMLCanvasElement>();
const pending = new Set<number>();
const failed = new Set<number>();

// The art if it has loaded; otherwise starts loading it and calls onLoad
// once it's there.
export function mapArt(id: number, onLoad: () => void): HTMLCanvasElement | undefined {
  const done = ready.get(id);
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
