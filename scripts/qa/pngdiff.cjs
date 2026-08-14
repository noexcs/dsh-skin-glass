/* dsh-skin-glass — scripts/qa/pngdiff.js
 * Dependency-free pixel diff for two 8-bit RGB/RGBA PNGs (no interlace).
 * Usage: node scripts/qa/pngdiff.js a.png b.png
 * Prints: differing-pixel ratio, mean/max channel delta, diff bounding box.
 * Interpretation aid: mean delta ~3-4/255 ≈ 1.5%/channel is usually a subtle
 * tint nuance; deltas in the tens signal a real compositing change.
 */
const zlib = require("zlib");
const fs = require("fs");

function decodePNG(path) {
  const buf = fs.readFileSync(path);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error(path + " is not a PNG");
  let off = 8, w = 0, h = 0, bitDepth = 0, colorType = 0, idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const data = buf.slice(off + 8, off + 8 + len);
    if (type === "IHDR") {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9];
      if (data[12] !== 0) throw new Error("interlaced PNG not supported");
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    off += 12 + len;
  }
  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 0;
  if (!bpp || bitDepth !== 8) throw new Error(`unsupported colorType ${colorType} depth ${bitDepth}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    const rowIn = y * (stride + 1) + 1;
    const rowOut = y * stride;
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[rowOut + x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = x >= bpp && prev ? prev[x - bpp] : 0;
      let v = raw[rowIn + x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[rowOut + x] = v & 0xff;
    }
  }
  return { w, h, bpp, data: out };
}

const a = decodePNG(process.argv[2]);
const b = decodePNG(process.argv[3]);
if (a.w !== b.w || a.h !== b.h || a.bpp !== b.bpp) {
  console.error(`dimension mismatch: ${a.w}x${a.h}x${a.bpp} vs ${b.w}x${b.h}x${b.bpp}`);
  process.exit(1);
}
let diffPixels = 0, maxDelta = 0, minX = 1e9, minY = 1e9, maxX = -1, maxY = -1, sumDelta = 0;
for (let i = 0; i < a.data.length; i += a.bpp) {
  let d = 0;
  for (let c = 0; c < a.bpp; c++) d = Math.max(d, Math.abs(a.data[i + c] - b.data[i + c]));
  if (d > 2) {
    diffPixels++;
    sumDelta += d;
    if (d > maxDelta) maxDelta = d;
    const px = (i / a.bpp) % a.w, py = Math.floor((i / a.bpp) / a.w);
    if (px < minX) minX = px; if (px > maxX) maxX = px;
    if (py < minY) minY = py; if (py > maxY) maxY = py;
  }
}
console.log(`size ${a.w}x${a.h}, differing pixels (d>2): ${diffPixels} (${(100 * diffPixels / (a.w * a.h)).toFixed(3)}%)`);
console.log(`max delta ${maxDelta}, mean delta over diffs ${(sumDelta / Math.max(1, diffPixels)).toFixed(2)}`);
console.log(`diff bounding box: x ${minX}..${maxX}, y ${minY}..${maxY}`);
