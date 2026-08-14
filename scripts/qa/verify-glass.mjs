/* dsh-skin-glass — scripts/qa/verify-glass.mjs
 * Restart-free verification harness against the running dsh web GUI.
 *
 * It never touches the server: the plugin bundle is swapped in the browser
 * through playwright route interception (or left as the live one), so old
 * and new builds can be compared side by side on the same running app.
 *
 * Usage:
 *   node scripts/qa/verify-glass.mjs                     # test the live bundle
 *   node scripts/qa/verify-glass.mjs --old-bundle /tmp/orig-client.js
 *       # run the same checks against a baseline bundle, then against the
 *       # live one, and report whether each run restored its baseline state
 *   node scripts/qa/verify-glass.mjs --shot /tmp/shots   # also save screenshots
 *
 * Checks per phase:
 *   1. baseline marker snapshot (surfaces/sheets, classes, geometry);
 *   2. hover the composer's command button: markers must NOT change while
 *      the tooltip is up, the bubble must sit just above its anchor, and no
 *      ancestor of the bubble may carry a backdrop-filter;
 *   3. after mouse-leave the marker state must equal the baseline exactly
 *      (state-drift regression);
 *   4. open settings: the dialog panel must keep its direct filter and the
 *      panel/mask must stay tinted (see docs/debugging.md).
 *
 * Dependencies: playwright-core (NOT a repo dependency). Install it once:
 *   mkdir -p /tmp/dsh-glass-qa && cd /tmp/dsh-glass-qa && npm init -y >/dev/null
 *   npm install playwright-core --no-audit --no-fund --cache /tmp/dsh-glass-qa/.npm-cache
 * Chromium: this script scans ~/Library/Caches/ms-playwright for a headless
 * shell; install one with `npx playwright-core install chromium` if missing.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import zlib from "node:zlib";

const require = createRequire(import.meta.url);

const ARGS = {};
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i];
  if (key === "--old-bundle" || key === "--shot") ARGS[key.slice(2).replace(/-/g, "")] = process.argv[++i];
}

const GUI_URL = process.env.DSH_WEB_URL || "http://127.0.0.1:3080/";
const BUNDLE_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "lib", "client.js");
const OLD_BUNDLE = ARGS.oldbundle || null;
const SHOT_DIR = ARGS.shot || null;

/* ── resolve playwright-core from a scratch dir / repo / DSH checkout ── */
function resolvePlaywright() {
  const candidates = [
    "/tmp/dsh-glass-qa/node_modules/playwright-core",
    "/tmp/dsh-glass-repro/node_modules/playwright-core",
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", "node_modules", "playwright-core"),
    "/Users/noexcs/.npm/_npx/1e7f6d9597241db0/node_modules/playwright-core"
  ];
  for (const dir of candidates) {
    try { return require(dir); } catch { /* keep looking */ }
  }
  return null;
}
const playwright = resolvePlaywright();
if (playwright === null) {
  console.error("playwright-core not found. Install it once (see the header comment), then re-run.");
  process.exit(1);
}
const { chromium } = playwright;

/* ── chromium executable discovery ─────────────────────────────────── */
function findChromium() {
  const cache = join(process.env.HOME || "~", "Library", "Caches", "ms-playwright");
  if (!existsSync(cache)) return null;
  for (const entry of readdirSync(cache)) {
    if (!entry.startsWith("chromium")) continue;
    const exe = join(cache, entry, "chrome-mac", "headless_shell");
    if (existsSync(exe)) return exe;
    const exe2 = join(cache, entry, "chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium");
    if (existsSync(exe2)) return exe2;
  }
  return null;
}
const EXE = findChromium();

/* ── seed image (64x64 gradient PNG data URL) ──────────────────────── */
function crc32(buf) { let c = ~0; for (let i = 0; i < buf.length; i++) { c ^= buf[i]; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const t = Buffer.from(type, "ascii"); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, crc]); }
function pngGradient(w, h) {
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) { raw[y * (1 + w * 4)] = 0; for (let x = 0; x < w; x++) { const o = y * (1 + w * 4) + 1 + x * 4; raw[o] = 40 + (x / w) * 200; raw[o + 1] = 60 + (y / h) * 160; raw[o + 2] = 120 + (x / w) * 100; raw[o + 3] = 255; } }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const DATA_URL = "data:image/png;base64," + pngGradient(64, 64).toString("base64");

/* ── in-page probes ────────────────────────────────────────────────── */
function snapshot() {
  const markers = [];
  for (const el of document.querySelectorAll("[data-dsh-glass-surface], [data-dsh-glass-sheet]")) {
    const r = el.getBoundingClientRect();
    markers.push({
      k: el.hasAttribute("data-dsh-glass-surface") ? "surface" : "sheet",
      v: el.getAttribute("data-dsh-glass-surface") || el.getAttribute("data-dsh-glass-sheet") || "",
      cls: String(el.className).slice(0, 32),
      x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height)
    });
  }
  return {
    markers,
    tooltip: !!document.querySelector("[role=tooltip]"),
    nSurface: document.querySelectorAll("[data-dsh-glass-surface]").length,
    nSheet: document.querySelectorAll("[data-dsh-glass-sheet]").length,
  };
}

function tooltipGeom(needle) {
  const bubble = document.querySelector("[role=tooltip]");
  const anchor = document.querySelector(`[data-composer-card] button[aria-label*="${needle}"]`);
  if (!bubble || !anchor) return null;
  const br = bubble.getBoundingClientRect();
  const ar = anchor.getBoundingClientRect();
  const bf = [];
  let p = bubble.parentElement;
  while (p && p !== document.documentElement) {
    if (getComputedStyle(p).backdropFilter !== "none") bf.push(String(p.className).slice(0, 40));
    p = p.parentElement;
  }
  return {
    bubble: { x: Math.round(br.x), y: Math.round(br.y), w: Math.round(br.width), h: Math.round(br.height) },
    anchor: { x: Math.round(ar.x), y: Math.round(ar.y), w: Math.round(ar.width), h: Math.round(ar.height) },
    backdropAncestors: bf,
  };
}

function dialogDump() {
  const fixed = Array.from(document.querySelectorAll("body *")).filter((el) => getComputedStyle(el).position === "fixed");
  const big = fixed.filter((el) => { const r = el.getBoundingClientRect(); return r.width > 300 && r.height > 300; })
    .sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width);
  const dialog = big[0] || null;
  if (!dialog) return null;
  const parts = [];
  const walk = (el, depth) => {
    if (depth > 4) return;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      const m = /^rgba?\(([^)]+)\)$/.exec(cs.backgroundColor);
      let a = 1; if (m) { const p = m[1].split(","); a = p.length > 3 ? Number(p[3]) : 1; }
      parts.push({
        cls: String(el.className).slice(0, 40),
        pos: cs.position,
        bgA: a,
        bf: cs.backdropFilter,
        surface: el.hasAttribute("data-dsh-glass-surface") ? el.getAttribute("data-dsh-glass-surface") : el.hasAttribute("data-dsh-glass-sheet") ? "sheet:" + el.getAttribute("data-dsh-glass-sheet") : null,
        tint: el.hasAttribute("data-dsh-glass-tint"),
      });
    }
    for (const c of el.children) walk(c, depth + 1);
  };
  walk(dialog, 0);
  return { shell: String(dialog.className).slice(0, 40), parts: parts.slice(0, 20) };
}

/* ── one verification phase ────────────────────────────────────────── */
let failures = 0;
function verdict(ok, name, detail) {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail !== undefined ? " — " + detail : ""}`);
  if (!ok) failures++;
}

async function phase(name, serveOld, prefix) {
  console.log(`\n=== phase ${name} ===`);
  const opts = EXE ? { executablePath: EXE, headless: true } : { headless: true };
  const browser = await chromium.launch(opts);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.text().includes("dsh-skin-glass")) console.log("[page]", m.text()); });
  if (serveOld && OLD_BUNDLE) {
    await page.route("**/plugins/dsh-skin-glass/client.js*", (route) => {
      route.fulfill({ status: 200, contentType: "application/javascript", body: readFileSync(OLD_BUNDLE, "utf8") });
    });
  }
  await page.goto(GUI_URL, { waitUntil: "domcontentloaded" });
  await page.evaluate((img) => localStorage.setItem("dsh-skin-glass:v1", JSON.stringify({ image: img, blur: 18, translucency: 0.45 })), DATA_URL);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("html[data-dsh-glass]", { timeout: 20000 });
  await page.waitForTimeout(3000);

  try {
    await page.locator("[data-composer-card] textarea").first().click();
    await page.keyboard.type("hello verify");
    await page.waitForTimeout(400);
  } catch { /* composer may be inert; hover checks still run */ }

  const baseline = await page.evaluate(snapshot);
  console.log("  baseline:", JSON.stringify(baseline));
  if (prefix) await page.screenshot({ path: `${prefix}-baseline.png` });

  // hover the command button (tooltip delay is 500ms)
  const btn = page.locator('[data-composer-card] button[aria-label*="命令"]').first();
  if (await btn.count()) {
    await btn.hover();
    await page.waitForTimeout(900);
    const during = await page.evaluate(snapshot);
    const geom = await page.evaluate(tooltipGeom, "命令");
    console.log("  during hover:", JSON.stringify(during));
    console.log("  tooltip:", JSON.stringify(geom));
    verdict(during.tooltip, "tooltip appears on hover");
    if (geom) {
      const expectedTop = geom.anchor.y - 8;
      verdict(Math.abs(geom.bubble.y + geom.bubble.h - expectedTop) <= 3, "bubble sits just above the anchor",
        `bubbleBottom=${geom.bubble.y + geom.bubble.h} anchorTop-8=${expectedTop}`);
      verdict(geom.backdropAncestors.length === 0, "no backdrop-filter ancestor re-anchors the bubble",
        JSON.stringify(geom.backdropAncestors));
    }
    verdict(JSON.stringify(baseline.markers) === JSON.stringify(during.markers),
      "markers unchanged while the tooltip is up", `${baseline.nSurface}->${during.nSurface} surfaces, ${baseline.nSheet}->${during.nSheet} sheets`);
    if (prefix) await page.screenshot({ path: `${prefix}-hover.png` });
    await page.mouse.move(400, 60);
    await page.waitForTimeout(1200);
    const after = await page.evaluate(snapshot);
    verdict(JSON.stringify(baseline) === JSON.stringify(after), "state restored exactly after mouse-leave",
      `surfaces ${baseline.nSurface}->${after.nSurface}, sheets ${baseline.nSheet}->${after.nSheet}`);
  } else {
    verdict(false, "command button found", "no [aria-label*=命令] button in the composer");
  }

  // settings dialog: panel must keep the direct filter + tint
  const opener = await page.evaluate(() => {
    const hit = Array.from(document.querySelectorAll("button, [role=button], a")).find((el) => /设置|Settings/.test(el.textContent || ""));
    if (!hit) return null;
    const r = hit.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  });
  if (opener) {
    await page.mouse.click(opener.x, opener.y);
    await page.waitForTimeout(1500);
    const dump = await page.evaluate(dialogDump);
    console.log("  settings dialog:", JSON.stringify(dump, null, 1));
    const panel = dump && dump.parts.find((p) => /panel/i.test(p.cls));
    if (panel) {
      verdict(panel.surface === "lg", "settings panel keeps the direct filter", `surface=${panel.surface} bf=${panel.bf}`);
      verdict(panel.tint === true, "settings panel stays tinted", `bgA=${panel.bgA}`);
    } else {
      verdict(false, "settings panel identified in the dialog dump");
    }
    if (prefix) await page.screenshot({ path: `${prefix}-settings.png` });
  } else {
    verdict(false, "settings entry found", "no clickable with 设置/Settings text");
  }

  await browser.close();
}

/* ── run ───────────────────────────────────────────────────────────── */
console.log("dsh-skin-glass verification harness (restart-free)");
console.log("bundle:", BUNDLE_PATH, OLD_BUNDLE ? `| old bundle: ${OLD_BUNDLE}` : "");
if (EXE) console.log("chromium:", EXE);

await phase("live", false, SHOT_DIR ? `${SHOT_DIR}/live` : null);
if (OLD_BUNDLE) await phase("old-baseline", true, SHOT_DIR ? `${SHOT_DIR}/old` : null);
console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
