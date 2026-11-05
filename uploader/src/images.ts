// Screenshots, ready to upload, the way the site's Upload page makes them
// (website/src/app/images.ts) but without a browser: the id is a hash of the
// file's bytes (so a shot uploads once, whichever way), JPEGs go up as they
// are with a small thumbnail, and TGA files become JPEG.

import jpeg from "jpeg-js";

export interface PreparedImage {
  id: string;
  image: Uint8Array;
  type: string;
  thumb?: Uint8Array; // JPEG; the site shows the full image when there's none
  width?: number;
  height?: number;
}

interface Pixels {
  width: number;
  height: number;
  data: Uint8Array; // RGBA
}

export async function shotId(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

export const MAX_TGA_SIDE = 8192;

// Uncompressed and RLE true-colour TGA (what the game writes).
export function decodeTga(b: Uint8Array): Pixels {
  const idLength = b[0], type = b[2];
  const width = b[12] | (b[13] << 8), height = b[14] | (b[15] << 8);
  const bpp = b[16] / 8, desc = b[17];
  if ((type !== 2 && type !== 10) || (bpp !== 3 && bpp !== 4) || !width || !height) throw new Error("Unsupported TGA");
  // Bigger than any screen (8K is 7680 wide): not a game screenshot.
  if (width > MAX_TGA_SIDE || height > MAX_TGA_SIDE) throw new Error("TGA too big");
  const topDown = (desc & 0x20) !== 0;
  const px = new Uint8Array(width * height * 4);
  let p = 18 + idLength;
  let n = 0;
  const total = width * height;
  const put = (o: number) => {
    const row = Math.floor(n / width), col = n % width;
    const y = topDown ? row : height - 1 - row;
    const i = (y * width + col) * 4;
    px[i] = b[o + 2];
    px[i + 1] = b[o + 1];
    px[i + 2] = b[o];
    px[i + 3] = 255;
    n++;
  };
  if (type === 2) {
    while (n < total && p + bpp <= b.length) {
      put(p);
      p += bpp;
    }
  } else {
    while (n < total && p < b.length) {
      const h = b[p++];
      const count = (h & 0x7f) + 1;
      if (h & 0x80) {
        for (let k = 0; k < count && n < total; k++) put(p);
        p += bpp;
      } else {
        for (let k = 0; k < count && n < total; k++) {
          put(p);
          p += bpp;
        }
      }
    }
  }
  return { width, height, data: px };
}

// Smaller by averaging each block of pixels (good enough for thumbnails).
export function shrink(src: Pixels, maxWidth: number): Pixels {
  if (src.width <= maxWidth) return src;
  const width = maxWidth;
  const height = Math.max(1, Math.round((src.height * maxWidth) / src.width));
  const out = new Uint8Array(width * height * 4);
  const sx = src.width / width, sy = src.height / height;
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
      let r = 0, g = 0, b = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) {
        let i = (yy * src.width + x0) * 4;
        for (let xx = x0; xx < x1; xx++, i += 4) {
          r += src.data[i];
          g += src.data[i + 1];
          b += src.data[i + 2];
          n++;
        }
      }
      const o = (y * width + x) * 4;
      out[o] = r / n;
      out[o + 1] = g / n;
      out[o + 2] = b / n;
      out[o + 3] = 255;
    }
  }
  return { width, height, data: out };
}

function toJpeg(p: Pixels, quality: number): Uint8Array {
  return new Uint8Array(jpeg.encode({ width: p.width, height: p.height, data: p.data }, quality).data);
}

// Width and height from a PNG's header.
function pngSize(b: Uint8Array): { width: number; height: number } | undefined {
  if (b.length < 24 || b[0] !== 0x89 || b[1] !== 0x50) return undefined;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return { width: v.getUint32(16), height: v.getUint32(20) };
}

export async function prepareImage(name: string, bytes: Uint8Array): Promise<PreparedImage> {
  const id = await shotId(bytes);
  if (/\.tga$/i.test(name)) {
    const px = decodeTga(bytes);
    return { id, image: toJpeg(shrink(px, 4096), 90), type: "image/jpeg", thumb: toJpeg(shrink(px, 480), 80), width: px.width, height: px.height };
  }
  if (/\.png$/i.test(name)) {
    return { id, image: bytes, type: "image/png", ...pngSize(bytes) };
  }
  const px = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 1024 });
  return { id, image: bytes, type: "image/jpeg", thumb: toJpeg(shrink(px, 480), 80), width: px.width, height: px.height };
}
