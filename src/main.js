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
     sit over *app content* and take the backdrop-filter directly;
   - in-flow sheets — columns, cards, rows — only ever show the wallpaper, so
     their frost lives on a `::before` pseudo (see GLASS_CSS). A filter on a
     pseudo leaves the sheet itself a plain containing block, which is what
     fixes the hover bug: the product's Tooltip bubble is a `position: fixed`
     span rendered *inline*, and a backdrop-filter on any real ancestor makes
     that ancestor the bubble's containing block — so every hover used to
     strip the glass from the whole column. The painted result is unchanged,
     and the sheet marker still feeds the nested-fill normalization
     (merge/tint), which is what keeps the trajectory view from compounding
     to opaque.

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
const FILTER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0">` +
  `<filter id="${REFRACT_ID}" x="-15%" y="-15%" width="130%" height="130%" color-interpolation-filters="sRGB">` +
  `<feTurbulence type="fractalNoise" baseFrequency="0.006 0.010" numOctaves="2" seed="11" result="warp"/>` +
  `<feGaussianBlur in="warp" stdDeviation="6" result="softWarp"/>` +
  `<feDisplacementMap in="SourceGraphic" in2="softWarp" scale="18" xChannelSelector="R" yChannelSelector="G"/>` +
  `</filter></svg>`;

const REFRACT_OK = typeof CSS !== "undefined" && typeof CSS.supports === "function" &&
  CSS.supports("backdrop-filter", `url(#${REFRACT_ID})`);

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
  "html[data-dsh-glass] [data-dsh-glass-surface]{",
  "-webkit-backdrop-filter:blur(var(--dsh-surface-blur, 14px)) saturate(1.9) brightness(1.04);",
  "backdrop-filter:blur(var(--dsh-surface-blur, 14px)) saturate(1.9) brightness(1.04)}",
  // in-flow sheets (columns, cards, rows) frost the wallpaper through a
  // ::before pseudo: visually identical to a filter on the sheet itself, but
  // the sheet never becomes the containing block for the inline-rendered
  // `position: fixed` tooltip bubbles inside it (the hover-vanishing bug).
  // `position: relative` anchors the pseudo's inset:0 to the sheet — it only
  // affects *absolute* descendants, never fixed ones.
  "html[data-dsh-glass] [data-dsh-glass-sheet]{position:relative}",
  "html[data-dsh-glass] [data-dsh-glass-sheet]::before{content:'';position:absolute;inset:0;z-index:-1;pointer-events:none;border-radius:inherit;",
  "-webkit-backdrop-filter:blur(var(--dsh-surface-blur, 14px)) saturate(1.9) brightness(1.04);",
  "backdrop-filter:blur(var(--dsh-surface-blur, 14px)) saturate(1.9) brightness(1.04)}",
  // descendants repainting their surface's own colour: harmless when that
  // colour is opaque, but with translucency they compound into a solid block
  // (see MERGE_ATTR)
  "html[data-dsh-glass] [data-dsh-glass-merge]{background-color:transparent}",
  // refraction, Chromium only — the detector withholds the "lg" value entirely
  // when the engine cannot do it, so these rules simply never match elsewhere
  "html[data-dsh-glass] [data-dsh-glass-surface=lg]{",
  `-webkit-backdrop-filter:url(#${REFRACT_ID}) blur(var(--dsh-surface-blur, 14px)) saturate(1.9) brightness(1.04);`,
  `backdrop-filter:url(#${REFRACT_ID}) blur(var(--dsh-surface-blur, 14px)) saturate(1.9) brightness(1.04)}`,
  "html[data-dsh-glass] [data-dsh-glass-sheet=lg]::before{",
  `-webkit-backdrop-filter:url(#${REFRACT_ID}) blur(var(--dsh-surface-blur, 14px)) saturate(1.9) brightness(1.04);`,
  `backdrop-filter:url(#${REFRACT_ID}) blur(var(--dsh-surface-blur, 14px)) saturate(1.9) brightness(1.04)}`,
  // honour the OS "reduce transparency" setting (translucency is also forced
  // to its most legible end from JS, which can reach the token layer)
  "@media (prefers-reduced-transparency: reduce){",
  "html[data-dsh-glass] [data-dsh-glass-surface],",
  "html[data-dsh-glass] [data-dsh-glass-sheet]::before{",
  "-webkit-backdrop-filter:none;backdrop-filter:none}}"
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
   class it happens to carry this build. Tagging stops at the first match so
   only the outermost surface is marked — nesting backdrop-filters would
   compound the blur into mud and multiply the cost — but descent continues,
   because a fixed-position overlay nested inside glass is exactly what has
   to be found (see unglassAncestors).

   The marker comes in two kinds (see tagSurface): overlays (fixed/absolute)
   get `data-dsh-glass-surface`, which carries the backdrop-filter directly;
   in-flow sheets get `data-dsh-glass-sheet`, whose frost lives on a `::before`
   pseudo instead — the sheet itself never becomes a containing block, so a
   hover tooltip (an inline-rendered `position: fixed` bubble) is neither
   re-anchored nor triggers any glass stripping on mount. Both markers feed
   the nested-fill normalization (merge/tint). */

const SURFACE_ATTR = "data-dsh-glass-surface";
/**
 * Marks an *in-flow* surface (columns, cards, rows). Its frost lives on a
 * `::before` pseudo (see GLASS_CSS), so the sheet itself never becomes the
 * containing block for the inline-rendered `position: fixed` tooltip bubbles
 * inside it — hovering a button used to strip the glass from the whole
 * column. The marker still counts as glass for the merge/tint normalization.
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
/** Below this the fill is a hover tint, not a surface; above it, it is opaque. */
const SURFACE_MIN_ALPHA = 0.2;
const SURFACE_MAX_ALPHA = 0.995;
const SURFACE_MIN_W = 44;
const SURFACE_MIN_H = 24;
/** Refraction is reserved for surfaces big enough for the distortion to read. */
const REFRACT_MIN_AREA = 45000;
/** Elements processed per idle slice, so a long conversation cannot stall. */
const SCAN_BUDGET = 2500;

function alphaOf(color) {
  const m = /^rgba?\(([^)]+)\)$/.exec(color);
  if (m === null) return 1;
  const parts = m[1].split(",");
  return parts.length > 3 ? Number(parts[3]) : 1;
}

/** Split "rgba(r, g, b, a)" into numbers, or null if it is not that shape. */
function parseColor(color) {
  const m = /^rgba?\(([^)]+)\)$/.exec(color);
  if (m === null) return null;
  const parts = m[1].split(",").map((s) => Number(s.trim()));
  if (parts.length < 3 || parts.slice(0, 3).some((n) => !Number.isFinite(n))) return null;
  return { rgb: parts.slice(0, 3), a: parts.length > 3 ? parts[3] : 1 };
}

/**
 * Repaint a nested fill at a fraction of its alpha, so it tints the glass
 * instead of thickening it. Written as an inline style because the value is
 * per-element; the original colour rides along in the attribute so the next
 * pass can tell "already scaled" from "needs scaling".
 * @returns the element's original background colour.
 */
function scaleNestedTint(el, bg, scale) {
  const original = el.getAttribute(TINT_ATTR);
  if (original !== null) return original;      // already ours; never compound
  if (scale >= 1) return bg;
  // a background the product set inline is not ours to rewrite
  if (el.style.backgroundColor !== "") return bg;
  const parsed = parseColor(bg);
  if (parsed === null || parsed.a <= 0 || parsed.a >= 1) return bg;
  el.setAttribute(TINT_ATTR, bg);
  const scaled = Math.round(parsed.a * scale * 1000) / 1000;
  el.style.setProperty("background-color", `rgba(${parsed.rgb.join(", ")}, ${scaled})`);
  return bg;
}

/**
 * Walk up looking for an ancestor carrying a real backdrop-filter
 * (`data-dsh-glass-surface` only — sheets have no filter and cannot
 * re-anchor fixed descendants). Attributes only, no style.
 */
function hasGlassAncestor(el) {
  let p = el.parentElement;
  while (p !== null) {
    if (p.hasAttribute(SURFACE_ATTR)) return true;
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
    if (p.hasAttribute(SURFACE_ATTR)) {
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
function tagSurface(el, suspended, computed) {
  if (suspended !== undefined && suspended.has(el)) return false;
  const cs = computed !== undefined ? computed : getComputedStyle(el);
  const alpha = alphaOf(cs.backgroundColor);
  if (!(alpha >= SURFACE_MIN_ALPHA && alpha <= SURFACE_MAX_ALPHA)) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width < SURFACE_MIN_W || rect.height < SURFACE_MIN_H) return false;
  // A surface that fills the viewport has nothing behind it but the wallpaper,
  // which is already blurred — it would pay the largest backdrop cost in the
  // app for no visible gain. Skip it, but keep descending.
  if (rect.width >= innerWidth * 0.92 && rect.height >= innerHeight * 0.92) return false;
  const large = rect.width * rect.height >= REFRACT_MIN_AREA;
  const tier = large && REFRACT_OK ? "lg" : "sm";
  // Out-of-flow overlays sit over app content and take the filter directly;
  // in-flow sheets only ever show the wallpaper, so their frost rides a
  // ::before pseudo and the sheet stays a plain containing block — the
  // inline-rendered fixed tooltip bubbles inside it are never re-anchored.
  if (cs.position === "fixed" || cs.position === "absolute") {
    el.setAttribute(SURFACE_ATTR, tier);
  } else {
    el.setAttribute(SHEET_ATTR, tier);
  }
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
   * re-scan normalizes nested fills added while it was suspended.
   */
  const sweepSuspensions = () => {
    if (suspensions.length === 0) return;
    const kept = [];
    const stillHeld = new Set();
    let dropped = false;
    for (const entry of suspensions) {
      if (entry.fixed.isConnected) {
        kept.push(entry);
        for (const { ancestor } of entry.stripped) stillHeld.add(ancestor);
      } else {
        dropped = true;
      }
    }
    if (!dropped) return;
    const released = [];
    for (const entry of suspensions) {
      if (entry.fixed.isConnected) continue;
      for (const { ancestor, value } of entry.stripped) {
        if (!stillHeld.has(ancestor) && ancestor.isConnected) {
          ancestor.setAttribute(SURFACE_ATTR, value);
          released.push(ancestor);
        }
      }
    }
    suspensions = kept;
    suspended = stillHeld;
    for (const ancestor of released) push(ancestor, false, null);
    if (released.length > 0) schedule();
  };

  const push = (el, inGlass, surfaceColor) => queue.push({ el, inGlass, surfaceColor });

  const drain = () => {
    scheduled = false;
    if (stopped) return;
    sweepSuspensions();
    let budget = SCAN_BUDGET;
    while (queue.length > 0 && budget > 0) {
      const { el, inGlass, surfaceColor } = queue.pop();
      budget -= 1;
      if (!el.isConnected) continue;
      const cs = getComputedStyle(el);
      if (cs.position === "fixed" && !suspended.has(el)) {
        // only glass *overlays* (data-dsh-glass-surface) carry a filter, so
        // this only ever fires for fixed elements inside them; the release
        // path restores the snapshot verbatim
        suspend(el);
      }
      // Descent continues past a glass surface even though tagging stops:
      // pruning would be cheaper, but a fixed-position overlay nested inside
      // glass is exactly what has to be found, and pruning would hide it.
      const tagged = !inGlass && tagSurface(el, suspended, cs);
      // an element we already tinted reports its scaled colour, so recover the
      // original for both the repeat test and what children compare against
      const bg = el.getAttribute(TINT_ATTR) !== null ? el.getAttribute(TINT_ATTR) : cs.backgroundColor;
      let childColor = surfaceColor;
      if (tagged) {
        childColor = bg;
      } else if (inGlass && surfaceColor !== null && bg === surfaceColor) {
        el.setAttribute(MERGE_ATTR, "");   // repeat of the surface's own colour
      } else if (alphaOf(bg) > 0) {
        // a new painted layer: tint it rather than let it add opacity, and
        // make it the reference its own children compare against
        if (inGlass) scaleNestedTint(el, bg, tintScale);
        childColor = bg;
      }
      for (const child of el.children) push(child, inGlass || tagged, childColor);
    }
    if (queue.length > 0) schedule();
  };

  const schedule = () => {
    if (scheduled || stopped) return;
    scheduled = true;
    if (typeof requestIdleCallback === "function") requestIdleCallback(drain, { timeout: 500 });
    else setTimeout(drain, 60);
  };

  const stripTags = () => {
    for (const el of document.querySelectorAll(`[${SURFACE_ATTR}], [${SHEET_ATTR}], [${MERGE_ATTR}], [${TINT_ATTR}]`)) {
      el.removeAttribute(SURFACE_ATTR);
      el.removeAttribute(SHEET_ATTR);
      el.removeAttribute(MERGE_ATTR);
      if (el.hasAttribute(TINT_ATTR)) {
        el.removeAttribute(TINT_ATTR);
        el.style.removeProperty("background-color");
      }
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
      push(root, false, null);
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
      if (stopped || node.nodeType !== 1 || !hasGlassAncestor(node)) return;
      const candidates = [node, ...node.children];
      for (const el of candidates) {
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
      push(document.body, false, null);
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

/** Downscale a picked file to a data URL (max 1920px, alpha flattened). */
async function processImageFile(file) {
  const img = await loadImage(URL.createObjectURL(file));
  try {
    const scale = Math.min(1, MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext("2d");
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, w, h);
    g.drawImage(img, 0, 0, w, h);
    try {
      return canvas.toDataURL("image/webp", 0.88);
    } catch (_webp) {
      return canvas.toDataURL("image/jpeg", 0.88);
    }
  } finally {
    URL.revokeObjectURL(img.src);
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
  init: () => ({ image: "", blur: DEFAULT_BLUR, translucency: DEFAULT_TRANSLUCENCY, ready: false, status: "", error: "" }),
  actions: {
    sync: (d, value) => {
      d.image = value && typeof value.image === "string" ? value.image : "";
      d.blur = value && typeof value.blur === "number" ? value.blur : DEFAULT_BLUR;
      d.translucency = value && typeof value.translucency === "number" ? value.translucency : DEFAULT_TRANSLUCENCY;
      d.ready = true;
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

/** Per-field defaulting doubles as the migration for pre-translucency records. */
function readStored() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { image: "", blur: DEFAULT_BLUR, translucency: DEFAULT_TRANSLUCENCY };
    const parsed = JSON.parse(raw);
    return {
      image: typeof parsed.image === "string" ? parsed.image : "",
      blur: typeof parsed.blur === "number" ? parsed.blur : DEFAULT_BLUR,
      translucency: typeof parsed.translucency === "number" ? parsed.translucency : DEFAULT_TRANSLUCENCY
    };
  } catch (_read) {
    return { image: "", blur: DEFAULT_BLUR, translucency: DEFAULT_TRANSLUCENCY };
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
    refresh(stored);
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

  /** Re-render the glass chrome and (re)apply the token layer. */
  const refresh = (value) => {
    const image = value && typeof value.image === "string" ? value.image : "";
    const blur = value && typeof value.blur === "number" ? value.blur : DEFAULT_BLUR;
    const t = value && typeof value.translucency === "number" ? value.translucency : DEFAULT_TRANSLUCENCY;
    const root = document.documentElement;
    const escaped = image.replace(/"/g, '\\"');
    root.style.setProperty("--dsh-glass-image", image ? `url("${escaped}")` : "none");
    root.style.setProperty("--dsh-glass-blur", `${blur}px`);
    // surfaces blur their own backdrop less than the wallpaper does: they sit
    // over app content, which should stay recognisable through the glass
    root.style.setProperty("--dsh-surface-blur", `${Math.max(6, Math.round(blur * 0.7))}px`);
    // more glass to look through, more the light should bend through it
    const displacement = document.querySelector(`#${REFRACT_ID} feDisplacementMap`);
    if (displacement !== null) displacement.setAttribute("scale", String(Math.round(8 + 30 * t)));
    // the chrome stylesheet is gated on this attribute: with no image the skin
    // leaves the native theme completely untouched
    if (image) root.setAttribute("data-dsh-glass", "");
    else root.removeAttribute("data-dsh-glass");
    if (!image) {
      imageCache = null;
      scanner.clear();
      if (tokenDisposer) {
        tokenDisposer();
        tokenDisposer = null;
      }
      return;
    }
    if (imageCache) {
      applyTokens();   // blur/translucency-only change: same image analysis
      return;
    }
    const seq = ++applySeq;
    analyzeImage(image).then((analysis) => {
      if (seq !== applySeq) return;
      imageCache = analysis;
      applyTokens();
    }).catch((err) => {
      if (seq !== applySeq) return;
      console.error("[dsh-skin-glass] analyzeImage failed:", err);
      bound && bound.error("glass.error.decode");
    });
  };

  // initial application from persisted state
  refresh(stored);
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

exports.apply = apply;
exports.inject = inject;
