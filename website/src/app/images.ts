// Getting screenshots ready to upload in the browser: TGA files (an option
// in the game) become JPEG, every shot gets a small thumbnail, and its ID
// is a hash of its bytes so the same shot uploads once.

export async function sha256Hex(data: ArrayBuffer, length = 32): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, length);
}

// Uncompressed and RLE true-colour TGA (what the game writes) to pixels.
function decodeTga(buf: ArrayBuffer): ImageData {
  const b = new Uint8Array(buf);
  const idLength = b[0], type = b[2];
  const width = b[12] | (b[13] << 8), height = b[14] | (b[15] << 8);
  const bpp = b[16] / 8, desc = b[17];
  if ((type !== 2 && type !== 10) || (bpp !== 3 && bpp !== 4) || !width || !height) throw new Error("Unsupported TGA");
  const topDown = (desc & 0x20) !== 0;
  const out = new ImageData(width, height);
  const px = out.data;
  let p = 18 + idLength;
  let n = 0;
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
  const total = width * height;
  if (type === 2) {
    while (n < total) {
      put(p);
      p += bpp;
    }
  } else {
    while (n < total) {
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
  return out;
}

async function toBitmap(file: File): Promise<ImageBitmap> {
  if (/\.tga$/i.test(file.name)) return createImageBitmap(decodeTga(await file.arrayBuffer()));
  return createImageBitmap(file);
}

function canvasBlob(bitmap: ImageBitmap, maxWidth: number, quality: number): Promise<Blob> {
  const scale = Math.min(1, maxWidth / bitmap.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't encode"))), "image/jpeg", quality));
}

export interface PreparedImage {
  id: string;
  image: Blob;
  thumb: Blob;
  width: number;
  height: number;
}

export async function prepareImage(file: File): Promise<PreparedImage> {
  const bytes = await file.arrayBuffer();
  const id = await sha256Hex(bytes);
  const bitmap = await toBitmap(file);
  const isTga = /\.tga$/i.test(file.name);
  const image = isTga ? await canvasBlob(bitmap, 4096, 0.9) : new Blob([bytes], { type: file.type || "image/jpeg" });
  const thumb = await canvasBlob(bitmap, 480, 0.8);
  const out = { id, image, thumb, width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return out;
}

// A preview URL for the upload page; TGA needs decoding first.
export async function previewUrl(file: File): Promise<string> {
  if (!/\.tga$/i.test(file.name)) return URL.createObjectURL(file);
  const bitmap = await toBitmap(file);
  const blob = await canvasBlob(bitmap, 480, 0.8);
  bitmap.close();
  return URL.createObjectURL(blob);
}
