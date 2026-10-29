// Decodes the first (full size) image of a BLP2 texture, the format the
// game's map art tiles come in, to RGBA pixels. Covers what map art uses:
// DXT1/3/5 compression, plus palette and plain BGRA for completeness.

export interface Pixels {
  width: number;
  height: number;
  data: Uint8ClampedArray<ArrayBuffer>; // RGBA, row by row
}

export function decodeBlp(buf: ArrayBuffer): Pixels {
  const v = new DataView(buf);
  if (buf.byteLength < 148 || v.getUint32(0, false) !== 0x424c5032) throw new Error("Not a BLP2 file");
  const compression = v.getUint8(8);
  const alphaDepth = v.getUint8(9);
  const alphaType = v.getUint8(10);
  const width = v.getUint32(12, true);
  const height = v.getUint32(16, true);
  const offset = v.getUint32(20, true);
  const size = v.getUint32(84, true);
  if (!width || !height || width > 4096 || height > 4096 || offset + size > buf.byteLength) throw new Error("Damaged BLP file");
  const src = new Uint8Array(buf, offset, size);
  const out = new Uint8ClampedArray(width * height * 4);

  if (compression === 2) {
    const kind = alphaType === 7 ? 5 : alphaType === 1 ? 3 : 1;
    dxt(src, out, width, height, kind, kind === 1 && alphaDepth > 0);
  } else if (compression === 3) {
    for (let i = 0; i < width * height; i++) {
      out[i * 4] = src[i * 4 + 2];
      out[i * 4 + 1] = src[i * 4 + 1];
      out[i * 4 + 2] = src[i * 4];
      out[i * 4 + 3] = src[i * 4 + 3];
    }
  } else if (compression === 1) {
    // 256 BGRA palette entries after the header, then one index per pixel,
    // then the alpha bits.
    const n = width * height;
    for (let i = 0; i < n; i++) {
      const p = 148 + src[i] * 4;
      out[i * 4] = v.getUint8(p + 2);
      out[i * 4 + 1] = v.getUint8(p + 1);
      out[i * 4 + 2] = v.getUint8(p);
      out[i * 4 + 3] = alphaAt(src, n, i, alphaDepth);
    }
  } else throw new Error(`Unknown BLP compression ${compression}`);
  return { width, height, data: out };
}

function alphaAt(src: Uint8Array, n: number, i: number, depth: number): number {
  if (depth === 8) return src[n + i];
  if (depth === 4) return ((src[n + (i >> 1)] >> ((i & 1) * 4)) & 15) * 17;
  if (depth === 1) return (src[n + (i >> 3)] >> (i & 7)) & 1 ? 255 : 0;
  return 255;
}

function rgb565(c: number, to: number[], at: number) {
  const r = (c >> 11) & 31, g = (c >> 5) & 63, b = c & 31;
  to[at] = (r << 3) | (r >> 2);
  to[at + 1] = (g << 2) | (g >> 4);
  to[at + 2] = (b << 3) | (b >> 2);
}

function dxt(src: Uint8Array, out: Uint8ClampedArray, width: number, height: number, kind: 1 | 3 | 5, punchThrough: boolean) {
  const blockSize = kind === 1 ? 8 : 16;
  const bw = Math.ceil(width / 4), bh = Math.ceil(height / 4);
  const colors = [0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255];
  const alphas = new Uint8Array(16);
  const a8 = new Uint8Array(8);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      let p = (by * bw + bx) * blockSize;
      if (p + blockSize > src.length) return;
      alphas.fill(255);
      if (kind === 3) {
        for (let i = 0; i < 16; i++) alphas[i] = ((src[p + (i >> 1)] >> ((i & 1) * 4)) & 15) * 17;
        p += 8;
      } else if (kind === 5) {
        a8[0] = src[p];
        a8[1] = src[p + 1];
        if (a8[0] > a8[1]) for (let i = 1; i < 7; i++) a8[i + 1] = ((7 - i) * a8[0] + i * a8[1]) / 7;
        else {
          for (let i = 1; i < 5; i++) a8[i + 1] = ((5 - i) * a8[0] + i * a8[1]) / 5;
          a8[6] = 0;
          a8[7] = 255;
        }
        // 48 bits of 3-bit indices, little endian.
        let bits = 0, have = 0, q = p + 2;
        for (let i = 0; i < 16; i++) {
          if (have < 3) {
            bits |= src[q++] << have;
            have += 8;
          }
          alphas[i] = a8[bits & 7];
          bits >>= 3;
          have -= 3;
        }
        p += 8;
      }
      const c0 = src[p] | (src[p + 1] << 8), c1 = src[p + 2] | (src[p + 3] << 8);
      rgb565(c0, colors, 0);
      rgb565(c1, colors, 4);
      const four = kind !== 1 || c0 > c1;
      for (let k = 0; k < 3; k++) {
        if (four) {
          colors[8 + k] = (2 * colors[k] + colors[4 + k]) / 3;
          colors[12 + k] = (colors[k] + 2 * colors[4 + k]) / 3;
        } else {
          colors[8 + k] = (colors[k] + colors[4 + k]) / 2;
          colors[12 + k] = 0;
        }
      }
      colors[15] = !four && punchThrough ? 0 : 255;
      const idx = src[p + 4] | (src[p + 5] << 8) | (src[p + 6] << 16) | (src[p + 7] << 24);
      for (let i = 0; i < 16; i++) {
        const x = bx * 4 + (i & 3), y = by * 4 + (i >> 2);
        if (x >= width || y >= height) continue;
        const c = ((idx >>> (i * 2)) & 3) * 4;
        const o = (y * width + x) * 4;
        out[o] = colors[c];
        out[o + 1] = colors[c + 1];
        out[o + 2] = colors[c + 2];
        out[o + 3] = kind === 1 ? colors[c + 3] : alphas[i];
      }
    }
  }
}
