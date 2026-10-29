import { describe, expect, it } from "vitest";
import { decodeBlp } from "../src/lib/blp";

// A BLP2 header with one mip level, then the image data.
function blp(compression: number, alphaDepth: number, alphaType: number, w: number, h: number, data: number[]): ArrayBuffer {
  const buf = new ArrayBuffer(148 + 1024 + data.length);
  const v = new DataView(buf);
  [0x42, 0x4c, 0x50, 0x32].forEach((b, i) => v.setUint8(i, b));
  v.setUint32(4, 1, true);
  v.setUint8(8, compression);
  v.setUint8(9, alphaDepth);
  v.setUint8(10, alphaType);
  v.setUint32(12, w, true);
  v.setUint32(16, h, true);
  v.setUint32(20, 148 + 1024, true);
  v.setUint32(84, data.length, true);
  new Uint8Array(buf, 148 + 1024).set(data);
  return buf;
}

describe("decodeBlp", () => {
  it("decodes a DXT1 block: endpoints and the two blends", () => {
    // c0 = pure red (0xF800), c1 = pure blue (0x001F); pixel indices 0,1,2,3 across the first row, 0 elsewhere.
    const px = decodeBlp(blp(2, 0, 0, 4, 4, [0x00, 0xf8, 0x1f, 0x00, 0b11100100, 0, 0, 0]));
    expect(px.width).toBe(4);
    const at = (i: number) => [...px.data.slice(i * 4, i * 4 + 4)];
    expect(at(0)).toEqual([255, 0, 0, 255]);
    expect(at(1)).toEqual([0, 0, 255, 255]);
    expect(at(2)).toEqual([170, 0, 85, 255]);
    expect(at(3)).toEqual([85, 0, 170, 255]);
    expect(at(15)).toEqual([255, 0, 0, 255]);
  });

  it("decodes plain BGRA", () => {
    const px = decodeBlp(blp(3, 8, 0, 1, 1, [10, 20, 30, 40]));
    expect([...px.data]).toEqual([30, 20, 10, 40]);
  });

  it("refuses something that isn't a BLP", () => {
    expect(() => decodeBlp(new ArrayBuffer(200))).toThrow("Not a BLP2 file");
  });
});
