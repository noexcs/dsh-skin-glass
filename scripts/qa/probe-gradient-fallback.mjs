/* dsh-skin-glass — scripts/qa/probe-gradient-fallback.mjs
 * Live, restart-free verification of the no-image gradient fallback against
 * the running dsh web GUI. The bundle is swapped in the browser through
 * playwright route interception, exactly like verify-glass.mjs.
 *
 * Two scenarios, one fresh page each:
 *   1. no image               → chrome gated; body resolves
 *      --dsh-glass-image to a mesh gradient; body::before paints scrim +
 *      gradient; the surface detector tags real panels;
 *   2. image set              → --dsh-glass-image is the image URL (the
 *      gradient token must not leak into the image mode).
 *
 * Usage:
 *   node scripts/qa/probe-gradient-fallback.mjs [--shot /tmp/shots]
 * Dependencies: playwright-core + headless chromium (see shared.mjs).
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePlaywright, findChromium, SEED_DATA_URL } from "./shared.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const BUNDLE = readFileSync(join(here, "..", "..", "lib", "client.js"), "utf8");
const SHOT_DIR = process.argv.includes("--shot") ? process.argv[process.argv.indexOf("--shot") + 1] : null;
const WEB_URL = process.env.DSH_WEB_URL || "http://127.0.0.1:3080/";

const playwright = resolvePlaywright();
if (playwright === null) {
  console.error("playwright-core not found (see shared.mjs header).");
  process.exit(1);
}
const { chromium } = playwright;
const EXE = findChromium();

let failures = 0;
const verdict = (ok, name, detail) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail !== undefined ? " — " + detail : ""}`);
  if (!ok) failures++;
};

async function boot(browser, stored) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.text().includes("dsh-skin-glass")) console.log("[page]", m.text()); });
  await page.route("**/plugins/dsh-skin-glass/client.js*", (route) => {
    route.fulfill({ status: 200, contentType: "application/javascript", body: BUNDLE });
  });
  await page.goto(WEB_URL, { waitUntil: "domcontentloaded" });
  await page.evaluate((value) => localStorage.setItem("dsh-skin-glass:v1", JSON.stringify(value)), stored);
  await page.reload({ waitUntil: "domcontentloaded" });
  return page;
}

const probe = () => {
  const cs = getComputedStyle(document.body);
  const before = getComputedStyle(document.body, "::before");
  const dark = document.documentElement.matches("[data-ds-dark-theme], [data-theme=dark]") ||
    (getComputedStyle(document.body).getPropertyValue("--dsw-alias-bg-base") || "").includes("18");
  return {
    gated: document.documentElement.hasAttribute("data-dsh-glass"),
    imageVar: cs.getPropertyValue("--dsh-glass-image").trim(),
    backdropImage: before.backgroundImage,
    nSurface: document.querySelectorAll("[data-dsh-glass-surface]").length,
    nSheet: document.querySelectorAll("[data-dsh-glass-sheet]").length,
    dark
  };
};

const browser = await chromium.launch(EXE ? { executablePath: EXE, headless: true } : { headless: true });

try {
  /* 1 — no image: gradient fallback is automatic */
  console.log("\n=== no image (gradient fallback) ===");
  const g = await boot(browser, { image: "", blur: 18 });
  await g.waitForSelector("html[data-dsh-glass]", { timeout: 20000 });
  await g.waitForTimeout(2500);
  const state = await g.evaluate(probe);
  console.log("  state:", JSON.stringify(state));
  verdict(state.gated, "chrome gated without an image");
  verdict(state.imageVar.startsWith("radial-gradient("), "body resolves --dsh-glass-image to the mesh gradient",
    `imageVar=${state.imageVar.slice(0, 64)}…`);
  verdict(!state.imageVar.includes("none"), "the gradient token is not falling back to none");
  verdict(state.backdropImage.includes("linear-gradient") && state.backdropImage.includes("radial-gradient"),
    "body::before paints scrim gradient + wallpaper gradient", `backdrop=${state.backdropImage.slice(0, 96)}…`);
  verdict(state.nSheet > 0, "in-flow sheets are tagged by the detector", `sheets=${state.nSheet}`);
  if (SHOT_DIR) await g.screenshot({ path: `${SHOT_DIR}/gradient-on.png` });
  await g.context().close();

  /* 2 — image wins */
  console.log("\n=== image set ===");
  const i = await boot(browser, { image: SEED_DATA_URL, blur: 18 });
  await i.waitForSelector("html[data-dsh-glass]", { timeout: 20000 });
  await i.waitForTimeout(2500);
  const img = await i.evaluate(probe);
  console.log("  state:", JSON.stringify({ ...img, imageVar: img.imageVar.slice(0, 48) + "…" }));
  verdict(img.gated, "chrome gated with an image");
  verdict(img.imageVar.startsWith("url(\"data:image"), "image URL drives the wallpaper layer", `imageVar=${img.imageVar.slice(0, 48)}…`);
  verdict(!img.imageVar.includes("radial-gradient"), "the gradient token does not leak into the image mode");
  if (SHOT_DIR) await i.screenshot({ path: `${SHOT_DIR}/image-on.png` });
  await i.context().close();
} finally {
  await browser.close();
}

console.log(failures === 0 ? "\nALL GRADIENT-FALLBACK CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
