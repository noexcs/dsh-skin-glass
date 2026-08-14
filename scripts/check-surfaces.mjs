/* dsh-skin-glass — scripts/check-surfaces.mjs
 * Unit tests for the runtime glass-surface detector in src/main.js.
 *
 * The detector decides, per element, whether it is a glass surface — get it
 * wrong and the skin either misses components or stacks nested
 * backdrop-filters until the UI turns to mud. It is also the one piece that
 * cannot be checked by reading the token table, so it gets a real harness:
 * src/main.js is evaluated against a stubbed DOM and its internals are
 * exercised directly.
 *
 * Run: node scripts/check-surfaces.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/* ── stubbed browser ──────────────────────────────────────────────── */

let computedOf = () => ({ backgroundColor: "rgb(0, 0, 0)", position: "static" });


const sandbox = {
  require: (name) => {
    if (name === "react") return { createElement: () => null, useRef: () => ({}) };
    if (name === "@deepseek-ai/dsh-client-runtime/client") return { defineStore: (d) => d };
    throw new Error("unexpected require: " + name);
  },
  glassColor: {},
  CSS: { supports: (prop, value) => prop === "backdrop-filter" && value.startsWith("url(") },
  getComputedStyle: (el) => computedOf(el),
  innerWidth: 1440,
  innerHeight: 900,
  document: { querySelectorAll: () => [], body: null },
  requestIdleCallback: (fn) => fn(),
  MutationObserver: function () {},
  matchMedia: null,
  console
};

const source = readFileSync(join(root, "src/main.js"), "utf8");
const factory = new Function(
  ...Object.keys(sandbox),
  "exports", "module",
  `${source}\n;return { tagSurface, createSurfaceScanner, alphaOf, GLASS_CSS, REFRACT_OK, SURFACE_ATTR, MERGE_ATTR, TINT_ATTR, scaleNestedTint };`
);
const api = factory(...Object.values(sandbox), {}, { exports: {} });

/* ── fake elements ────────────────────────────────────────────────── */

function makeEl({ bg = "rgba(0, 0, 0, 0)", w = 240, h = 120, position = "static", inlineBg = "", children = [] } = {}) {
  const attrs = new Map();
  // `computed` is what getComputedStyle reports; `style` is the inline
  // declaration — conflating them would hide the "never clobber an inline
  // background the product set" rule
  const inline = {
    backgroundColor: inlineBg,
    setProperty(k, v) { if (k === "background-color") inline.backgroundColor = v; },
    removeProperty(k) { if (k === "background-color") inline.backgroundColor = ""; }
  };
  const el = {
    nodeType: 1,
    isConnected: true,
    children,
    parentElement: null,
    computed: { backgroundColor: bg, position },
    getBoundingClientRect: () => ({ width: w, height: h }),
    setAttribute: (k, v) => attrs.set(k, v),
    removeAttribute: (k) => attrs.delete(k),
    hasAttribute: (k) => attrs.has(k),
    getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
    querySelectorAll: () => [],
    style: inline
  };
  for (const c of children) c.parentElement = el;
  return el;
}

computedOf = (el) => el.computed;

/* ── assertions ───────────────────────────────────────────────────── */

const failures = [];
let ran = 0;

function check(name, actual, expected) {
  ran += 1;
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) failures.push(`${name}: expected ${e}, got ${a}`);
}

const { tagSurface, createSurfaceScanner, alphaOf, SURFACE_ATTR, MERGE_ATTR, TINT_ATTR } = api;

// alpha parsing
check("alphaOf rgb() is opaque", alphaOf("rgb(1, 2, 3)"), 1);
check("alphaOf rgba()", alphaOf("rgba(1, 2, 3, 0.72)"), 0.72);
check("alphaOf fully transparent", alphaOf("rgba(0, 0, 0, 0)"), 0);

// classification
const opaque = makeEl({ bg: "rgb(20, 20, 20)" });
check("opaque surface is not glass", tagSurface(opaque), false);

const hoverTint = makeEl({ bg: "rgba(99, 102, 241, 0.1)" });
check("hover tint is not a surface", tagSurface(hoverTint), false);

const tiny = makeEl({ bg: "rgba(255, 255, 255, 0.8)", w: 20, h: 12 });
check("tiny element is not a surface", tagSurface(tiny), false);

const panel = makeEl({ bg: "rgba(246, 247, 252, 0.72)", w: 800, h: 600 });
check("dialog is tagged", tagSurface(panel), true);
check("dialog gets refraction", panel.getAttribute(SURFACE_ATTR), "lg");

const chip = makeEl({ bg: "rgba(255, 255, 255, 0.8)", w: 90, h: 30 });
check("small surface is tagged", tagSurface(chip), true);
check("small surface skips refraction", chip.getAttribute(SURFACE_ATTR), "sm");

// a viewport-filling surface has only the (already blurred) wallpaper behind
// it, so it must be skipped — but its children still need visiting
const appRoot = makeEl({ bg: "rgba(255, 255, 255, 0.4)", w: 1440, h: 900 });
check("viewport-sized surface is skipped", tagSurface(appRoot), false);

/* ── scanner traversal: outermost-only ────────────────────────────── */

const grandchild = makeEl({ bg: "rgba(255, 255, 255, 0.7)", w: 200, h: 100 });
const child = makeEl({ bg: "rgba(255, 255, 255, 0.7)", w: 400, h: 300, children: [grandchild] });
const inert = makeEl({ bg: "rgba(0, 0, 0, 0)", w: 500, h: 400, children: [child] });
const viewport = makeEl({ bg: "rgba(255, 255, 255, 0.4)", w: 1440, h: 900, children: [inert] });

sandbox.document.body = viewport;
const scanner = createSurfaceScanner();
scanner.add(viewport);

check("viewport root not tagged", viewport.hasAttribute(SURFACE_ATTR), false);
check("transparent wrapper not tagged", inert.hasAttribute(SURFACE_ATTR), false);
check("outermost glass tagged", child.hasAttribute(SURFACE_ATTR), true);
check("nested glass NOT tagged (no stacked backdrop-filters)", grandchild.hasAttribute(SURFACE_ATTR), false);

/* ── stacked repeats of the surface colour must be zeroed ─────────────
   The trajectory panel is `bg-layer-1` with several `bg-layer-1` children
   nested inside it. Opaque-over-opaque is invisible; translucent-over-
   translucent compounds until the panel reads as solid. */

const SURFACE_BG = "rgba(255, 255, 255, 0.81)";
const OTHER_BG = "rgba(20, 24, 40, 0.6)";

const repeatDeep = makeEl({ bg: SURFACE_BG, w: 300, h: 100 });
const repeatMid = makeEl({ bg: SURFACE_BG, w: 340, h: 200, children: [repeatDeep] });
const distinct = makeEl({ bg: OTHER_BG, w: 320, h: 120 });
const sameAsOuterUnderDistinct = makeEl({ bg: SURFACE_BG, w: 300, h: 90 });
distinct.children.push(sameAsOuterUnderDistinct);
sameAsOuterUnderDistinct.parentElement = distinct;
const trajPanel = makeEl({ bg: SURFACE_BG, w: 420, h: 800, children: [repeatMid, distinct] });
const trajShell = makeEl({ bg: "rgba(0, 0, 0, 0)", w: 1440, h: 900, children: [trajPanel] });

sandbox.document.body = trajShell;
const scanner4 = createSurfaceScanner();
scanner4.add(trajShell);

check("panel itself is the glass surface", trajPanel.getAttribute(SURFACE_ATTR), "lg");
check("panel itself is never merged away", trajPanel.hasAttribute(MERGE_ATTR), false);
check("child repeating the surface colour is zeroed", repeatMid.hasAttribute(MERGE_ATTR), true);
check("grandchild repeating it is zeroed too", repeatDeep.hasAttribute(MERGE_ATTR), true);
check("a genuinely different nested surface is kept", distinct.hasAttribute(MERGE_ATTR), false);
check(
  "under a different surface, the outer colour is a real layer again",
  sameAsOuterUnderDistinct.hasAttribute(MERGE_ATTR),
  false
);

/* ── regression: fixed-position overlays must escape the containing block ───
   backdrop-filter makes an element the containing block for its
   position:fixed descendants. The product renders the settings dialog as a
   `position: fixed; inset: 0` div *inside the sidebar* (no portal), so glass
   on the sidebar collapsed the dialog to the sidebar's width. */

const dialog = makeEl({ bg: "rgba(246, 247, 252, 0.72)", w: 800, h: 600 });
const overlay = makeEl({ bg: "rgba(0, 0, 0, 0)", w: 1440, h: 900, position: "fixed", children: [dialog] });
const sidebarInner = makeEl({ bg: "rgba(0, 0, 0, 0)", w: 280, h: 800 });
const sidebar = makeEl({ bg: "rgba(245, 247, 253, 0.24)", w: 280, h: 900, children: [sidebarInner] });
const shell = makeEl({ bg: "rgba(0, 0, 0, 0)", w: 1440, h: 900, children: [sidebar] });

sandbox.document.body = shell;
const scanner2 = createSurfaceScanner();
scanner2.add(shell);
check("sidebar is glass before any modal opens", sidebar.hasAttribute(SURFACE_ATTR), true);

// now the dialog mounts inside the (glass) sidebar, as React would insert it
sidebarInner.children.push(overlay);
overlay.parentElement = sidebarInner;
scanner2.repairFixed(overlay);
check("sidebar loses glass so the fixed overlay keeps the viewport", sidebar.hasAttribute(SURFACE_ATTR), false);

// a rescan while the dialog is still open must not put it back
scanner2.retag();
check("suspended ancestor stays un-glassed while the dialog is open", sidebar.hasAttribute(SURFACE_ATTR), false);
check("dialog inside the freed subtree is still glass", dialog.hasAttribute(SURFACE_ATTR), true);

// ...and closing the dialog must give it back. Suspending permanently was a
// real regression: the sidebar stayed flat for the rest of the session after
// settings had been opened once.
sidebarInner.children.length = 0;
overlay.isConnected = false;
dialog.isConnected = false;
scanner2.checkReleases();
check("sidebar regains glass once the dialog closes", sidebar.hasAttribute(SURFACE_ATTR), true);

// and it must survive a reopen/close cycle
sidebarInner.children.push(overlay);
overlay.isConnected = true;
scanner2.repairFixed(overlay);
check("reopening suspends it again", sidebar.hasAttribute(SURFACE_ATTR), false);
sidebarInner.children.length = 0;
overlay.isConnected = false;
scanner2.checkReleases();
check("closing a second time restores it again", sidebar.hasAttribute(SURFACE_ATTR), true);

// the idle pass alone must also catch it, without the synchronous fast path
const dialog2 = makeEl({ bg: "rgba(246, 247, 252, 0.72)", w: 800, h: 600 });
const overlay2 = makeEl({ bg: "rgba(0, 0, 0, 0)", w: 1440, h: 900, position: "fixed", children: [dialog2] });
const sidebar2 = makeEl({ bg: "rgba(245, 247, 253, 0.24)", w: 280, h: 900, children: [overlay2] });
const shell2 = makeEl({ bg: "rgba(0, 0, 0, 0)", w: 1440, h: 900, children: [sidebar2] });
sandbox.document.body = shell2;
const scanner3 = createSurfaceScanner();
scanner3.add(shell2);
check("idle scan alone un-glasses the fixed element's ancestor", sidebar2.hasAttribute(SURFACE_ATTR), false);

/* ── nested fills are tinted, not stacked ─────────────────────────────
   A fill designed for an opaque plate only tints it. Over glass it tints AND
   adds opacity, so a panel whose rows each carry a fill (trajectory) goes
   solid. The detector rescales those alphas. */

const ROW_BG = "rgba(80, 90, 120, 0.8)";
const tintPanel = makeEl({ bg: "rgba(255, 255, 255, 0.7)", w: 420, h: 700 });
const row = makeEl({ bg: ROW_BG, w: 380, h: 60 });
tintPanel.children.push(row);
row.parentElement = tintPanel;
const tintShell = makeEl({ bg: "rgba(0, 0, 0, 0)", w: 1440, h: 900, children: [tintPanel] });

sandbox.document.body = tintShell;
const scanner5 = createSurfaceScanner();
scanner5.setTintScale(0.3);
scanner5.add(tintShell);

check("nested fill is recorded with its original colour", row.getAttribute(TINT_ATTR), ROW_BG);
check("nested fill alpha is scaled", row.style.backgroundColor, "rgba(80, 90, 120, 0.24)");
check("the surface itself is never tinted", tintPanel.hasAttribute(TINT_ATTR), false);

// rescanning must not compound: the element now reports its scaled colour
row.computed.backgroundColor = row.style.backgroundColor;
scanner5.add(tintShell);
check("rescan does not compound the scaling", row.style.backgroundColor, "rgba(80, 90, 120, 0.24)");

// a background the product set inline is not ours to rewrite
const ownInline = makeEl({ bg: "rgba(10, 20, 30, 0.8)", inlineBg: "rgba(1, 2, 3, 0.5)", w: 300, h: 80 });
const inlinePanel = makeEl({ bg: "rgba(255, 255, 255, 0.7)", w: 420, h: 700, children: [ownInline] });
const inlineShell = makeEl({ bg: "rgba(0, 0, 0, 0)", w: 1440, h: 900, children: [inlinePanel] });
sandbox.document.body = inlineShell;
const scanner6 = createSurfaceScanner();
scanner6.setTintScale(0.3);
scanner6.add(inlineShell);
check("a product-set inline background is left alone", ownInline.style.backgroundColor, "rgba(1, 2, 3, 0.5)");
check("and is not marked as ours", ownInline.hasAttribute(TINT_ATTR), false);

// at translucency 0 the scale is 1 and nothing should be rewritten
const plainRow = makeEl({ bg: ROW_BG, w: 380, h: 60 });
const plainPanel = makeEl({ bg: "rgba(255, 255, 255, 0.96)", w: 420, h: 700, children: [plainRow] });
const plainShell = makeEl({ bg: "rgba(0, 0, 0, 0)", w: 1440, h: 900, children: [plainPanel] });
sandbox.document.body = plainShell;
const scanner7 = createSurfaceScanner();
scanner7.setTintScale(1);
scanner7.add(plainShell);
check("scale of 1 leaves nested fills untouched", plainRow.hasAttribute(TINT_ATTR), false);

/* ── report ───────────────────────────────────────────────────────── */

console.log(`${ran} surface-detector assertions`);
if (failures.length > 0) {
  console.error(`\nFAIL (${failures.length}):`);
  for (const f of failures) console.error("  " + f);
  process.exit(1);
}
console.log("PASS — detector classifies surfaces and never nests backdrop-filters");
