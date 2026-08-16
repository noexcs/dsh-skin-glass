/* dsh-skin-glass — scripts/qa/probe-panels.mjs
 * Diagnostic: for every floating panel currently on screen, report whether the
 * skin treated it as glass and — when it did not — which of the detector's
 * tests it failed.
 *
 * This answers "why does the command palette look different from that dialog":
 * the palette and the dialog go through the same detector, so any visual
 * difference is one of a small number of decisions (marker kind, tier, the
 * token the surface paints from). The probe drives the REAL classifier via
 * window.__dshGlass (exported by the bundle) — no hand copy to drift.
 *
 * Usage — drive the UI with a step script, dumping after each step:
 *   node scripts/qa/probe-panels.mjs --steps '[{"key":"Meta+k"}]'
 *   node scripts/qa/probe-panels.mjs --steps '[{"click":"Full access"},{"wait":800}]'
 * Steps: {"click":"text"} {"clickAll":"text"} {"key":"Meta+k"} {"wait":ms}
 *        {"hover":"text"}
 *
 * Dependencies: see verify-glass.mjs (playwright-core, chromium headless shell).
 */
import { resolvePlaywright, findChromium, newGlassPage } from "./shared.mjs";

const ARGS = {};
for (let i = 2; i < process.argv.length; i++) {
  const k = process.argv[i];
  if (k.startsWith("--")) ARGS[k.slice(2)] = process.argv[++i];
}
const STEPS = ARGS.steps ? JSON.parse(ARGS.steps) : [];

const playwright = resolvePlaywright();
if (playwright === null) {
  console.error("playwright-core not found — see verify-glass.mjs header.");
  process.exit(1);
}
const { chromium } = playwright;
const EXE = findChromium();

/* ── in-page probe ─────────────────────────────────────────────────── */

function probe() {
  const G = window.__dshGlass;
  if (!G) {
    return [{ cls: "(no __dshGlass handle)", why: "the loaded bundle predates the debug export — rebuild lib/client.js" }];
  }

  // every --dsw-*/--dsh-* the skin pushed onto body, so a panel's fill can be
  // traced back to the token it consumes
  const tokens = [];
  const bodyStyle = document.body.style;
  for (let i = 0; i < bodyStyle.length; i++) {
    const name = bodyStyle[i];
    if (!name.startsWith("--")) continue;
    tokens.push([name, bodyStyle.getPropertyValue(name).trim()]);
  }
  const norm = (c) => c.replace(/\s+/g, "").replace(/rgba?\(/, "(");
  const tokenOf = (color) => {
    const t = norm(color);
    const hits = tokens.filter(([, v]) => norm(v) === t).map(([n]) => n);
    return hits.length ? hits.join(",") : null;
  };

  // candidates: anything out-of-flow and visible, plus anything already marked
  const out = [];
  for (const el of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const marked = el.hasAttribute(G.SURFACE_ATTR) || el.hasAttribute(G.SHEET_ATTR);
    if (!G.isOutOfFlow(cs) && !marked) continue;

    const decision = G.decideSurface(el, cs);
    const surface = el.getAttribute(G.SURFACE_ATTR);
    const sheet = el.getAttribute(G.SHEET_ATTR);
    const actual = surface ? `surface=${surface}` : sheet ? `sheet=${sheet}` : null;

    // why is the element not tagged the way the classifier would have it?
    let why = null;
    if (decision === null) {
      const a = G.alphaOf(cs.backgroundColor);
      if (a < G.SURFACE_MIN_ALPHA) why = `bg alpha ${a} < ${G.SURFACE_MIN_ALPHA} (reads as a hover tint, not a surface)`;
      else if (a > G.SURFACE_MAX_ALPHA) why = `bg alpha ${a} > ${G.SURFACE_MAX_ALPHA} (OPAQUE — token not overridden by the skin?)`;
      else if (r.width < G.SURFACE_MIN_W || r.height < G.SURFACE_MIN_H) why = `too small ${Math.round(r.width)}x${Math.round(r.height)}`;
      else if (r.width >= innerWidth * 0.92 && r.height >= innerHeight * 0.92) why = "viewport-filling (skipped by design)";
      else why = "unknown";
    } else if (actual === null) {
      // the classifier would tag it but the walk has not: a fill repeating
      // the parent surface colour is merged instead of tagged
      why = "classifier says glass, but not tagged (merge rule or scanner pending)";
    } else if (decision.kind === "sheet" && surface !== null) {
      why = `classified as sheet, but carries a direct surface marker`;
    }

    out.push({
      cls: String(el.className).slice(0, 34) || el.tagName,
      pos: cs.position,
      box: `${Math.round(r.width)}x${Math.round(r.height)}`,
      area: Math.round(r.width * r.height),
      bg: cs.backgroundColor,
      a: Math.round(G.alphaOf(cs.backgroundColor) * 1000) / 1000,
      token: tokenOf(cs.backgroundColor),
      mark: actual,
      tier: decision ? `${decision.kind}/${decision.tier}` : null,
      bf: cs.backdropFilter === "none" ? null : cs.backdropFilter.slice(0, 46),
      bfBefore: (() => {
        const v = getComputedStyle(el, "::before").backdropFilter;
        return v && v !== "none" ? v.slice(0, 46) : null;
      })(),
      tint: el.hasAttribute(G.TINT_ATTR) || undefined,
      merge: el.hasAttribute(G.MERGE_ATTR) || undefined,
      why
    });
  }
  // biggest first: the panel under discussion is usually the largest new box
  return out.sort((x, y) => y.area - x.area).slice(0, 22);
}

function fmt(rows) {
  const lines = [];
  for (const r of rows) {
    lines.push(
      `  ${(r.mark || "—").padEnd(13)} ${r.pos.padEnd(8)} ${r.box.padEnd(11)} a=${String(r.a).padEnd(6)} ` +
      `${(r.token || "(no skin token)").slice(0, 42).padEnd(42)} ${r.cls}`
    );
    if (r.why) lines.push(`      ↳ NOT GLASS: ${r.why}`);
    if (r.mark && !r.bf && !r.bfBefore) lines.push("      ↳ marked but NO filter resolved (?)");
    if (r.bf) lines.push(`      ↳ filter: ${r.bf}`);
    if (r.bfBefore) lines.push(`      ↳ ::before filter: ${r.bfBefore}`);
    if (r.tint) lines.push("      ↳ fill alpha scaled down (nested tint)");
  }
  return lines.join("\n");
}

/* ── drive ─────────────────────────────────────────────────────────── */

const browser = await chromium.launch(EXE ? { executablePath: EXE, headless: true } : { headless: true });
const page = await newGlassPage(browser, { settleMs: 2500 });

console.log("=== baseline ===");
console.log(fmt(await page.evaluate(probe)));

/** Click/hover the smallest element whose own text or aria-label matches, so
 *  a container never swallows the hit. With `inOverlay`, only elements inside
 *  a currently-open out-of-flow panel are considered — that is how a menu item
 *  is told apart from the trigger that shares its label. The panel is found
 *  structurally (position + stacking), not by product class name. */
async function byText(text, action, inOverlay) {
  const pt = await page.evaluate(({ text, inOverlay }) => {
    const overlays = Array.from(document.querySelectorAll("body *")).filter((el) => {
      const cs = getComputedStyle(el);
      if (cs.position !== "absolute" && cs.position !== "fixed") return false;
      const r = el.getBoundingClientRect();
      return r.width > 80 && r.height > 40 && cs.visibility !== "hidden";
    });
    const inAnyOverlay = (el) => overlays.some((o) => o !== el && o.contains(el));
    const hits = Array.from(document.querySelectorAll("button, [role=button], [role=menuitem], [role=option], [role=switch], a, li, div, span"))
      .filter((el) => {
        const label = el.getAttribute("aria-label") || "";
        const t = (el.textContent || "").trim();
        const byLabel = label.includes(text);
        const byBody = t.includes(text) && t.length <= text.length + 40;
        if (!byLabel && !byBody) return false;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        return inOverlay ? inAnyOverlay(el) : true;
      })
      .sort((a, b) => {
        const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
        return ra.width * ra.height - rb.width * rb.height;
      });
    const el = hits[0];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), cls: String(el.className).slice(0, 30), n: hits.length };
  }, { text, inOverlay: !!inOverlay });
  if (!pt) { console.log(`  !! no element matching ${JSON.stringify(text)}`); return false; }
  console.log(`  -> ${action} ${JSON.stringify(text)} at ${pt.x},${pt.y} (${pt.n} candidates, <${pt.cls}>)`);
  if (action === "hover") await page.mouse.move(pt.x, pt.y);
  else await page.mouse.click(pt.x, pt.y);
  return true;
}

for (const [i, step] of STEPS.entries()) {
  console.log(`\n=== step ${i + 1}: ${JSON.stringify(step)} ===`);
  if (step.wait) await page.waitForTimeout(step.wait);
  if (step.session) {
    // open the first session row so the composer (and its controls) exist
    const pt = await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll("[aria-label^='会话']")).map((e) => e.closest("li,div")).find(Boolean);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x + 60), y: Math.round(r.y + r.height / 2) };
    });
    if (pt) { await page.mouse.click(pt.x, pt.y); await page.waitForTimeout(3500); }
    // park the pointer away from the rows: a lingering pointer mounts the
    // session hover card and poisons later overlay dumps
    await page.mouse.move(1320, 700);
    console.log(`  -> opened session at ${JSON.stringify(pt)}`);
  }
  if (step.key) await page.keyboard.press(step.key);
  if (step.click) await byText(step.click, "click", step.inOverlay);
  if (step.jsClick) {
    // el.click() with no mouse: a mouse move would mount the session hover
    // card first and swallow the click. "a||b" matches labels containing
    // BOTH substrings, so 会话||的操作 can't be confused with 新建会话.
    const n = await page.evaluate(({ text, inOverlay }) => {
      const needs = text.split("||");
      const overlays = Array.from(document.querySelectorAll("body *")).filter((el) => {
        const cs = getComputedStyle(el);
        if (cs.position !== "absolute" && cs.position !== "fixed") return false;
        const r = el.getBoundingClientRect();
        return r.width > 80 && r.height > 40 && cs.visibility !== "hidden";
      });
      const inAny = (el) => overlays.some((o) => o !== el && o.contains(el));
      const hits = Array.from(document.querySelectorAll("button, [role=button], [role=menuitem], [role=option], a, li, div"))
        .filter((el) => {
          const label = el.getAttribute("aria-label") || "";
          const t = (el.textContent || "").trim();
          const byLabel = needs.every((s) => label.includes(s));
          const byBody = needs.every((s) => t.includes(s)) && t.length <= 60;
          if (!byLabel && !byBody) return false;
          // no size check here: session-row action buttons render collapsed
          // (zero rect) until their row is hovered, but el.click() fires them
          return inOverlay ? inAny(el) : true;
        })
        .sort((a, b) => {
          const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
          return ra.width * ra.height - rb.width * rb.height;
        });
      const el = hits[0];
      if (!el) return 0;
      el.click();
      return hits.length;
    }, { text: step.jsClick, inOverlay: !!step.inOverlay });
    console.log(`  -> jsClick ${JSON.stringify(step.jsClick)} (${n} candidates)`);
  }
  if (step.hover) await byText(step.hover, "hover", step.inOverlay);
  if (step.xy) {
    // raw pointer move: some controls (session-row action buttons) only exist
    // while their row is hovered, and rows carry no label of their own
    await page.mouse.move(step.xy[0], step.xy[1]);
    console.log(`  -> move to ${step.xy}`);
  }
  if (step.park) await page.mouse.move(1320, 700);
  await page.waitForTimeout(step.settle || 1200);
  if (step.dump) {
    // every visible out-of-flow panel with its own text, so a trigger for the
    // next step can be found without guessing at menu item wording
    const texts = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll("body *")) {
        const cs = getComputedStyle(el);
        if (cs.position !== "absolute" && cs.position !== "fixed") continue;
        const r = el.getBoundingClientRect();
        if (r.width < 80 || r.height < 40 || cs.visibility === "hidden") continue;
        const t = (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 60);
        if (!t) continue;
        out.push(`${Math.round(r.width)}x${Math.round(r.height)} <${String(el.className).slice(0, 24)}> ${t}`);
      }
      return out.slice(0, 12);
    });
    console.log("  overlays:\n    " + texts.join("\n    "));
  }
  console.log(fmt(await page.evaluate(probe)));
}

if (ARGS.shot) await page.screenshot({ path: ARGS.shot });
await browser.close();
