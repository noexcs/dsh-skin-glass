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
import { createRequire } from "node:module";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// the real colour module — no hand-written stub whose constants can drift
const require = createRequire(import.meta.url);
const realGlassColor = require(join(root, "src", "color.cjs"));

/* ── stubbed browser ──────────────────────────────────────────────── */

let computedOf = () => ({ backgroundColor: "rgb(0, 0, 0)", position: "static" });

/**
 * Attribute-selector `querySelectorAll` over the fake tree. The real one is
 * how `stripTags` finds what to clean up, so stubbing it to `[]` would make
 * every teardown assertion vacuously pass.
 */
function queryAll(selector) {
  const attrs = selector.split(",").map((s) => s.trim().replace(/^\[|\]$/g, ""));
  const out = [];
  const walk = (el) => {
    if (el === null) return;
    if (attrs.some((a) => el.hasAttribute(a))) out.push(el);
    for (const c of el.children) walk(c);
  };
  walk(sandbox.document.body);
  return out;
}

const sandbox = {
  require: (name) => {
    if (name === "react") return { createElement: () => null, useRef: () => ({}) };
    if (name === "@deepseek-ai/dsh-client-runtime/client") return { defineStore: (d) => d };
    throw new Error("unexpected require: " + name);
  },
  glassColor: realGlassColor,
  CSS: { supports: (prop, value) => prop === "backdrop-filter" && value.startsWith("url(") },
  getComputedStyle: (el) => computedOf(el),
  innerWidth: 1440,
  innerHeight: 900,
  document: { querySelectorAll: (s) => queryAll(s), body: null },
  requestIdleCallback: (fn) => fn(),
  MutationObserver: function () {},
  matchMedia: null,
  console
};

const source = readFileSync(join(root, "src/main.js"), "utf8");
const factory = new Function(
  ...Object.keys(sandbox),
  "exports", "module",
  `${source}\n;return { tagSurface, createSurfaceScanner, alphaOf: glassColor.alphaOf, GLASS_CSS, REFRACT_OK, SURFACE_ATTR, SHEET_ATTR, MERGE_ATTR, TINT_ATTR, scaleNestedTint };`
);
const api = factory(...Object.values(sandbox), {}, { exports: {} });

/* ── fake elements ────────────────────────────────────────────────── */

function makeEl({ bg = "rgba(0, 0, 0, 0)", w = 240, h = 120, position = "static", inlineBg = "", children = [], color = "", hovercardVar = "" } = {}) {
  const attrs = new Map();
  // `computed` is what getComputedStyle reports; `style` is the inline
  // declaration — conflating them would hide the "never clobber an inline
  // background the product set" rule
  const inline = {
    backgroundColor: inlineBg,
    color: "",
    setProperty(k, v) {
      if (k === "background-color") inline.backgroundColor = v;
      if (k === "color") inline.color = v;
    },
    removeProperty(k) {
      if (k === "background-color") inline.backgroundColor = "";
      if (k === "color") inline.color = "";
    }
  };
  const el = {
    nodeType: 1,
    isConnected: true,
    children,
    parentElement: null,
    computed: null,
    getBoundingClientRect: () => ({ width: w, height: h }),
    setAttribute: (k, v) => attrs.set(k, v),
    removeAttribute: (k) => attrs.delete(k),
    hasAttribute: (k) => attrs.has(k),
    getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
    querySelectorAll: () => [],
    style: inline
  };
  el.computed = {
    backgroundColor: bg,
    position,
    color,
    getPropertyValue: (k) => (k === "--dsw-hovercard-bg" ? hovercardVar : "")
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

const { tagSurface, createSurfaceScanner, alphaOf, GLASS_CSS, SURFACE_ATTR, SHEET_ATTR, MERGE_ATTR, TINT_ATTR } = api;

// the pseudo-glass mechanism must be pinned in the chrome stylesheet: sheets
// get position:relative and the frost rides a ::before, so the sheet itself
// never becomes a containing block for the inline fixed tooltips
check("sheet rule anchors the pseudo", GLASS_CSS.includes("html[data-dsh-glass] [data-dsh-glass-sheet]{position:relative}"), true);
check("sheet frost rides the pseudo", GLASS_CSS.includes("html[data-dsh-glass] [data-dsh-glass-sheet]::before{"), true);
// one refraction filter for every tagged surface — the command palette is
// the reference effect, so there is deliberately no size-based gradation
check("surfaces get the refraction filter",
  GLASS_CSS.includes(`[data-dsh-glass-surface=lg]{${"-webkit-backdrop-filter:url(#dsh-glass-refract)"}`), true);
check("sheets get the refraction filter",
  GLASS_CSS.includes(`[data-dsh-glass-sheet=lg]::before{${"-webkit-backdrop-filter:url(#dsh-glass-refract)"}`), true);
check("no leftover small-tier refraction rule", GLASS_CSS.includes("refract-sm"), false);
check("reduced-transparency kills sheet frost too",
  /@media \(prefers-reduced-transparency: reduce\)\{[\s\S]*\[data-dsh-glass-sheet\]::before\{[^}]*backdrop-filter:none/.test(GLASS_CSS), true);
// the frost value is emitted from one constant; if a refactor ever lets the
// two vendor spellings drift, the -webkit- one silently stops matching Safari
for (const rule of GLASS_CSS.split("\n").filter((l) => l.includes("backdrop-filter:"))) {
  const webkit = /-webkit-backdrop-filter:([^;}]+)/.exec(rule);
  const plain = /[^-]backdrop-filter:([^;}]+)/.exec(rule);
  check(`prefixed and unprefixed frost agree in: ${rule.slice(0, 46)}…`,
    webkit !== null && plain !== null && webkit[1] === plain[1], true);
}

// the conversation hover card declares --dsw-hovercard-bg ON ITSELF, out of
// reach of the body-level token layer; the chrome stylesheet must rebind it
// to the mode-aware glass token or the card stays an opaque black plate
check("hovercard local token is rebound to the glass token",
  GLASS_CSS.includes("html[data-dsh-glass] body > div[class]{--dsw-hovercard-bg:var(--dsh-glass-hovercard-bg) !important}"), true);

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

// out-of-flow overlays (menus, dialogs, popovers) take the real filter
const panel = makeEl({ bg: "rgba(246, 247, 252, 0.72)", w: 800, h: 600, position: "absolute" });
check("overlay is tagged", tagSurface(panel), true);
check("overlay gets refraction", panel.getAttribute(SURFACE_ATTR), "lg");

const chip = makeEl({ bg: "rgba(255, 255, 255, 0.8)", w: 90, h: 30, position: "fixed" });
check("small overlay is tagged", tagSurface(chip), true);
check("small overlay gets the same refraction as the palette", chip.getAttribute(SURFACE_ATTR), "lg");

/* when the engine cannot run url() backdrop filters (Safari, Firefox) the
   marker must withhold the tier values entirely: the url() rules must never
   match there, because an unresolvable url() invalidates the whole
   backdrop-filter value and the base frost rule would die with it */
const plainSandbox = { ...sandbox, CSS: { supports: () => false } };
const plainApi = factory(...Object.values(plainSandbox), {}, { exports: {} });
const nonRefractPanel = makeEl({ bg: "rgba(255, 255, 255, 0.8)", w: 400, h: 300, position: "fixed" });
check("non-Chromium overlay is still tagged", plainApi.tagSurface(nonRefractPanel), true);
check("non-Chromium marker withholds the url tier", nonRefractPanel.getAttribute(SURFACE_ATTR), "plain");

// in-flow sheets (columns, cards, rows) get the sheet marker: the frost
// rides a ::before pseudo, so hover tooltips inside them are never
// re-anchored
const sheet = makeEl({ bg: "rgba(255, 255, 255, 0.72)", w: 800, h: 600 });
check("in-flow sheet is marked", tagSurface(sheet), true);
check("in-flow sheet carries the sheet marker", sheet.getAttribute(SHEET_ATTR), "lg");
check("in-flow sheet gets no direct backdrop marker", sheet.hasAttribute(SURFACE_ATTR), false);

/* ── regression: panels inside an overlay shell keep the real filter ──
   The settings dialog is a transparent fixed shell (skipped as viewport-
   filling) whose mask is absolute and whose panel is position:relative.
   The panel's backdrop is app content, so it must take the direct filter —
   a sheet pseudo would be buried under the overlay's mask and the frost
   would vanish (the reported "settings panel lost its glass" regression). */

const settingsPanel = makeEl({ bg: "rgba(246, 247, 252, 0.85)", w: 800, h: 800 });
const settingsShell = makeEl({ bg: "rgba(0, 0, 0, 0)", w: 1440, h: 900, position: "fixed", children: [settingsPanel] });
check("panel inside an overlay shell is tagged", tagSurface(settingsPanel), true);
check("panel inside an overlay shell takes the real filter", settingsPanel.getAttribute(SURFACE_ATTR), "lg");

// an element inside an already-marked region still gets its own sheet
// pseudo — every component gets the palette treatment (the census gap:
// bubbles, the composer, cards and buttons inside the conversation column
// used to be tint-only)
const nested = makeEl({ bg: "rgba(255, 255, 255, 0.7)", w: 200, h: 100 });
const markedShell = makeEl({ bg: "rgba(0, 0, 0, 0)", w: 400, h: 300, children: [nested] });
markedShell.setAttribute(SHEET_ATTR, "lg");
check("element inside a marked region is tagged as a nested sheet", tagSurface(nested), true);
check("nested surface carries the sheet marker", nested.getAttribute(SHEET_ATTR), "lg");
check("nested surface gets no direct filter marker", nested.hasAttribute(SURFACE_ATTR), false);

// a viewport-filling surface has only the (already blurred) wallpaper behind
// it, so it must be skipped — but its children still need visiting
const appRoot = makeEl({ bg: "rgba(255, 255, 255, 0.4)", w: 1440, h: 900 });
check("viewport-sized surface is skipped", tagSurface(appRoot), false);
const fullOverlay = makeEl({ bg: "rgba(255, 255, 255, 0.4)", w: 1440, h: 900, position: "fixed" });
check("viewport-sized overlay is skipped", tagSurface(fullOverlay), false);

/* ── scanner traversal: outermost-only ────────────────────────────── */

const grandchild = makeEl({ bg: "rgba(255, 255, 255, 0.7)", w: 200, h: 100 });
const child = makeEl({ bg: "rgba(255, 255, 255, 0.7)", w: 400, h: 300, children: [grandchild] });
const inert = makeEl({ bg: "rgba(0, 0, 0, 0)", w: 500, h: 400, children: [child] });
const viewport = makeEl({ bg: "rgba(255, 255, 255, 0.4)", w: 1440, h: 900, children: [inert] });

sandbox.document.body = viewport;
const scanner = createSurfaceScanner();
scanner.add(viewport);

check("viewport root not tagged", viewport.hasAttribute(SHEET_ATTR), false);
check("transparent wrapper not tagged", inert.hasAttribute(SHEET_ATTR), false);
check("outermost glass tagged as sheet", child.hasAttribute(SHEET_ATTR), true);
// a repeat of the surface's own colour is merged, not tagged — tagging it
// would re-introduce the opacity compounding the merge rule prevents
check("repeat of the surface colour is merged, not tagged", grandchild.hasAttribute(SHEET_ATTR), false);
check("and carries the merge marker", grandchild.hasAttribute(MERGE_ATTR), true);

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

check("panel itself is the sheet", trajPanel.getAttribute(SHEET_ATTR), "lg");
check("panel itself is never merged away", trajPanel.hasAttribute(MERGE_ATTR), false);
check("child repeating the surface colour is zeroed", repeatMid.hasAttribute(MERGE_ATTR), true);
check("grandchild repeating it is zeroed too", repeatDeep.hasAttribute(MERGE_ATTR), true);
check("a genuinely different nested surface is kept", distinct.hasAttribute(MERGE_ATTR), false);
check(
  "under a different surface, the outer colour is a real layer again",
  sameAsOuterUnderDistinct.hasAttribute(MERGE_ATTR),
  false
);

/* ── regression: in-flow sheets must never re-anchor fixed overlays ───
   backdrop-filter makes an element the containing block for its
   position:fixed descendants. The product renders the settings dialog as a
   `position: fixed; inset: 0` div *inside the sidebar* (no portal), and its
   Tooltip bubbles as inline `position: fixed` spans inside the composer.
   Because sheets carry no filter, neither is re-anchored and nothing is
   stripped on mount — this is the regression that used to make the glass
   vanish on every hover. */

const dialog = makeEl({ bg: "rgba(246, 247, 252, 0.72)", w: 800, h: 600 });
const overlay = makeEl({ bg: "rgba(0, 0, 0, 0)", w: 1440, h: 900, position: "fixed", children: [dialog] });
const sidebarInner = makeEl({ bg: "rgba(0, 0, 0, 0)", w: 280, h: 800 });
const sidebar = makeEl({ bg: "rgba(245, 247, 253, 0.24)", w: 280, h: 900, children: [sidebarInner] });
const shell = makeEl({ bg: "rgba(0, 0, 0, 0)", w: 1440, h: 900, children: [sidebar] });

sandbox.document.body = shell;
const scanner2 = createSurfaceScanner();
scanner2.add(shell);
check("sidebar is marked as a sheet", sidebar.hasAttribute(SHEET_ATTR), true);

// the settings dialog mounts inside the sheet, as React would insert it
sidebarInner.children.push(overlay);
overlay.parentElement = sidebarInner;
scanner2.repairFixed(overlay);
check("sheet keeps its marker while the fixed overlay is open", sidebar.hasAttribute(SHEET_ATTR), true);

// a rescan while the dialog is open changes nothing either
scanner2.retag();
check("sheet marker survives a retag with the dialog open", sidebar.hasAttribute(SHEET_ATTR), true);

// and closing the dialog is a no-op: nothing was suspended
sidebarInner.children.length = 0;
overlay.isConnected = false;
dialog.isConnected = false;
scanner2.checkReleases();
check("sheet marker intact after the dialog closes", sidebar.hasAttribute(SHEET_ATTR), true);

// the idle pass alone must also leave the sheet alone
const dialog2 = makeEl({ bg: "rgba(246, 247, 252, 0.72)", w: 800, h: 600 });
const overlay2 = makeEl({ bg: "rgba(0, 0, 0, 0)", w: 1440, h: 900, position: "fixed", children: [dialog2] });
const sidebar2 = makeEl({ bg: "rgba(245, 247, 253, 0.24)", w: 280, h: 900, children: [overlay2] });
const shell2 = makeEl({ bg: "rgba(0, 0, 0, 0)", w: 1440, h: 900, children: [sidebar2] });
sandbox.document.body = shell2;
const scanner3 = createSurfaceScanner();
scanner3.add(shell2);
check("idle scan leaves the fixed element's sheet ancestor marked", sidebar2.hasAttribute(SHEET_ATTR), true);

/* ── regression: suspension now only strips real glass, and restores it
   exactly. A fixed element inside a glass *overlay* (the only ancestor that
   can re-anchor it) suspends that overlay; when the element unmounts, the
   overlay gets its exact marker value back — no re-walk, no state drift. */

const bubble = makeEl({ bg: "rgba(0, 0, 0, 0)", w: 60, h: 20, position: "fixed" });
const menu = makeEl({ bg: "rgba(255, 255, 255, 0.8)", w: 400, h: 300, position: "absolute" });
const menuShell = makeEl({ bg: "rgba(0, 0, 0, 0)", w: 1440, h: 900, children: [menu] });
sandbox.document.body = menuShell;
const scanner8 = createSurfaceScanner();
scanner8.add(menuShell);
check("overlay is glass before the fixed child is seen", menu.getAttribute(SURFACE_ATTR), "lg");

// the fixed child mounts inside the overlay
menu.children.push(bubble);
bubble.parentElement = menu;
scanner8.repairFixed(bubble);
check("fixed child suspends the overlay's glass", menu.hasAttribute(SURFACE_ATTR), false);

// while suspended, a rescan must not put it back
scanner8.retag();
check("suspended overlay stays un-glassed while the child is mounted", menu.hasAttribute(SURFACE_ATTR), false);

menu.children.length = 0;
bubble.isConnected = false;
scanner8.checkReleases();
check("overlay regains its exact marker once the child unmounts", menu.getAttribute(SURFACE_ATTR), "lg");

/* ── regression: the settings dialog keeps frost AND tint ─────────────
   The dialog's panel sits inside the sidebar's sheet region but under a
   transparent fixed shell: it must take the real filter (its backdrop is
   the mask/app content) and its fill must be tinted like any nested fill
   inside glass — otherwise it compounds toward opacity and the frost is
   buried (the reported "settings panel lost its glass" regression). */

const dlgPanel = makeEl({ bg: "rgba(246, 247, 252, 0.85)", w: 800, h: 800 });
const dlgShell = makeEl({ bg: "rgba(0, 0, 0, 0)", w: 1440, h: 900, position: "fixed", children: [dlgPanel] });
const sideInner = makeEl({ bg: "rgba(0, 0, 0, 0)", w: 280, h: 800, children: [dlgShell] });
const sideSheet = makeEl({ bg: "rgba(245, 247, 253, 0.24)", w: 280, h: 900, children: [sideInner] });
const sideShell = makeEl({ bg: "rgba(0, 0, 0, 0)", w: 1440, h: 900, children: [sideSheet] });
sandbox.document.body = sideShell;
const scanner9 = createSurfaceScanner();
scanner9.setTintScale(0.5);
scanner9.add(sideShell);
check("dialog panel takes the real filter", dlgPanel.getAttribute(SURFACE_ATTR), "lg");
check("dialog panel fill is tinted inside the glass region", dlgPanel.getAttribute(TINT_ATTR), "rgba(246, 247, 252, 0.85)");
check("dialog panel alpha is scaled", dlgPanel.style.backgroundColor, "rgba(246, 247, 252, 0.55)");

// a retag while the dialog is open must keep the panel's frost and tint
scanner9.retag();
check("retag with the dialog open keeps the panel's filter", dlgPanel.getAttribute(SURFACE_ATTR), "lg");
check("retag with the dialog open keeps the panel's tint", dlgPanel.style.backgroundColor, "rgba(246, 247, 252, 0.55)");

/* ── regression: panels inside a body-level modal shell are normalized ──
   The Full-access confirm dialog mounts in its own portal root at body
   level: no marked glass ancestor within the scan bound, so the old walk
   left its fill at the full token alpha (0.85) while a palette mounted
   inside the sidebar sheet was scaled to 0.58 — the two panels read
   differently. Crossing an unmarked out-of-flow shell now starts a tint
   context, so the dialog's fill is normalized like a nested fill's and both
   surfaces read the same translucency. */

const modalPanel = makeEl({ bg: "rgba(246, 247, 252, 0.85)", w: 442, h: 272 });
const modalShell = makeEl({ bg: "rgba(0, 0, 0, 0)", w: 1440, h: 900, position: "fixed", children: [modalPanel] });
sandbox.document.body = modalShell;
const scanner13 = createSurfaceScanner();
scanner13.setTintScale(0.3);
scanner13.add(modalShell);
check("modal panel takes the real filter", modalPanel.getAttribute(SURFACE_ATTR), "lg");
check("modal panel fill is normalized, floored for legibility", modalPanel.style.backgroundColor, "rgba(246, 247, 252, 0.55)");
check("modal panel remembers its original colour", modalPanel.getAttribute(TINT_ATTR), "rgba(246, 247, 252, 0.85)");

// a retag while the dialog is open must keep both the filter and the tint
scanner13.retag();
check("retag keeps the modal panel's filter", modalPanel.getAttribute(SURFACE_ATTR), "lg");
check("retag keeps the modal panel's tint", modalPanel.style.backgroundColor, "rgba(246, 247, 252, 0.55)");

/* a body-level portaled menu (the session/workspace dropdowns) mounts as a
   direct fixed child: the shell crossing is the tagged surface itself, and
   it must be normalized just the same */
const portaledMenu = makeEl({ bg: "rgba(255, 255, 255, 0.85)", w: 218, h: 130, position: "fixed" });
sandbox.document.body = portaledMenu;
const scanner14 = createSurfaceScanner();
scanner14.setTintScale(0.3);
scanner14.add(portaledMenu);
check("a portaled menu is normalized too", portaledMenu.style.backgroundColor, "rgba(255, 255, 255, 0.55)");

/* ── regression: popups are frosted before their first paint ─────────
   The idle pass can land after a popup's first frame, and a surface that
   paints once flat and once frosted is the "glass appears after the popup"
   flash. scanNow runs the same walk synchronously the moment the mutation
   observer sees an out-of-flow mount; FIFO order tags the surface panels
   (first levels of a portal root) before their deep content, and in-flow
   mounts abort after the probe budget, leaving the idle pass in charge. */

const popRow = makeEl({ bg: "rgba(80, 90, 120, 0.8)", w: 180, h: 40 });
const popPanel = makeEl({ bg: "rgba(255, 255, 255, 0.85)", w: 220, h: 200, position: "fixed", children: [popRow] });
const popRoot = makeEl({ bg: "rgba(0, 0, 0, 0)", w: 220, h: 200, children: [popPanel] });
sandbox.document.body = popRoot;
const scanner15 = createSurfaceScanner();
scanner15.setTintScale(0.3);
scanner15.scanNow(popRoot);
check("sync scan tags the popup panel pre-paint", popPanel.getAttribute(SURFACE_ATTR), "lg");
check("sync scan normalizes the popup's nested fills pre-paint", popRow.style.backgroundColor, "rgba(80, 90, 120, 0.24)");
check("sync scan leaves the popup's panel tint at the float floor", popPanel.style.backgroundColor, "rgba(255, 255, 255, 0.55)");

// the settings dialog mounts as an inline fixed shell inside the sidebar;
// the sync pass must tag its panel exactly like the idle pass does
const syncDlgPanel = makeEl({ bg: "rgba(246, 247, 252, 0.85)", w: 800, h: 800 });
const syncDlgShell = makeEl({ bg: "rgba(0, 0, 0, 0)", w: 1440, h: 900, position: "fixed", children: [syncDlgPanel] });
sandbox.document.body = syncDlgShell;
const scanner16 = createSurfaceScanner();
scanner16.setTintScale(0.5);
scanner16.scanNow(syncDlgShell);
check("sync scan tags the dialog panel behind a transparent fixed shell", syncDlgPanel.getAttribute(SURFACE_ATTR), "lg");
check("sync scan tints the dialog panel like the idle pass", syncDlgPanel.style.backgroundColor, "rgba(246, 247, 252, 0.55)");

// an in-flow mount (streamed markdown) must not be dragged into the sync
// path: the probe budget runs out before deep content, and the idle pass
// finishes the job
const deepPanel = makeEl({ bg: "rgba(255, 255, 255, 0.7)", w: 400, h: 300 });
let deepRoot = deepPanel;
for (let d = 0; d < 60; d++) {
  deepRoot = makeEl({ bg: "rgba(0, 0, 0, 0)", w: 400, h: 300, children: [deepRoot] });
}
sandbox.document.body = deepRoot;
const scanner17 = createSurfaceScanner();
scanner17.scanNow(deepRoot);
check("sync probe does not reach deep in-flow content", deepPanel.hasAttribute(SHEET_ATTR), false);
scanner17.add(deepRoot);
check("idle pass finishes the deep in-flow surface", deepPanel.hasAttribute(SHEET_ATTR), true);

/* ── regression: theme switch re-tints without stripping ─────────────
   The theme runtime rewrites every token as body inline styles. The old
   retag stripped ALL markers first and rebuilt in idle slices: the frost
   vanished the instant the strip ran and crept back over several frames —
   the reported theme-switch "glass appears out of nothing" flash. The soft
   retag keeps every marker (frost continuous, atomic for the first painted
   frame) and only rewrites inline tints from the freshly computed colours. */

const swRow = makeEl({ bg: "rgba(80, 90, 120, 0.8)", w: 380, h: 60 });
const swPanel = makeEl({ bg: "rgba(255, 255, 255, 0.7)", w: 420, h: 700, children: [swRow] });
const swShell = makeEl({ bg: "rgba(0, 0, 0, 0)", w: 1440, h: 900, children: [swPanel] });
sandbox.document.body = swShell;
const scanner18 = createSurfaceScanner();
scanner18.setTintScale(0.3);
scanner18.add(swShell);
check("switch fixture: panel is a sheet", swPanel.hasAttribute(SHEET_ATTR), true);
check("switch fixture: row is tinted", swRow.style.backgroundColor, "rgba(80, 90, 120, 0.24)");
// the theme runtime rewrites the tokens: same structure, new colours
swPanel.computed.backgroundColor = "rgba(26, 33, 56, 0.7)";
swRow.computed.backgroundColor = "rgba(30, 40, 70, 0.8)";
scanner18.retag();
check("theme switch keeps the sheet marker", swPanel.hasAttribute(SHEET_ATTR), true);
check("theme switch re-tints the row from the new token colour", swRow.style.backgroundColor, "rgba(30, 40, 70, 0.24)");
check("theme switch records the row's new original colour", swRow.getAttribute(TINT_ATTR), "rgba(30, 40, 70, 0.8)");

// merges survive a theme switch: the pair paints one token, so it is still
// a same-colour pair under the new tokens — the zeroing must not blink.
// (The fake computed style does not apply the merge rule's transparent
// background, so the test updates it the way a real engine would.)
const swRepeat = makeEl({ bg: SURFACE_BG, w: 300, h: 100 });
const swTraj = makeEl({ bg: SURFACE_BG, w: 420, h: 800, children: [swRepeat] });
const swTrajShell = makeEl({ bg: "rgba(0, 0, 0, 0)", w: 1440, h: 900, children: [swTraj] });
sandbox.document.body = swTrajShell;
const scanner19 = createSurfaceScanner();
scanner19.add(swTrajShell);
check("switch fixture: repeat is zeroed", swRepeat.hasAttribute(MERGE_ATTR), true);
swTraj.computed.backgroundColor = "rgba(20, 24, 40, 0.6)";
swRepeat.computed.backgroundColor = "rgba(0, 0, 0, 0)";   // merge rule paints transparent
scanner19.retag();
check("theme switch keeps the repeat zeroed", swRepeat.hasAttribute(MERGE_ATTR), true);
check("theme switch does not tint a merged repeat", swRepeat.hasAttribute(TINT_ATTR), false);

// first activation: no markers exist yet, so retag degrades to a full
// incremental scan instead of the soft re-tint
const freshPanel = makeEl({ bg: "rgba(255, 255, 255, 0.7)", w: 420, h: 700 });
const freshShell = makeEl({ bg: "rgba(0, 0, 0, 0)", w: 1440, h: 900, children: [freshPanel] });
sandbox.document.body = freshShell;
const scanner20 = createSurfaceScanner();
scanner20.setTintScale(0.3);
scanner20.retag();
check("first-activation retag tags surfaces", freshPanel.hasAttribute(SHEET_ATTR), true);

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
// a nested fill with its own colour (a bubble inside the conversation sheet)
// is a nested sheet now — every component gets the palette treatment
check("nested fill with its own colour is tagged as a nested sheet", row.getAttribute(SHEET_ATTR), "lg");
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

/* ── regression: the hover card's hardcoded text palette is rebound ───
   The product's HoverCard paints its background from the locally-declared
   --dsw-hovercard-bg (rebound by the chrome stylesheet) but hardcodes its
   row text as light-on-dark (#fff / #cfd3d6 / #adb2b8). Once the card is a
   glass surface, that palette must be rebound to the per-mode hovercard
   tokens so light mode reads like the rename dialog's ink/grey text and dark
   mode resolves to the exact hardcoded values. The rebinding may only fire
   for the element that actually *paints* its background from the variable —
   other portaled overlays merely inherit it and must be left alone. */

const hcTitle = makeEl({ bg: "rgba(0, 0, 0, 0)", w: 200, h: 20, color: "rgb(255, 255, 255)" });
const hcTime = makeEl({ bg: "rgba(0, 0, 0, 0)", w: 200, h: 16, color: "rgb(207, 211, 214)" });
const hcStatus = makeEl({ bg: "rgba(0, 0, 0, 0)", w: 200, h: 20, color: "rgb(173, 178, 184)" });
const hoverCard = makeEl({ bg: "rgba(246, 247, 252, 0.852)", w: 244, h: 96, position: "fixed", hovercardVar: "rgba(246, 247, 252, 0.852)", children: [hcTitle, hcTime, hcStatus] });
const hcShell = makeEl({ bg: "rgba(0, 0, 0, 0)", w: 1440, h: 900, children: [hoverCard] });

sandbox.document.body = hcShell;
const scanner10 = createSurfaceScanner();
scanner10.add(hcShell);
check("hover card is tagged as a surface", hoverCard.getAttribute(SURFACE_ATTR), "lg");
check("hardcoded white title is rebound to the title token", hcTitle.style.color, "var(--dsh-glass-hovercard-title)");
check("hardcoded grey time is rebound to the meta token", hcTime.style.color, "var(--dsh-glass-hovercard-meta)");
check("hardcoded grey status is rebound to the caption token", hcStatus.style.color, "var(--dsh-glass-hovercard-caption)");

// a fixed overlay that merely inherits the variable must not be treated
const otherTitle = makeEl({ bg: "rgba(0, 0, 0, 0)", w: 200, h: 20, color: "rgb(255, 255, 255)" });
const otherCard = makeEl({ bg: "rgba(246, 247, 252, 0.852)", w: 244, h: 96, position: "fixed", children: [otherTitle] });
const otherShell = makeEl({ bg: "rgba(0, 0, 0, 0)", w: 1440, h: 900, children: [otherCard] });
sandbox.document.body = otherShell;
const scanner11 = createSurfaceScanner();
scanner11.add(otherShell);
check("an overlay not painted from the variable is tagged but untouched", otherCard.getAttribute(SURFACE_ATTR), "lg");
check("its hardcoded text colour is left alone", otherTitle.style.color, "");

/* ── teardown must leave no trace ─────────────────────────────────────
   Everything the skin writes onto product elements is an inline style whose
   value only means something while the skin is loaded: a scaled rgba() the
   product never chose, and a `var(--dsh-glass-*)` colour that resolves to
   *nothing* once the token layer is disposed (unstyled text). So stop() has
   to clear the inline styles, not just the marker attributes. */

const downRow = makeEl({ bg: ROW_BG, w: 380, h: 60 });
const downTitle = makeEl({ bg: "rgba(0, 0, 0, 0)", w: 200, h: 20, color: "rgb(255, 255, 255)" });
const downCard = makeEl({
  bg: "rgba(246, 247, 252, 0.852)", w: 244, h: 96, position: "fixed",
  hovercardVar: "rgba(246, 247, 252, 0.852)", children: [downTitle]
});
const downPanel = makeEl({ bg: "rgba(255, 255, 255, 0.7)", w: 420, h: 700, children: [downRow] });
const downShell = makeEl({ bg: "rgba(0, 0, 0, 0)", w: 1440, h: 900, children: [downPanel, downCard] });

sandbox.document.body = downShell;
const scanner12 = createSurfaceScanner();
scanner12.setTintScale(0.3);
scanner12.add(downShell);
check("teardown fixture: panel is a sheet", downPanel.hasAttribute(SHEET_ATTR), true);
check("teardown fixture: row is tinted", downRow.style.backgroundColor, "rgba(80, 90, 120, 0.24)");
check("teardown fixture: card ink is rebound", downTitle.style.color, "var(--dsh-glass-hovercard-title)");
// the portaled card is normalized like every other float now
check("teardown fixture: card fill is normalized", downCard.style.backgroundColor, "rgba(246, 247, 252, 0.55)");

scanner12.stop();
check("stop() clears the sheet marker", downPanel.hasAttribute(SHEET_ATTR), false);
check("stop() clears the surface marker", downCard.hasAttribute(SURFACE_ATTR), false);
check("stop() restores the row's own background", downRow.style.backgroundColor, "");
check("stop() clears the tint marker", downRow.hasAttribute(TINT_ATTR), false);
check("stop() restores the card's own background", downCard.style.backgroundColor, "");
check("stop() clears the card's tint marker", downCard.hasAttribute(TINT_ATTR), false);
// the regression this pins: the var() would resolve to nothing after the
// token layer is disposed, leaving the hover card's text unstyled
check("stop() restores the hover card's own ink", downTitle.style.color, "");

/* ── report ───────────────────────────────────────────────────────── */

console.log(`${ran} surface-detector assertions`);
if (failures.length > 0) {
  console.error(`\nFAIL (${failures.length}):`);
  for (const f of failures) console.error("  " + f);
  process.exit(1);
}
console.log("PASS — detector classifies surfaces and never nests backdrop-filters");
