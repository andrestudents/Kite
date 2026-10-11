// T028 — manifest icons without a canvas dependency: rasterizes Kite's mark
// (white rhombus on the app teal) into plain RGBA and encodes PNG by hand
// (zlib + CRC32). Dev tooling — run once, commit the output:
//   cd apps/web && bun scripts/make-icons.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

const TEAL = [15, 118, 110, 255] as const; // #0f766e — the app's theme color
const WHITE = [255, 255, 255, 255] as const;

// ---- PNG encoding -----------------------------------------------------------
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of data) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.from(type, "ascii");
  const body = Buffer.concat([head, Buffer.from(data)]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function png(width: number, height: number, rgba: Uint8Array): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  // scanlines: one filter byte (0) per row
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(
      raw,
      y * (width * 4 + 1) + 1,
    );
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

// ---- The mark: a rhombus (kite) centered on the teal field ------------------
function drawIcon(size: number, shapeScale: number): Uint8Array {
  const rgba = new Uint8Array(size * size * 4);
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  const ax = (size * 0.16 * shapeScale) / 1;
  const ay = (size * 0.3 * shapeScale) / 1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const inside = Math.abs(x - cx) / ax + Math.abs(y - cy) / ay <= 1;
      const color = inside ? WHITE : TEAL;
      const at = (y * size + x) * 4;
      rgba[at] = color[0];
      rgba[at + 1] = color[1];
      rgba[at + 2] = color[2];
      rgba[at + 3] = color[3];
    }
  }
  return rgba;
}

const outDir = join(import.meta.dir, "..", "public", "icons");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "icon-192.png"), png(192, 192, drawIcon(192, 1)));
writeFileSync(join(outDir, "icon-512.png"), png(512, 512, drawIcon(512, 1)));
// maskable: the shape shrinks into the safe zone; the field stays full-bleed
writeFileSync(join(outDir, "icon-512-maskable.png"), png(512, 512, drawIcon(512, 0.66)));
console.log("icons written:", outDir);
