/* dsh-skin-glass — scripts/qa/shared.mjs
 * Common scaffolding for the live QA harnesses (verify-glass.mjs,
 * probe-panels.mjs): playwright-core resolution from scratch dirs,
 * headless-chromium discovery, the seed wallpaper, and the boot sequence
 * that arms the skin on a fresh page. One copy, so the two harnesses cannot
 * drift (they did once: the playwright candidate lists diverged).
 */
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import zlib from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

/** Resolve playwright-core from a scratch dir or the repo (never a real dep). */
export function resolvePlaywright() {
  const candidates = [
    "/tmp/dsh-glass-qa/node_modules/playwright-core",
    "/tmp/dsh-glass-repro/node_modules/playwright-core",
    join(here, "..", "..", "node_modules", "playwright-core"),
    "/Users/noexcs/.npm/_npx/1e7f6d9597241db0/node_modules/playwright-core"
  ];
  for (const dir of candidates) {
    try { return require(dir); } catch { /* keep looking */ }
  }
  return null;
}

/** Find a headless chromium shell in the playwright browser cache. */
export function findChromium() {
  const cache = join(process.env.HOME || "~", "Library", "Caches", "ms-playwright");
  if (!existsSync(cache)) return null;
  for (const entry of readdirSync(cache)) {
    if (!entry.startsWith("chromium")) continue;
    for (const rel of [
      ["chrome-mac", "headless_shell"],
      ["chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"]
    ]) {
      const exe = join(cache, entry, ...rel);
      if (existsSync(exe)) return exe;
    }
  }
  return null;
}

/* ── seed wallpaper: a 64x64 gradient PNG data URL ────────────────────
   A gradient (rather than flat colour) gives the accent extraction and the
   pixel-diff screenshots something to chew on. */
function crc32(buf) { let c = ~0; for (let i = 0; i < buf.length; i++) { c ^= buf[i]; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const t = Buffer.from(type, "ascii"); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, crc]); }
function pngGradient(w, h) {
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) { raw[y * (1 + w * 4)] = 0; for (let x = 0; x < w; x++) { const o = y * (1 + w * 4) + 1 + x * 4; raw[o] = 40 + (x / w) * 200; raw[o + 1] = 60 + (y / h) * 160; raw[o + 2] = 120 + (x / w) * 100; raw[o + 3] = 255; } }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
export const SEED_DATA_URL = "data:image/png;base64," + pngGradient(64, 64).toString("base64");

/**
 * Boot a fresh page with the skin armed: open the GUI, persist the seed
 * wallpaper, reload, and wait for the skin's gate attribute. Returns the
 * page once the skin has tagged the baseline surfaces.
 * @param browser - launched chromium instance
 * @param opts.routeBody - bundle content served for the skin's client.js
 *   request (route interception: restart-free old-bundle comparisons)
 * @param opts.settleMs - extra settle after the gate appears
 * @param opts.onPage - hook called with the page right after creation, so
 *   listeners (e.g. console) attach before the first navigation
 */
export async function newGlassPage(browser, { routeBody = null, settleMs = 3000, onPage = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  if (onPage !== null) onPage(page);
  if (routeBody !== null) {
    await page.route("**/plugins/dsh-skin-glass/client.js*", (route) => {
      route.fulfill({ status: 200, contentType: "application/javascript", body: routeBody });
    });
  }
  await page.goto(process.env.DSH_WEB_URL || "http://127.0.0.1:3080/", { waitUntil: "domcontentloaded" });
  await page.evaluate((img) => localStorage.setItem("dsh-skin-glass:v1",
    JSON.stringify({ image: img, blur: 18 })), SEED_DATA_URL);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("html[data-dsh-glass]", { timeout: 20000 });
  if (settleMs > 0) await page.waitForTimeout(settleMs);
  return page;
}
