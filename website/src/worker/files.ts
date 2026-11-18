// Checks on the files people upload, before they're stored.

import { JOURNEY_READ_LIMIT as JOURNEY_INFLATED_LIMIT } from "../lib/send";
import { HttpError } from "./http";

// JOURNEY_INFLATED_LIMIT: a journey unpacked can't be bigger. The biggest
// real ones are a few tens of MB; viewer pages stop reading at the same size.

// Every journey's JSON starts like this (lib/journey.ts, lib/merge.ts).
const JOURNEY_START = /^\{"format":\d+,"character":\{/;

// A gzipped journey as sent: real gzip, the size it says it unpacks to
// (the last 4 bytes) under the limit, and a journey's start once unpacked.
// The Worker can't unpack all of it (10 ms of CPU on the free plan), so a
// crafted file could still lie about its size; viewers stop at the limit.
export async function checkJourneyGzip(body: ArrayBuffer): Promise<void> {
  const bytes = new Uint8Array(body);
  if (bytes.length < 18 || bytes[0] !== 0x1f || bytes[1] !== 0x8b) throw new HttpError(400, "The journey isn't gzipped");
  const isize = new DataView(body).getUint32(bytes.length - 4, true);
  if (isize > JOURNEY_INFLATED_LIMIT) throw new HttpError(413, `Journey too large unpacked (limit ${JOURNEY_INFLATED_LIMIT / 1e6} MB)`);
  const reader = new Blob([body]).stream().pipeThrough(new DecompressionStream("gzip")).getReader();
  let head = new Uint8Array(0);
  try {
    while (head.length < 64) {
      const { done, value } = await reader.read();
      if (done) break;
      const next = new Uint8Array(head.length + value.length);
      next.set(head);
      next.set(value, head.length);
      head = next;
    }
  } catch {
    throw new HttpError(400, "The journey isn't valid gzip");
  } finally {
    reader.cancel().catch(() => {});
  }
  if (!JOURNEY_START.test(new TextDecoder().decode(head.subarray(0, 64)))) throw new HttpError(400, "That isn't a journey");
}

// The image type its first bytes say, or null.
export function sniffImage(body: ArrayBuffer): string | null {
  const b = new Uint8Array(body, 0, Math.min(body.byteLength, 12));
  const at = (i: number, ...v: number[]) => v.every((x, j) => b[i + j] === x);
  if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "image/webp";
  return null;
}

// The type to store an image under: what its bytes are. A file named .jpg
// that is really a PNG is kept (as a PNG); one that is no image is refused.
export function checkImage(body: ArrayBuffer): string {
  const type = sniffImage(body);
  if (!type) throw new HttpError(415, "That file isn't a JPEG, PNG or WebP image");
  return type;
}
