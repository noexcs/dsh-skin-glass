/* dsh-skin-glass — src/main.js
 * Browser-side plugin body; inlined into lib/client.js by scripts/build.mjs.
 * Runs inside the __ModuleLoader__.load factory: `require`, `exports`,
 * `module`, and the `glassColor` namespace (inlined from src/color.js) are
 * in scope.
 */

const React = require("react");
const { defineStore } = require("@deepseek-ai/dsh-client-runtime/client");

const GLASS_NS = "dsh-skin-glass";
const MAX_DIM = 1920;
const SAMPLE_DIM = 64;

/** Defaults for the persisted state; also the fallbacks for partial records. */
const DEFAULT_BLUR = 18;
const DEFAULT_TRANSLUCENCY = 0.45;

/* ── chrome stylesheet: image layer + scrim ───────────────────────────
   The blur lives on the wallpaper layer, not on a backdrop-filter over the
   app root: #root's backdrop *is* only the wallpaper (body is transparent,
   body::before sits at z-index -1), so blurring the image directly is
   visually equivalent, costs one static filter instead of a full-viewport
   recompute per frame, and — the reason it matters — also covers the popovers
   the product renders through `createPortal(…, document.body)`, which are
   siblings of #root and could never inherit a blur applied inside it.

   Surfaces come in two kinds (see tagSurface):
   - overlays — position fixed/absolute: menus, dialogs, portalled popovers —
     sit over *app content* and take the backdrop-filter directly; in-flow
     panels nested inside an overlay shell (the settings dialog) do too,
     because a pseudo frost would be buried under the overlay's mask;
   - top-level in-flow sheets — columns, cards, rows — only ever show the
     wallpaper, so their frost lives on a `::before` pseudo (see GLASS_CSS).
     A filter on a pseudo leaves the sheet itself a plain containing block,
     which is what fixes the hover bug: the product's Tooltip bubble is a
     `position: fixed` span rendered *inline*, and a backdrop-filter on any
     real ancestor makes that ancestor the bubble's containing block — so
     every hover used to strip the glass from the whole column. The painted
     result is unchanged, and the sheet marker still feeds the nested-fill
     normalization (merge/tint), which is what keeps the trajectory view
     from compounding to opaque.

   The scrim flattens the wallpaper's luminance under everything, which is
   what lets the see-through tier open up without costing text contrast. It
   arrives as a theme token, so it follows the light/dark switch on its own.
   Depth behind modals is restored through --dsw-mask-blur, which the
   product's own `.mask` elements already consume.

   Everything is gated on html[data-dsh-glass] so that with no background
   image the skin contributes nothing at all. */

/**
 * Refraction filter. Chromium is the only engine that accepts `url(#…)` in
 * `backdrop-filter` — Safari and Firefox restrict it to the built-in filter
 * functions so they can keep the effect on the GPU — so this is strictly a
 * progressive enhancement, feature-detected at {@link REFRACT_OK}.
 *
 * A turbulence-driven displacement (rather than the edge-concentrated map a
 * hand-tuned "liquid glass" component would use) is what works here: the map
 * has to be independent of element size, because it is applied to whatever
 * surfaces the detector happens to find.
 */
const REFRACT_ID = "dsh-glass-refract";

/**
 * Turbulence-driven displacement filter. The map must be independent of
 * element size — it is applied to whatever surfaces the detector finds —
 * and there is deliberately ONE strength: every tagged surface gets the
 * palette's look (the command palette was the reference effect), so no
 * size-based gradation. The 18px displacement reads as glass thickness on
 * a large pane; on a small menu it warps the same absolute pixels, which
 * the user prefers over a visibly weaker effect.
 */
const FILTER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0">` +
  `<filter id="${REFRACT_ID}" x="-15%" y="-15%" width="130%" height="130%" color-interpolation-filters="sRGB">` +
  `<feTurbulence type="fractalNoise" baseFrequency="0.006 0.010" numOctaves="2" seed="11" result="warp"/>` +
  `<feGaussianBlur in="warp" stdDeviation="6" result="softWarp"/>` +
  `<feDisplacementMap in="SourceGraphic" in2="softWarp" scale="18" xChannelSelector="R" yChannelSelector="G"/>` +
  `</filter></svg>`;

const REFRACT_OK = typeof CSS !== "undefined" && typeof CSS.supports === "function" &&
  CSS.supports("backdrop-filter", `url(#${REFRACT_ID})`);

/**
 * The frost itself. One value, many declarations (unprefixed + `-webkit-`,
 * across the overlay rule, the sheet pseudo, both refraction tiers and the
 * reduced-transparency reset), so it is spelled once here and emitted
 * through {@link backdrop}.
 */
const FROST = "blur(var(--dsh-surface-blur, 14px)) saturate(1.9) brightness(1.04)";
const backdrop = (value) => `-webkit-backdrop-filter:${value};backdrop-filter:${value}`;

const GLASS_TAG_ID = "dsh-skin-glass/chrome.css";
const GLASS_CSS = [
  "/* dsh-skin-glass: background layer + frosted surfaces */",
  "html[data-dsh-glass]{background:#0b0e17}",
  "html[data-dsh-glass] body{background:transparent !important}",
  "html[data-dsh-glass] body::before{content:'';position:fixed;z-index:-1;pointer-events:none;",
  // grow the layer past the viewport so the blur cannot pull transparent
  // pixels in at the edges and leave a dark vignette
  "inset:calc(-2 * var(--dsh-glass-blur, 18px));",
  "background-image:linear-gradient(var(--dsh-glass-scrim, transparent), var(--dsh-glass-scrim, transparent)), var(--dsh-glass-image, none);",
  "background-size:cover;background-position:center;background-repeat:no-repeat;",
  "filter:blur(var(--dsh-glass-blur, 18px)) saturate(1.2)}",
  // out-of-flow overlays sit over *app content*: their own backdrop is what
  // makes a dialog show the content behind it instead of only tinting the
  // wallpaper
  `html[data-dsh-glass] [data-dsh-glass-surface]{${backdrop(FROST)}}`,
  // in-flow sheets (columns, cards, rows) frost the wallpaper through a
  // ::before pseudo: visually identical to a filter on the sheet itself, but
  // the sheet never becomes the containing block for the inline-rendered
  // `position: fixed` tooltip bubbles inside it (the hover-vanishing bug).
  // `position: relative` anchors the pseudo's inset:0 to the sheet — it only
  // affects *absolute* descendants, never fixed ones.
  "html[data-dsh-glass] [data-dsh-glass-sheet]{position:relative}",
  "html[data-dsh-glass] [data-dsh-glass-sheet]::before{content:'';position:absolute;inset:0;z-index:-1;pointer-events:none;border-radius:inherit;" +
    `${backdrop(FROST)}}`,
  // The conversation/workspace hover card (HoverCard primitive, portaled to
  // document.body) declares --dsw-hovercard-bg: #2C2C2E ON ITSELF — a local
  // custom property the body-level token override can never reach, which is
  // why the card stayed an opaque near-black plate. It is rebound here to a
  // mode-aware token: light follows the dialog-surface material (the
  // rename/settings panels), dark keeps the always-dark tooltip plate. The
  // translucent alpha also lets the surface detector tag the card and give it
  // the backdrop frost (the specular rim already rides in through
  // --dsw-shadow-lv3), and the detector then rebinds the card's hardcoded
  // text palette to the per-mode hovercard tokens (see treatHovercardText). The property
  // has no other consumer in the product, so the broad structural selector is
  // inert everywhere else; the !important pins the value even if the card's
  // own rule gains specificity in a later build.
  "html[data-dsh-glass] body > div[class]{--dsw-hovercard-bg:var(--dsh-glass-hovercard-bg) !important}",
  // descendants repainting their surface's own colour: harmless when that
  // colour is opaque, but with translucency they compound into a solid block
  // (see MERGE_ATTR)
  "html[data-dsh-glass] [data-dsh-glass-merge]{background-color:transparent}",
  // refraction, Chromium only. Every tagged surface gets the same filter;
  // when the engine cannot do url() backdrop filters the detector marks
  // surfaces "plain" instead, so these rules never match there and the base
  // frost rule above still applies — important because an unresolvable
  // url() would invalidate the whole backdrop-filter value, not just the
  // one function
  `html[data-dsh-glass] [data-dsh-glass-surface=lg]{${backdrop(`url(#${REFRACT_ID}) ${FROST}`)}}`,
  `html[data-dsh-glass] [data-dsh-glass-sheet=lg]::before{${backdrop(`url(#${REFRACT_ID}) ${FROST}`)}}`,
  // honour the OS "reduce transparency" setting (translucency is also forced
  // to its most legible end from JS, which can reach the token layer)
  "@media (prefers-reduced-transparency: reduce){",
  "html[data-dsh-glass] [data-dsh-glass-surface],",
  `html[data-dsh-glass] [data-dsh-glass-sheet]::before{${backdrop("none")}}}`
].join("\n");

function ensureChromeTag() {
  if (typeof document === "undefined") return;
  if (document.querySelector("style[data-plugin-css=" + JSON.stringify(GLASS_TAG_ID) + "]") !== null) return;
  const tag = document.createElement("style");
  tag.dataset.plugin = "dsh-skin-glass";
  tag.dataset.pluginCss = GLASS_TAG_ID;
  tag.textContent = GLASS_CSS;
  document.head.appendChild(tag);
}

/** Host for the refraction filter; kept out of layout and out of the a11y tree. */
function ensureFilterHost() {
  if (!REFRACT_OK || document.getElementById("dsh-glass-filters") !== null) return;
  const host = document.createElement("div");
  host.id = "dsh-glass-filters";
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = "position:fixed;width:0;height:0;overflow:hidden;pointer-events:none";
  host.innerHTML = FILTER_SVG;
  document.body.appendChild(host);
}

/* ── glass surface detection ──────────────────────────────────────────
   Which elements are glass cannot be answered with a selector list. The
   product's class names are content-hashed per build (`VOzbGW_panel`,
   `_wrap_1ao1y_1`), and a scan of its stylesheets turns up ~80 names for the
   surface tokens — most of them generic (`root`, `row`, `body`, `header`,
   `card`), so substring selectors would both over-match and stack nested
   backdrop-filters.

   So the question is asked of the rendered result instead: an element whose
   *computed* background-color is translucent is a glass surface, whichever
   class it happens to carry this build. Every surface gets the palette
   treatment, nested or not — the only exception is a fill that *repeats the
   parent surface's own colour*, which is merged instead of tagged (tagging
   it would re-introduce the opacity compounding the merge rule exists to
   prevent). Descent always continues, because a fixed-position overlay
   nested inside glass is exactly what has to be found (see
   unglassAncestors).

   The marker comes in two kinds (see tagSurface): overlays (fixed/absolute,
   and in-flow panels nested inside an overlay shell) get
   `data-dsh-glass-surface`, which carries the backdrop-filter directly;
   in-flow sheets (columns, cards, rows — top-level *or nested inside
   another sheet*) get `data-dsh-glass-sheet`, whose frost lives on a
   `::before` pseudo instead — the sheet itself never becomes a containing
   block, so a hover tooltip (an inline-rendered `position: fixed` bubble)
   is neither re-anchored nor triggers any glass stripping on mount. Both
   markers feed the nested-fill normalization (merge/tint). */

const SURFACE_ATTR = "data-dsh-glass-surface";
/**
 * Marks a *top-level in-flow* surface (columns, cards, rows). Its frost
 * lives on a `::before` pseudo (see GLASS_CSS), so the sheet itself never
 * becomes the containing block for the inline-rendered `position: fixed`
 * tooltip bubbles inside it — hovering a button used to strip the glass
 * from the whole column. The marker still counts as glass for the
 * merge/tint normalization.
 */
const SHEET_ATTR = "data-dsh-glass-sheet";
/**
 * Marks a descendant that repaints its surface's own colour. The trajectory
 * panel is the clearest case: `details` is `bg-layer-1`, and `split`,
 * `table`, `assistantOutput`, `schema`, `overviewHeading` and `promptDiff`
 * inside it are `bg-layer-1` again. Painting a colour over itself is a no-op
 * while that colour is opaque — which is why the product can write it freely
 * — but once the token is translucent each repeat compounds: four layers at
 * α 0.81 composite to 99.9% opaque, and the panel stops being glass.
 *
 * Zeroing those repeats restores what the opaque theme already looked like.
 * Only an *exact* colour match qualifies; a genuinely different surface
 * nested inside (a code block in a panel) was visible before and stays.
 */
const MERGE_ATTR = "data-dsh-glass-merge";
/**
 * Marks a descendant whose background alpha the skin has scaled down, and
 * holds its original computed colour so a rescan compares against the real
 * value instead of the already-scaled one (and cannot scale it twice).
 */
const TINT_ATTR = "data-dsh-glass-tint";
/**
 * Marks a node whose hardcoded text colour the skin has rebound to a
 * hovercard token (see {@link treatHovercardText}). The value is an inline
 * `var()`, which resolves to nothing once the token layer is disposed, so
 * teardown has to be able to find these again.
 */
const INK_ATTR = "data-dsh-glass-ink";
/** Everything the skin writes onto product elements, for teardown. */
const MARKERS = [SURFACE_ATTR, SHEET_ATTR, MERGE_ATTR, TINT_ATTR, INK_ATTR];
const MARKER_SELECTOR = MARKERS.map((attr) => `[${attr}]`).join(", ");
/** Below this the fill is a hover tint, not a surface; above it, it is opaque. */
const SURFACE_MIN_ALPHA = 0.2;
const SURFACE_MAX_ALPHA = 0.995;
const SURFACE_MIN_W = 44;
const SURFACE_MIN_H = 24;
/** Elements processed per idle slice, so a long conversation cannot stall. */
const SCAN_BUDGET = 2500;

/* Computed-colour parsing lives in src/color.cjs — referenced through
   `glassColor` (never a top-level alias) because the bundle inlines
   color.cjs into the same scope as this file. */

/**
 * Repaint a fill at a fraction of its alpha, so it tints the glass instead
 * of thickening it. Written as an inline style because the value is
 * per-element; the original colour rides along in the attribute so the next
 * pass can tell "already scaled" from "needs scaling".
 * @param floor - the scaled alpha may not drop below this; nested fills pass
 *   0 (the stack under them already carries the floor), a float's own fill
 *   passes {@link glassColor.floatTintFloor} so its text stays legible.
 */
function scaleNestedTint(el, bg, scale, floor) {
  if (scale >= 1) return;
  if (el.hasAttribute(TINT_ATTR)) return;      // already ours; never compound
  // a background the product set inline is not ours to rewrite
  if (el.style.backgroundColor !== "") return;
  const parsed = glassColor.parseColor(bg);
  if (parsed === null || parsed.a <= 0 || parsed.a >= 1) return;
  el.setAttribute(TINT_ATTR, bg);
  const scaled = Math.round(Math.max(floor, parsed.a * scale) * 1000) / 1000;
  el.style.setProperty("background-color", `rgba(${parsed.rgb.join(", ")}, ${scaled})`);
}

/** The product's HoverCard declares this locally and paints its background
 *  from it; nothing else in the product consumes it. */
const HOVERCARD_VAR = "--dsw-hovercard-bg";

/** Hardcoded light-on-dark palette of the hover card rows → per-mode tokens
 *  (light = the dialog ink/grey scale, dark = the hardcoded values verbatim,
 *  see buildTokens). */
const HOVERCARD_TEXT_MAP = [
  ["rgb(255, 255, 255)", "var(--dsh-glass-hovercard-title)"],
  ["rgb(207, 211, 214)", "var(--dsh-glass-hovercard-meta)"],
  ["rgb(173, 178, 184)", "var(--dsh-glass-hovercard-caption)"]
];

/**
 * True when the element's own background *is* the resolved
 * `--dsw-hovercard-bg` — the HoverCard is the only consumer of that variable,
 * so this identifies the card across builds without any product class names.
 * Compared as parsed colours, not strings: computed serialization formats are
 * engine-dependent, and computed rgba() rounds the alpha to two decimals
 * while the variable keeps three (0.85 vs 0.852). A classed portaled element
 * that merely *inherits* the variable (menus, dialogs) paints a different
 * background and fails the test.
 */
const round2 = (x) => Math.round(x * 100) / 100;

function paintsHovercardBg(el, cs) {
  const own = glassColor.parseColor(cs.backgroundColor);
  const ref = glassColor.parseColor(cs.getPropertyValue(HOVERCARD_VAR));
  if (own === null || ref === null || ref.a <= 0) return false;
  return round2(own.a) === round2(ref.a) && own.rgb.every((v, i) => v === ref.rgb[i]);
}

/**
 * Rebind the hover card's hardcoded text palette to the per-mode hovercard
 * tokens. Light mode lands on the same ink/grey scale the rename dialog uses
 * on its light surface; dark mode resolves to the exact hardcoded values, so
 * the dark look is unchanged. Values are inline `var()`s, so the light/dark
 * switch is followed with no reapplication; a colour the product set inline
 * is left alone, like the nested-fill rule. Rebound nodes are marked so the
 * teardown path can find them again — the `var()`s resolve to nothing once
 * the token layer is disposed.
 */
function treatHovercardText(card) {
  const walk = (node) => {
    const cs = getComputedStyle(node);
    for (const [from, to] of HOVERCARD_TEXT_MAP) {
      if (cs.color === from && node.style.color === "") {
        node.style.setProperty("color", to);
        node.setAttribute(INK_ATTR, "");
        break;
      }
    }
    for (const child of node.children) walk(child);
  };
  walk(card);
}

/** How many ancestors a bounded upward scan inspects. */
const ANCESTOR_SCAN = 12;

/**
 * Carries a *real* backdrop-filter, and so is a containing block for its
 * `position: fixed` descendants. Sheets are deliberately excluded: their
 * frost rides a `::before` pseudo, which re-anchors nothing.
 */
const isGlassOverlay = (el) => el.hasAttribute(SURFACE_ATTR);
/** Carries either marker, i.e. sits inside a region the skin has claimed. */
const isGlassRegion = (el) => el.hasAttribute(SURFACE_ATTR) || el.hasAttribute(SHEET_ATTR);
/** Out of flow: over app content rather than on the wallpaper. */
const isOutOfFlow = (cs) => cs.position === "fixed" || cs.position === "absolute";

/**
 * Walk up at most `limit` ancestors looking for one that satisfies `hit`.
 * Attributes only, never computed style, so this is cheap enough to run for
 * every element the scanner visits.
 */
function hasAncestor(el, limit, hit) {
  let p = el.parentElement;
  for (let i = 0; p !== null && i < limit; i++) {
    if (hit(p)) return true;
    p = p.parentElement;
  }
  return false;
}

/**
 * `backdrop-filter` makes an element the containing block for its
 * `position: fixed` descendants, so a fixed descendant of a glass *overlay*
 * must be freed from it. (In-flow sheets carry no filter, so the product's
 * settings dialog — a fixed `inset: 0` div inside the sidebar — needs no
 * handling any more: its ancestors are sheets and the viewport reference is
 * intact.)
 *
 * Stripping is a snapshot, not a re-walk: each ancestor's exact marker
 * value rides along and the release path restores it verbatim. The old
 * re-walk tagged elements that had never been tagged before (state drift
 * across hover cycles).
 * @returns the stripped ancestors as { ancestor, value }, nearest first.
 */
function unglassAncestors(el) {
  const stripped = [];
  let p = el.parentElement;
  while (p !== null) {
    if (isGlassOverlay(p)) {
      stripped.push({ ancestor: p, value: p.getAttribute(SURFACE_ATTR) });
      p.removeAttribute(SURFACE_ATTR);
    }
    p = p.parentElement;
  }
  return stripped;
}

/**
 * Tag one element if it is a glass surface.
 * @param suspended - elements currently holding a fixed-position overlay,
 *   for which glass is on hold (see {@link unglassAncestors}).
 * @param computed - reuse of the caller's getComputedStyle, when it has one.
 * @returns true when tagged, which tells the caller to stop descending.
 */
/**
 * Classify one element as a glass surface, WITHOUT writing any attribute.
 * Pure so the QA probe (scripts/qa/probe-panels.mjs) can drive the exact
 * same classifier the scanner uses instead of maintaining a hand copy —
 * that copy had already drifted (stale tiering and suppression rules).
 * @returns { kind: "surface" | "sheet", tier: string } | null
 */
function decideSurface(el, cs) {
  const alpha = glassColor.alphaOf(cs.backgroundColor);
  if (!(alpha >= SURFACE_MIN_ALPHA && alpha <= SURFACE_MAX_ALPHA)) return null;
  const rect = el.getBoundingClientRect();
  if (rect.width < SURFACE_MIN_W || rect.height < SURFACE_MIN_H) return null;
  // A surface that fills the viewport has nothing behind it but the wallpaper,
  // which is already blurred — it would pay the largest backdrop cost in the
  // app for no visible gain. Skip it, but keep descending.
  if (rect.width >= innerWidth * 0.92 && rect.height >= innerHeight * 0.92) return null;
  // Every tagged surface refracts with the same filter; "plain" withholds
  // the url() entirely where the engine cannot run it (see REFRACT_OK).
  const tier = REFRACT_OK ? "lg" : "plain";
  // Out-of-flow overlays sit over app content and take the filter directly.
  if (isOutOfFlow(cs)) return { kind: "surface", tier };
  // In-flow element. Every surface gets the palette treatment, nested or
  // not: inside an already-marked glass region it still gets its own sheet
  // pseudo — the pseudo carries the frost, so the outer sheet remains a
  // plain containing block for the inline fixed tooltip bubbles inside it.
  // (The walk only skips tagging for a fill that *repeats the parent
  // surface's own colour* — the merge rule — because tagging those would
  // re-introduce the opacity compounding the merge exists to prevent.)
  // Inside a fixed/absolute overlay wrapper whose own box is transparent
  // (the settings dialog's shell), the backdrop is *app content*, so the
  // element needs the real filter — a pseudo would be buried under the
  // overlay's mask and lose the frost.
  let p = el.parentElement;
  for (let i = 0; p !== null && i < ANCESTOR_SCAN; i++) {
    if (isOutOfFlow(getComputedStyle(p)) && !isGlassRegion(p)) {
      return { kind: "surface", tier };
    }
    p = p.parentElement;
  }
  return { kind: "sheet", tier };
}

/**
 * Tag one element if it is a glass surface: {@link decideSurface} plus the
 * attribute write, gated on the suspension set.
 * @param suspended - elements currently holding a fixed-position overlay,
 *   for which glass is on hold (see {@link unglassAncestors}).
 * @param computed - reuse of the caller's getComputedStyle, when it has one.
 * @returns true when tagged, which tells the caller the element is a surface.
 */
function tagSurface(el, suspended, computed) {
  if (suspended !== undefined && suspended.has(el)) return false;
  const cs = computed !== undefined ? computed : getComputedStyle(el);
  const decision = decideSurface(el, cs);
  if (decision === null) return false;
  el.setAttribute(decision.kind === "surface" ? SURFACE_ATTR : SHEET_ATTR, decision.tier);
  return true;
}

/** Incremental, idle-scheduled scanner over a queue of subtree roots. */
function createSurfaceScanner() {
  /**
   * Entries are { el, inGlass, surfaceColor }: `inGlass` suppresses tagging
   * (not descent), `surfaceColor` is the nearest painted background above,
   * against which repeats are detected.
   */
  let queue = [];
  let scheduled = false;
  let stopped = false;
  /** Current nested-fill alpha scale; see glassColor.nestedTintScale. */
  let tintScale = 1;
  /**
   * Glass put on hold while a fixed-position element is mounted inside a
   * glass *overlay*: { fixed, stripped } records (each stripped entry holds
   * the ancestor's exact marker value) plus a Set of the ancestors for O(1)
   * lookup. In-flow sheets carry no filter and are never suspended.
   */
  let suspensions = [];
  let suspended = new Set();

  /** Suspend glass on every glass ancestor of a newly seen fixed element. */
  const suspend = (fixedEl) => {
    const stripped = unglassAncestors(fixedEl);
    if (stripped.length === 0) return;
    suspensions.push({ fixed: fixedEl, stripped });
    for (const { ancestor } of stripped) suspended.add(ancestor);
  };

  /**
   * Release ancestors whose overlay has unmounted: each ancestor gets its
   * exact marker value back from the suspension snapshot, then a normal
   * re-scan normalizes nested fills added while it was suspended. Called
   * from {@link drain}, so the re-queued ancestors are picked up by the very
   * pass that released them.
   */
  const sweepSuspensions = () => {
    if (suspensions.length === 0) return;
    const kept = [];
    const gone = [];
    const stillHeld = new Set();
    for (const entry of suspensions) {
      if (entry.fixed.isConnected) {
        kept.push(entry);
        for (const { ancestor } of entry.stripped) stillHeld.add(ancestor);
      } else {
        gone.push(entry);
      }
    }
    if (gone.length === 0) return;
    suspensions = kept;
    suspended = stillHeld;
    // an ancestor can appear in several dropped entries; restore it once
    const released = new Set();
    for (const entry of gone) {
      for (const { ancestor, value } of entry.stripped) {
        if (stillHeld.has(ancestor) || released.has(ancestor) || !ancestor.isConnected) continue;
        ancestor.setAttribute(SURFACE_ATTR, value);
        released.add(ancestor);
      }
    }
    for (const ancestor of released) push(ancestor, false, null, false);
  };

  /**
   * Entries are { el, inGlass, surfaceColor, tintCtx }: `inGlass` suppresses
   * tagging (not descent), `surfaceColor` is the nearest painted background
   * above, against which repeats are detected, and `tintCtx` marks a subtree
   * whose fills are normalized by {@link glassColor.nestedTintScale} even
   * though the walk is not inside a marked glass region.
   */
  const push = (el, inGlass, surfaceColor, tintCtx) =>
    queue.push({ el, inGlass, surfaceColor, tintCtx });

  const drain = () => {
    scheduled = false;
    if (stopped) return;
    sweepSuspensions();
    let budget = SCAN_BUDGET;
    while (queue.length > 0 && budget > 0) {
      const entry = queue.pop();
      const el = entry.el;
      let inGlass = entry.inGlass;
      let surfaceColor = entry.surfaceColor;
      let tintCtx = entry.tintCtx === true;
      budget -= 1;
      if (!el.isConnected) continue;
      const cs = getComputedStyle(el);
      if (cs.position === "fixed" && !suspended.has(el)) {
        // only glass *overlays* (data-dsh-glass-surface) carry a filter, so
        // this only ever fires for fixed elements inside them; the release
        // path restores the snapshot verbatim
        suspend(el);
      }
      // An out-of-flow shell that is not itself glass (the settings dialog's
      // transparent fixed wrapper, a body-level portal root) takes its
      // content OFF the sheet's backdrop: reset the glass context so panels
      // inside it get their own marker instead of being suppressed as nested
      // fills — otherwise a retag while the dialog is open would strip the
      // panel's frost for good. It also starts a *tint context*: the panels
      // inside mount over app content rather than wallpaper, and their fill
      // is normalized like a nested fill's, so a dialog's surface reads the
      // same translucency as a palette mounted inside a sheet region instead
      // of keeping its full token alpha (the 0.85-vs-0.58 split the skin
      // used to show).
      if (isOutOfFlow(cs) && !isGlassRegion(el)) {
        inGlass = false;
        surfaceColor = null;
        tintCtx = true;
      }
      // an element we already tinted reports its scaled colour, so recover the
      // original for both the repeat test and what children compare against
      const tinted = el.getAttribute(TINT_ATTR);
      const bg = tinted !== null ? tinted : cs.backgroundColor;
      // a fill that *repeats the parent surface's own colour* is merged
      // rather than tagged: tagging it would re-introduce the opacity
      // compounding the merge rule exists to prevent (the trajectory panel)
      const repeats = inGlass && surfaceColor !== null && bg === surfaceColor;
      // Descent continues past a glass surface even though tagging stops:
      // pruning would be cheaper, but a fixed-position overlay nested inside
      // glass is exactly what has to be found, and pruning would hide it.
      const tagged = !repeats && tagSurface(el, suspended, cs);
      // the hover card paints its background from --dsw-hovercard-bg (its only
      // consumer); once tagged as a glass surface, its hardcoded light-on-dark
      // text palette is rebound to the per-mode hovercard tokens, so light mode
      // matches the rename/settings dialog material and dark mode is unchanged
      if (tagged && isOutOfFlow(cs) && paintsHovercardBg(el, cs)) {
        treatHovercardText(el);
      }
      // A walk that starts outside the glass context (the mutation observer's
      // add()) still tints nested fills when the element sits inside a marked
      // glass region — otherwise a dialog panel mounted inside the sidebar's
      // sheet region would compound to opacity. Bounded like tagSurface's own
      // ancestor scan. The tint context covers the same need for subtrees the
      // walk entered through an unmarked out-of-flow shell.
      const inTintCtx = () => tintCtx || inGlass || hasAncestor(el, ANCESTOR_SCAN, isGlassRegion);
      let childColor = surfaceColor;
      if (tagged) {
        // A float's own fill is scaled toward the nested tint with the float
        // floor (its backdrop is wallpaper/app content); a surface nested
        // inside glass keeps the plain nested scale — the stack under it
        // already carries the legibility floor.
        const floor = inGlass ? 0 : glassColor.floatTintFloor;
        if (inTintCtx()) scaleNestedTint(el, bg, tintScale, floor);
        childColor = bg;
      } else if (repeats) {
        el.setAttribute(MERGE_ATTR, "");   // repeat of the surface's own colour
      } else if (glassColor.alphaOf(bg) > 0) {
        // a new painted layer: tint it rather than let it add opacity, and
        // make it the reference its own children compare against
        if (inTintCtx()) scaleNestedTint(el, bg, tintScale, 0);
        childColor = bg;
      }
      for (const child of el.children) push(child, inGlass || tagged, childColor, tintCtx || tagged);
    }
    if (queue.length > 0) schedule();
  };

  const schedule = () => {
    if (scheduled || stopped) return;
    scheduled = true;
    if (typeof requestIdleCallback === "function") requestIdleCallback(drain, { timeout: 500 });
    else setTimeout(drain, 60);
  };

  /** Remove every marker the skin has written, and the inline styles they own. */
  const stripTags = () => {
    for (const el of document.querySelectorAll(MARKER_SELECTOR)) {
      if (el.hasAttribute(TINT_ATTR)) el.style.removeProperty("background-color");
      if (el.hasAttribute(INK_ATTR)) el.style.removeProperty("color");
      for (const attr of MARKERS) el.removeAttribute(attr);
    }
  };

  return {
    /**
     * Something left the DOM. Closing a dialog produces only removals, which
     * queue no work, so the sweep that gives a suspended overlay its glass
     * back needs its own nudge.
     */
    checkReleases() {
      if (stopped || suspensions.length === 0) return;
      schedule();
    },
    /** Set the nested-fill alpha scale; takes effect on the next retag. */
    setTintScale(value) {
      tintScale = value;
    },
    /** Queue a subtree for tagging. */
    add(root) {
      if (stopped || root.nodeType !== 1) return;
      push(root, false, null, false);
      schedule();
    },
    /**
     * Repair a freshly mounted subtree synchronously. The idle pass would get
     * here eventually, but a modal that renders at the wrong size for even one
     * frame is exactly the bug this guards against, so fixed elements are
     * checked the moment they mount. The cheap attribute walk runs first, so
     * the getComputedStyle cost is only paid inside a glass overlay — which
     * is the only place a filter can re-anchor a fixed descendant.
     */
    repairFixed(node) {
      if (stopped || node.nodeType !== 1 || !hasAncestor(node, Infinity, isGlassOverlay)) return;
      if (getComputedStyle(node).position === "fixed") {
        suspend(node);
        return;
      }
      for (const el of node.children) {
        if (getComputedStyle(el).position !== "fixed") continue;
        suspend(el);
        return;
      }
    },
    /** Drop every tag and start over — token values (and so alphas) changed. */
    retag() {
      if (stopped) return;
      stripTags();
      queue = [];
      push(document.body, false, null, false);
      schedule();
    },
    /** Drop every tag and go idle, without retiring the scanner. */
    clear() {
      queue = [];
      stripTags();
    },
    stop() {
      stopped = true;
      queue = [];
      suspensions = [];
      suspended = new Set();
      stripTags();
    }
  };
}

/* ── image handling ───────────────────────────────────────────────── */

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image decode failed"));
    img.src = src;
  });
}

/**
 * Paint an image source onto a white-flattened w×h canvas and encode it:
 * webp where the engine supports it, JPEG otherwise.
 */
function encodeImage(source, w, h) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext("2d");
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, w, h);
  g.drawImage(source, 0, 0, w, h);
  // An unsupported type is not an error: toDataURL *silently* falls back to
  // PNG, so asking for webp and catching a throw would never fire — and a
  // 1920px PNG is several MB, which is what blows the localStorage quota.
  // Detect by what came back, and fall through to JPEG instead.
  const webp = canvas.toDataURL("image/webp", 0.88);
  return webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/jpeg", 0.88);
}

/** Downscale a picked file to a data URL (max 1920px, alpha flattened). */
async function processImageFile(file) {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    try {
      const scale = Math.min(1, MAX_DIM / Math.max(bitmap.width, bitmap.height));
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));
      const resized = bitmap.width === w && bitmap.height === h
        ? bitmap
        : await createImageBitmap(bitmap, { resizeWidth: w, resizeHeight: h });
      try {
        // explicit w/h on drawImage: even if the engine ignored the resize
        // options, the canvas still downsamples to the exact target size
        return encodeImage(resized, w, h);
      } finally {
        if (resized !== bitmap) resized.close();
      }
    } finally {
      bitmap.close();
    }
  }
  // engines without createImageBitmap: the blob-URL decode path
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    return encodeImage(img, w, h);
  } finally {
    // revoked whether the decode resolved or threw: on the success path the
    // bitmap is already decoded and no longer needs the blob URL
    URL.revokeObjectURL(url);
  }
}

/** Sample the image into a small [r,g,b] array for quantization. */
async function samplePixels(dataUrl) {
  const img = await loadImage(dataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = SAMPLE_DIM;
  canvas.height = SAMPLE_DIM;
  const g = canvas.getContext("2d");
  g.drawImage(img, 0, 0, SAMPLE_DIM, SAMPLE_DIM);
  const data = g.getImageData(0, 0, SAMPLE_DIM, SAMPLE_DIM).data;
  const samples = [];
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    samples.push([data[i], data[i + 1], data[i + 2]]);
  }
  return samples;
}

/**
 * Read the background image once and derive everything the token layer needs
 * from that single sample pass: the accent color and the brightness profile
 * that sizes the scrim.
 * @returns { accent: [r,g,b], wallpaper: { meanL, stdL } }
 */
async function analyzeImage(dataUrl) {
  const samples = await samplePixels(dataUrl);
  const clusters = glassColor.quantize(samples, 6, 10);
  return {
    accent: glassColor.pickAccent(clusters),
    wallpaper: glassColor.analyzeWallpaper(samples)
  };
}

/* ── settings row dictionaries ────────────────────────────────────── */

const zh = {
  "glass.title": "背景图",
  "glass.choose": "选择图片",
  "glass.remove": "移除",
  "glass.blur": "背景模糊",
  "glass.translucency": "通透度",
  "glass.hint": "主题色自动取自背景图；通透度只放开聊天背景与侧边栏，弹窗、菜单、代码块等阅读区域保留可读下限",
  "glass.processing": "正在处理图片…",
  "glass.error.decode": "图片解码失败：请换一张图片（如 JPG/PNG/WebP）",
  "glass.error.write": "保存到浏览器存储失败（图片过大或隐私模式）"
};
const en = {
  "glass.title": "Background",
  "glass.choose": "Choose image",
  "glass.remove": "Remove",
  "glass.blur": "Background blur",
  "glass.translucency": "Translucency",
  "glass.hint": "Theme colors are extracted from the image; translucency only opens up the chat background and sidebar — dialogs, menus and code keep a legibility floor",
  "glass.processing": "Processing image…",
  "glass.error.decode": "Image decode failed: try another image (JPG/PNG/WebP)",
  "glass.error.write": "Failed to persist to browser storage (image too large or private mode)"
};

/* ── settings row store ───────────────────────────────────────────── */

const createRowStore = () => defineStore({
  init: () => ({ ...DEFAULTS, status: "", error: "" }),
  actions: {
    // `stored` is normalized at every entry point (readStored / commit), so
    // the row takes it as-is
    sync: (d, value) => {
      d.image = value.image;
      d.blur = value.blur;
      d.translucency = value.translucency;
    },
    status: (d, message) => {
      d.status = message;
    },
    error: (d, code) => {
      d.error = code;
      d.status = "";
    }
  }
});

/* ── row component ────────────────────────────────────────────────── */

const rowGap = { display: "flex", flexDirection: "column", gap: 8 };
const rowLine = { display: "flex", alignItems: "center", gap: 10 };
const btnStyle = {
  border: "1px solid var(--dsw-alias-border-l2)",
  background: "var(--dsw-alias-bg-layer-1)",
  color: "var(--dsw-alias-label-primary)",
  borderRadius: 8,
  padding: "4px 12px",
  fontSize: 13,
  cursor: "pointer"
};
const thumbStyle = {
  width: 40,
  height: 40,
  borderRadius: 8,
  objectFit: "cover",
  border: "1px solid var(--dsw-alias-border-l2)"
};
const hintStyle = { color: "var(--dsw-alias-label-tertiary)", fontSize: 12 };
const sliderLabelStyle = { fontSize: 13, minWidth: 64 };
const readoutStyle = { fontSize: 12, minWidth: 36, textAlign: "right" };

const errorStyle = { color: "var(--dsw-alias-state-error-primary)", fontSize: 12 };
const statusStyle = { color: "var(--dsw-alias-label-tertiary)", fontSize: 12 };

/** One labelled slider line; both controls share this shape. */
function sliderLine(label, value, max, step, readout, onInput) {
  return React.createElement("div", { style: rowLine },
    React.createElement("label", { style: sliderLabelStyle }, label),
    React.createElement("input", {
      type: "range",
      min: 0,
      max,
      step,
      value,
      style: { flex: 1, minWidth: 120 },
      onChange: (e) => onInput(Number(e.target.value))
    }),
    React.createElement("span", { style: readoutStyle }, readout)
  );
}

function GlassRow({ t, useStore, chooseFile, clearImage, setBlur, setTranslucency }) {
  const { image, blur, translucency, status, error } = useStore((s) => s);
  const fileRef = React.useRef(null);
  const onFile = (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) chooseFile(file);
    e.target.value = "";
  };
  return React.createElement("div", { style: rowGap },
    React.createElement("div", { style: rowLine },
      React.createElement("span", null, t("glass.title")),
      image ? React.createElement("img", { src: image, style: thumbStyle, alt: "" }) : null,
      React.createElement("button", { type: "button", style: btnStyle, onClick: () => fileRef.current && fileRef.current.click() }, t("glass.choose")),
      image ? React.createElement("button", { type: "button", style: btnStyle, onClick: clearImage }, t("glass.remove")) : null,
      React.createElement("input", { ref: fileRef, type: "file", accept: "image/*", style: { display: "none" }, onChange: onFile })
    ),
    sliderLine(t("glass.blur"), blur, 48, 1, `${blur}px`, setBlur),
    sliderLine(t("glass.translucency"), Math.round(translucency * 100), 100, 1, `${Math.round(translucency * 100)}%`, (v) => setTranslucency(v / 100)),
    status ? React.createElement("div", { style: statusStyle }, status) : null,
    error ? React.createElement("div", { style: errorStyle }, error) : null,
    React.createElement("div", { style: hintStyle }, t("glass.hint"))
  );
}

/* ── persistence (browser-local: the settings wire boundary only exposes
   the product's hardcoded namespace allowlist, so the skin keeps its own
   state in localStorage) ─────────────────────────────────────────── */

const STORAGE_KEY = "dsh-skin-glass:v1";
const DEFAULTS = { image: "", blur: DEFAULT_BLUR, translucency: DEFAULT_TRANSLUCENCY };

/**
 * Coerce an arbitrary record to the state shape, field by field. This is
 * also the migration path: a record written before a field existed simply
 * takes that field's default, so no version bump is ever needed.
 */
function normalize(value) {
  const v = value !== null && typeof value === "object" ? value : {};
  return {
    image: typeof v.image === "string" ? v.image : DEFAULTS.image,
    blur: typeof v.blur === "number" && isFinite(v.blur) ? v.blur : DEFAULTS.blur,
    translucency: typeof v.translucency === "number" && isFinite(v.translucency)
      ? v.translucency
      : DEFAULTS.translucency
  };
}

function readStored() {
  try {
    return normalize(JSON.parse(localStorage.getItem(STORAGE_KEY)));
  } catch (_read) {
    return { ...DEFAULTS };
  }
}

function writeStored(value) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
}

/* ── plugin body ──────────────────────────────────────────────────── */

const inject = ["slots", "locale", "theme"];

function apply(ctx) {
  ensureChromeTag();
  ensureFilterHost();

  const store = createRowStore();
  let stored = readStored();
  let bound;
  let tokenDisposer = null;
  /** Cached { accent, wallpaper } from the last image analysis. */
  let imageCache = null;
  let applySeq = 0;
  const scanner = createSurfaceScanner();
  /** OS "reduce transparency" preference; forces the opaque end of every tier. */
  const reduceQuery = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-transparency: reduce)") : null;

  const syncRow = () => {
    if (!bound) return;
    bound.sync(stored);
  };

  /**
   * Fold a patch into the persisted state, then push it to the row and the
   * document. The visual update is applied even when persistence fails (a
   * full quota is no reason to withhold the effect the user just asked for).
   * @returns false when the write to localStorage threw.
   */
  const commit = (patch) => {
    stored = { ...stored, ...patch };
    let persisted = true;
    try {
      writeStored(stored);
    } catch (err) {
      console.error("[dsh-skin-glass] persist failed:", err);
      persisted = false;
    }
    syncRow();
    refresh();
    return persisted;
  };

  /** Apply (or re-apply) the token layer with the cached analysis + current settings. */
  const applyTokens = () => {
    if (!imageCache) return;
    // a media query cannot reach the token layer, so the OS preference is
    // honoured here by collapsing translucency to its most legible end
    const t = reduceQuery !== null && reduceQuery.matches ? 0 : stored.translucency;
    tokenDisposer = ctx.theme.overrideTokens("dsh-skin-glass", glassColor.buildTokens(imageCache.accent, {
      t,
      blurPx: stored.blur,
      wallpaper: imageCache.wallpaper
    }));
    // surface alphas just changed, so what counts as a glass surface — and how
    // hard nested fills must be held back — changed with them
    scanner.setTintScale(glassColor.nestedTintScale(t));
    scanner.retag();
  };

  /** Re-render the glass chrome and (re)apply the token layer from `stored`. */
  const refresh = () => {
    const { image, blur } = stored;
    const root = document.documentElement;
    const escaped = image.replace(/"/g, '\\"');
    root.style.setProperty("--dsh-glass-image", image ? `url("${escaped}")` : "none");
    root.style.setProperty("--dsh-glass-blur", `${blur}px`);
    // surfaces blur their own backdrop less than the wallpaper does: they sit
    // over app content, which should stay recognisable through the glass
    root.style.setProperty("--dsh-surface-blur", `${Math.max(6, Math.round(blur * 0.7))}px`);
    // more glass to look through, more the light should bend through it
    const displacement = document.querySelector(`#${REFRACT_ID} feDisplacementMap`);
    if (displacement !== null) displacement.setAttribute("scale", String(Math.round(8 + 30 * stored.translucency)));
    // the chrome stylesheet is gated on this attribute: with no image the skin
    // leaves the native theme completely untouched
    if (image) root.setAttribute("data-dsh-glass", "");
    else root.removeAttribute("data-dsh-glass");
    if (!image) {
      imageCache = null;
      applySeq += 1;            // abandon any analysis still in flight
      scanner.clear();
      if (tokenDisposer) {
        tokenDisposer();
        tokenDisposer = null;
      }
      return;
    }
    if (imageCache !== null && imageCache.src === image) {
      applyTokens();   // blur/translucency-only change: same image analysis
      return;
    }
    const seq = ++applySeq;
    analyzeImage(image).then((analysis) => {
      if (seq !== applySeq) return;
      imageCache = { ...analysis, src: image };
      applyTokens();
    }).catch((err) => {
      if (seq !== applySeq) return;
      console.error("[dsh-skin-glass] analyzeImage failed:", err);
      if (bound) bound.error("glass.error.decode");
    });
  };

  // initial application from persisted state
  refresh();
  console.log("[dsh-skin-glass] ready:", JSON.stringify({
    image: stored.image ? "set" : "none",
    blur: stored.blur,
    translucency: stored.translucency,
    theme: typeof ctx.theme.overrideTokens === "function"
  }));

  ctx.effect(() => {
    return () => {
      if (tokenDisposer) tokenDisposer();
      tokenDisposer = null;
      scanner.stop();
      const host = document.getElementById("dsh-glass-filters");
      if (host !== null) host.remove();
      const root = document.documentElement;
      root.removeAttribute("data-dsh-glass");
      root.style.removeProperty("--dsh-glass-image");
      root.style.removeProperty("--dsh-glass-blur");
      root.style.removeProperty("--dsh-surface-blur");
    };
  }, "dsh-skin-glass: token layer");

  // The product streams markdown and mounts popovers through portals, so new
  // surfaces appear constantly; each added subtree is queued and tagged during
  // idle time rather than synchronously in the mutation callback.
  ctx.effect(() => {
    if (typeof MutationObserver !== "function") return () => {};
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          scanner.repairFixed(node);
          scanner.add(node);
        }
        if (record.removedNodes.length > 0) scanner.checkReleases();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, "dsh-skin-glass: surface observer");

  ctx.effect(() => ctx.locale.register(GLASS_NS, { zh, en }), "dsh-skin-glass: row dictionaries");

  ctx.effect(() => {
    if (reduceQuery === null) return () => {};
    const onChange = () => applyTokens();
    reduceQuery.addEventListener("change", onChange);
    return () => reduceQuery.removeEventListener("change", onChange);
  }, "dsh-skin-glass: reduced-transparency listener");

  ctx.slots.inject("settings.general.item", () => ctx.slots.register({
    name: "settings.general.item",
    id: "glass-background",
    order: 20,
    store,
    locale: GLASS_NS,
    inject: (actions) => {
      bound = actions;
      syncRow();
      return {
        chooseFile: (file) => {
          bound.status("glass.processing");
          processImageFile(file).then((dataUrl) => {
            if (!commit({ image: dataUrl })) {
              bound.status("");
              bound.error("glass.error.write");
              return;
            }
            bound.status("");
            bound.error("");
          }).catch((err) => {
            console.error("[dsh-skin-glass] chooseFile failed:", err);
            bound.status("");
            bound.error("glass.error.decode");
          });
        },
        clearImage: () => {
          commit({ image: "" });
        },
        setBlur: (v) => {
          commit({ blur: Math.round(v) });
        },
        setTranslucency: (v) => {
          commit({ translucency: Math.max(0, Math.min(1, v)) });
        }
      };
    }
  }, GlassRow));
}

/* ── QA debug handle ─────────────────────────────────────────────────
   The live probe (scripts/qa/probe-panels.mjs) drives the REAL classifier
   through this instead of maintaining a hand copy that drifts. The sandbox
   harnesses evaluate this file without a `window`, so the guard keeps them
   unaffected. */
if (typeof window !== "undefined") {
  window.__dshGlass = {
    decideSurface,
    tagSurface,
    createSurfaceScanner,
    parseColor: glassColor.parseColor,
    alphaOf: glassColor.alphaOf,
    SURFACE_ATTR,
    SHEET_ATTR,
    MERGE_ATTR,
    TINT_ATTR,
    INK_ATTR,
    SURFACE_MIN_ALPHA,
    SURFACE_MAX_ALPHA,
    SURFACE_MIN_W,
    SURFACE_MIN_H,
    ANCESTOR_SCAN,
    isOutOfFlow,
    isGlassRegion,
    isGlassOverlay,
    hasAncestor
  };
}

exports.apply = apply;
exports.inject = inject;
