window.__ModuleLoader__.load({
	id: "dsh-skin-glass",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

/* dsh-skin-glass — src/color.js
 * Pure color math: HSL conversion, mixing, k-means quantization, accent
 * picking, and the token-table builder. Node-testable; inlined into
 * lib/client.js by scripts/build.mjs (the trailing bundle-only export
 * marker section is stripped).
 */

/** [h, s, l] with h∈[0,1), s,l∈[0,1]. */
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  switch (max) {
    case r: h = (g - b) / d + (g < b ? 6 : 0); break;
    case g: h = (b - r) / d + 2; break;
    default: h = (r - g) / d + 4;
  }
  return [h / 6, s, l];
}

/** [r, g, b] integers from [h, s, l]. */
function hslToRgb(h, s, l) {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1 / 3) * 255)
  ];
}

/** Linear mix of two [r,g,b] triplets, t∈[0,1] toward c2. */
function mix(c1, c2, t) {
  return [
    Math.round(c1[0] + (c2[0] - c1[0]) * t),
    Math.round(c1[1] + (c2[1] - c1[1]) * t),
    Math.round(c1[2] + (c2[2] - c1[2]) * t)
  ];
}

/** Re-light a color to target lightness, optionally boosting saturation. */
function tune(rgb, lightness, saturation) {
  const [h, s] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
  return hslToRgb(h, saturation === undefined ? s : Math.max(s, saturation), lightness);
}

/** "r, g, b" component string. */
function rgbStr(rgb) {
  return `${rgb[0]}, ${rgb[1]}, ${rgb[2]}`;
}

/** rgb(r, g, b) CSS string. */
function rgb(rgb) {
  return `rgb(${rgbStr(rgb)})`;
}

/** rgba(r, g, b, a) CSS string; alpha is clamped and rounded to 3 decimals. */
function rgba(rgb, a) {
  const alpha = Math.round(Math.max(0, Math.min(1, a)) * 1000) / 1000;
  return `rgba(${rgbStr(rgb)}, ${alpha})`;
}

/**
 * k-means quantization over [r,g,b] samples.
 * @returns clusters [{r,g,b,count}] sorted by population descending.
 */
function quantize(samples, k, iterations) {
  k = Math.min(k, Math.max(1, samples.length));
  if (samples.length === 0) return [];
  let centers = [];
  const stride = Math.max(1, Math.floor(samples.length / k));
  for (let i = 0; i < k; i++) centers.push(samples[Math.min(i * stride, samples.length - 1)].slice());
  const dist = (p, c) => (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
  for (let iter = 0; iter < iterations; iter++) {
    const sums = Array.from({ length: k }, () => [0, 0, 0, 0]);
    for (const p of samples) {
      let best = 0;
      let bd = Infinity;
      for (let i = 0; i < k; i++) {
        const d = dist(p, centers[i]);
        if (d < bd) { bd = d; best = i; }
      }
      sums[best][0] += p[0];
      sums[best][1] += p[1];
      sums[best][2] += p[2];
      sums[best][3] += 1;
    }
    for (let i = 0; i < k; i++) {
      if (sums[i][3] === 0) continue;
      centers[i] = [sums[i][0] / sums[i][3], sums[i][1] / sums[i][3], sums[i][2] / sums[i][3]];
    }
  }
  const clusters = centers.map((c) => ({ r: Math.round(c[0]), g: Math.round(c[1]), b: Math.round(c[2]), count: 0 }));
  for (const p of samples) {
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < k; i++) {
      const d = dist(p, centers[i]);
      if (d < bd) { bd = d; best = i; }
    }
    clusters[best].count += 1;
  }
  return clusters.sort((a, b) => b.count - a.count);
}

/**
 * Pick the accent color: the most saturated cluster with a meaningful
 * population (not near-black/white), falling back to the dominant cluster.
 * @returns [r, g, b]
 */
function pickAccent(clusters) {
  const total = clusters.reduce((s, c) => s + c.count, 0);
  if (total === 0) return [99, 102, 241];
  const minPop = Math.max(2, total * 0.02);
  let accent = null;
  let bestScore = -1;
  for (const c of clusters) {
    if (c.count < minPop) continue;
    const [, s, l] = rgbToHsl(c.r, c.g, c.b);
    if (l < 0.14 || l > 0.9) continue;
    const score = s * Math.min(1, Math.sqrt(c.count / total) * 3);
    if (score > bestScore) { bestScore = score; accent = c; }
  }
  if (accent === null) accent = clusters[0];
  return [accent.r, accent.g, accent.b];
}

/**
 * Summarize a wallpaper's brightness from the same [r,g,b] samples the
 * quantizer consumes, so the scrim can be sized to the actual image instead
 * of to the worst image imaginable.
 *
 * Luma is gamma-encoded (perceptual) rather than linearized: we want "how
 * bright does this look", and linear luminance is dominated by highlights.
 * The samples come from a 64×64 downscale of an up-to-1920px image, i.e.
 * each sample is already a heavy box-average — which makes `stdL` a decent
 * stand-in for the variance that survives the chrome layer's blur.
 *
 * @returns { meanL, stdL } both in 0..1 (stdL saturates well below 0.5).
 */
function analyzeWallpaper(samples) {
  if (samples.length === 0) return { meanL: 0.5, stdL: 0.5 };
  let sum = 0;
  let sumSq = 0;
  for (const [r, g, b] of samples) {
    const l = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    sum += l;
    sumSq += l * l;
  }
  const meanL = sum / samples.length;
  const variance = Math.max(0, sumSq / samples.length - meanL * meanL);
  return { meanL, stdL: Math.sqrt(variance) };
}

/* ── Token table builder ──────────────────────────────────────────── */

const WHITE = [255, 255, 255];
const PAPER = [246, 247, 252];
const NAVY = [10, 14, 24];
const NAVY2 = [16, 21, 36];
const INK = [23, 26, 32];
const INK2 = [80, 85, 96];
/** Wallpaper scrim base in dark mode (a touch deeper than the app background). */
const SCRIM_DARK = [8, 11, 20];
/** Modal scrim bases. */
const MASK_INK = [20, 24, 40];
const BLACK = [0, 0, 0];

/** Clamp to 0..1. */
const clamp01 = (v) => Math.max(0, Math.min(1, v));

/** Default translucency when the caller passes nothing. */
const DEFAULT_T = 0.45;

/** Translucency 0..1 — 0 is the most legible (near-opaque), 1 the most see-through. */
const clampT = (t) => Math.max(0, Math.min(1, typeof t === "number" && isFinite(t) ? t : DEFAULT_T));

/** One { light, dark } token pair. */
const pair = (light, dark) => ({ light, dark });

/**
 * How much of its alpha a background keeps when it is painted *inside* an
 * already-translucent surface.
 *
 * A nested fill was designed to sit on an opaque plate, where its only job is
 * to tint. Over glass it does that job *and* adds opacity, and a panel whose
 * rows each carry their own fill (the trajectory view) turns solid no matter
 * how transparent its own token is. Scaling the nested alpha keeps the tint
 * and drops the accumulation.
 *
 * At t = 0 the scale is 1: surfaces are near-opaque anyway, so nothing is
 * gained by washing the tints out.
 *
 * Shared by the runtime detector and by scripts/check-contrast.mjs, which
 * must model the same compositing the browser will actually perform.
 */
function nestedTintScale(t) {
  return 1 - 0.7 * clampT(t);
}

/**
 * Build the { light, dark } token pair table for the glass skin from one
 * accent color extracted from the background image.
 *
 * Surfaces are tiered by what they carry, and each tier has its own alpha
 * range, so translucency can never drag a text-bearing surface below a
 * legible floor (see docs/development.md):
 *   A — see-through chrome: app background, sidebar (widest range)
 *   B — half-frosted reading surfaces: bubbles, inputs, code, small fills
 *   C — floating reading surfaces: dialogs, menus, overlays (highest floor)
 * The scrim flattens the wallpaper's luminance under everything, which is
 * what lets tier A open up without costing body-text contrast.
 *
 * @param accent - [r, g, b] accent triplet.
 * @param options - { t: 0..1 translucency, blurPx: wallpaper blur radius,
 *   wallpaper: { meanL, stdL } from {@link analyzeWallpaper} — omit it and
 *   the scrim falls back to worst-case strength }.
 */
function buildTokens(accent, options = {}) {
  const a = accent;
  const t = clampT(options.t);
  const blurPx = typeof options.blurPx === "number" && isFinite(options.blurPx) ? Math.max(0, options.blurPx) : 18;
  const aLight = tune(a, 0.5, 0.58);      // accent usable on light surfaces
  const aDark = tune(a, 0.74, 0.58);      // accent usable on dark surfaces
  const fillLight = `linear-gradient(135deg, ${rgb(tune(a, 0.5, 0.62))}, ${rgb(tune(a, 0.62, 0.68))})`;
  const fillDark = `linear-gradient(135deg, ${rgb(tune(a, 0.8, 0.6))}, ${rgb(tune(a, 0.68, 0.66))})`;
  const hoverLight = `linear-gradient(135deg, ${rgb(tune(a, 0.44, 0.6))}, ${rgb(tune(a, 0.56, 0.66))})`;
  const hoverDark = `linear-gradient(135deg, ${rgb(tune(a, 0.86, 0.6))}, ${rgb(tune(a, 0.74, 0.66))})`;

  // Tier alphas. Every glass surface now carries its own backdrop-filter (the
  // runtime detector in main.js tags them), so a surface finally shows the
  // *app content* behind it rather than just tinting a pre-blurred wallpaper
  // — which is what lets these run far more transparent than the flat-alpha
  // design could afford. The reading tiers still keep a floor; what protects
  // them at the bottom of the range is the scrim, not their own opacity.
  const aBase = 0.9 - 0.62 * t;   // A: app background (assistant text sits here)
  const aSide = 0.86 - 0.62 * t;  // A: sidebar
  const aMid = 0.94 - 0.3 * t;    // B: bubbles, inputs, code, small fills
  const aTop = 0.96 - 0.24 * t;   // C: dialogs, menus, overlays

  // Wallpaper scrim: flattens the image's luminance swings so a translucent
  // surface has a predictable backdrop, and it is what carries legibility at
  // high translucency.
  //
  // Only one direction actually threatens each palette — a *dark* wallpaper
  // is what endangers dark-on-light text, a *bright* one endangers light-on-
  // dark — so each mode sizes its scrim from the threat it faces plus the
  // image's contrastiness. `need = 1` reproduces the fixed worst-case values,
  // which is the floor a featureless black (light mode) or white (dark mode)
  // wallpaper still gets. A friendly image lands far below it and buys real
  // transparency back.
  const wall = options.wallpaper;
  const meanL = wall !== undefined && isFinite(wall.meanL) ? clamp01(wall.meanL) : undefined;
  const stdL = wall !== undefined && isFinite(wall.stdL) ? clamp01(wall.stdL) : 0;
  // The 1.6 on stdL is calibrated, not guessed: at 1.2 a busy mid-luminance
  // wallpaper drove the dark-mode sidebar to 4.47:1, just under AA
  // (scripts/check-contrast.mjs pins this).
  const needLight = meanL === undefined ? 1 : clamp01(1 - meanL + 1.6 * stdL);
  const needDark = meanL === undefined ? 1 : clamp01(meanL + 1.6 * stdL);
  const scrim = pair(
    rgba(WHITE, 0.04 + t * 0.44 * needLight),
    rgba(SCRIM_DARK, 0.06 + t * 0.52 * needDark)
  );

  // Modal scrims + the product's own mask blur hook (`.mask` elements already
  // declare `backdrop-filter: var(--dsw-mask-blur)`); raising it puts a real
  // frost between a dialog and the app content behind it.
  const maskBlur = `blur(${Math.max(8, Math.round(blurPx * 0.75))}px)`;

  // Specular rim: the bright top-left / dark bottom-right inner edge is where
  // a pane of glass gets its thickness. Injected through the elevation tokens
  // because every elevated surface in the product consumes them as
  // `box-shadow` (21 call sites, none of them `filter: drop-shadow()`), so
  // this reaches dialogs, menus, panels and toasts without a single selector.
  const rim = (strength) => `inset 1px 1px 0 rgba(255, 255, 255, ${strength}), inset -1px -1px 0 rgba(10, 14, 24, 0.1)`;
  const rimDark = (strength) => `inset 1px 1px 0 rgba(255, 255, 255, ${strength}), inset -1px -1px 0 rgba(0, 0, 0, 0.3)`;

  // Borders read as neutral hairlines rather than pure accent, so panel
  // dividers survive over a busy wallpaper.
  const edgeLight = mix(a, INK, 0.5);
  const edgeDark = mix(a, WHITE, 0.5);
  const edge = (alpha) => pair(rgba(edgeLight, alpha), rgba(edgeDark, alpha + 0.06));

  // static bluish-neutral scale: components reference these directly.
  // light mode: white→ink with a 5% accent tint; dark mode: navy→near-white
  // with a 10% accent tint (same direction: 50 lightest … 950 darkest).
  const steps = [0.03, 0.04, 0.05, 0.07, 0.09, 0.12, 0.17, 0.35, 0.47, 0.54, 0.62, 0.72, 0.78, 0.82, 0.86, 0.89, 0.93, 0.96];
  const bluishNames = ["50", "60", "75", "100", "150", "200", "300", "400", "500", "550", "600", "700", "750", "800", "850", "875", "900", "950"];
  const statics = {};
  for (let i = 0; i < bluishNames.length; i++) {
    const step = steps[i];
    const lightVal = mix(mix(WHITE, INK, step), a, 0.05);
    const darkVal = mix(mix(NAVY, [233, 237, 249], 1 - step), a, 0.1);
    statics[`--dsw-static-neutral-bluish-${bluishNames[i]}`] = pair(rgb(lightVal), rgb(darkVal));
  }
  statics["--dsw-static-neutral-bluish-00"] = pair(rgb(WHITE), rgb(WHITE));
  statics["--dsw-static-neutral-bluish-1000"] = pair(rgb(INK), rgb(NAVY));
  // static deepseek brand scale → accent ramp (components reference directly)
  const rampLightness = [0.95, 0.9, 0.83, 0.72, 0.62, 0.55, 0.47, 0.4, 0.33, 0.27];
  const rampNames = ["50", "100", "200", "300", "400", "450", "500", "600", "700-delete", "800"];
  for (let i = 0; i < rampNames.length; i++) {
    const l = rampLightness[i];
    statics[`--dsw-static-deepseek-${rampNames[i]}`] = pair(rgb(tune(a, l, 0.55)), rgb(tune(a, Math.min(1, l + 0.05), 0.55)));
  }
  statics["--dsw-static-deepseek-900"] = pair(rgb(tune(a, 0.22, 0.5)), rgb(tune(a, 0.26, 0.5)));

  return {
    ...statics,
    /* wallpaper + modal scrims (consumed by the chrome stylesheet and by the
       product's own `.mask` elements) */
    "--dsh-glass-scrim": scrim,
    "--dsw-mask-blur": pair(maskBlur, maskBlur),
    "--dsw-alias-bg-mask-1": pair(rgba(MASK_INK, 0.18 + 0.16 * t), rgba(BLACK, 0.4 + 0.18 * t)),
    "--dsw-alias-bg-mask-2": pair(rgba(MASK_INK, 0.1 + 0.1 * t), rgba(BLACK, 0.24 + 0.14 * t)),
    "--dsw-alias-bg-mask-3": pair(rgba(MASK_INK, 0.34 + 0.18 * t), rgba(BLACK, 0.56 + 0.16 * t)),
    "--dsw-alias-bg-mask-drop": pair(rgba(WHITE, 0.6), rgba(NAVY, 0.65)),

    /* accent-driven, fully opaque */
    "--dsw-alias-brand-primary": pair(rgb(aLight), rgb(aDark)),
    "--dsw-alias-brand-text": pair(rgb(aLight), rgb(aDark)),
    "--dsw-alias-brand-primary-invert": pair(rgb(NAVY), rgb(PAPER)),
    "--dsw-alias-button-primary-fill": pair(fillLight, fillDark),
    "--dsw-alias-button-primary-hover": pair(hoverLight, hoverDark),
    "--dsw-alias-button-info-fill": pair(rgb(aLight), rgb(aDark)),
    "--dsw-alias-button-info-hover": pair(rgb(tune(a, 0.58, 0.6)), rgb(tune(a, 0.8, 0.6))),
    "--dsw-alias-state-business-primary": pair(rgb(aLight), rgb(aDark)),

    /* tier A — see-through chrome */
    "--dsw-alias-bg-base": pair(rgba(mix(WHITE, a, 0.06), aBase), rgba(mix(NAVY, a, 0.14), aBase)),
    "--dsw-specific-sidebar-fill": pair(rgba(mix(PAPER, a, 0.05), aSide), rgba(mix([13, 17, 30], a, 0.07), aSide)),
    "--dsw-specific-sidebar-nav-item-hover": pair(rgba(mix(WHITE, a, 0.12), aSide + 0.12), rgba(mix(NAVY2, a, 0.2), aSide + 0.12)),
    "--dsw-specific-sidebar-nav-item-active": pair(rgba(a, 0.18), rgba(a, 0.26)),
    "--dsw-specific-sidebar-nav-item-active-accent": pair(rgba(a, 0.26), rgba(a, 0.36)),

    /* tier B — half-frosted reading surfaces */
    "--dsw-alias-bg-layer-1": pair(rgba(WHITE, aMid), rgba(NAVY2, aMid)),
    "--dsw-alias-bg-module-platform": pair(rgba(PAPER, aMid), rgba(mix(NAVY2, a, 0.16), aMid)),
    "--dsw-alias-bg-multi-select": pair(rgba(PAPER, aMid), rgba(mix(NAVY2, a, 0.16), aMid)),
    "--dsw-alias-button-elevated-fill": pair(rgba(WHITE, aMid), rgba(NAVY2, aMid)),
    "--dsw-alias-button-floating-fill": pair(rgba(WHITE, aMid), rgba(NAVY2, aMid)),
    "--dsw-alias-button-floating-hover": pair(rgba(mix(WHITE, a, 0.1), aMid + 0.03), rgba(mix(NAVY2, a, 0.18), aMid + 0.03)),
    "--dsw-alias-button-ghost-active-fill": pair(rgba(mix(WHITE, a, 0.14), aMid), rgba(mix(NAVY2, a, 0.24), aMid)),
    "--dsw-alias-button-ghost-active-hover": pair(rgba(mix(WHITE, a, 0.2), aMid + 0.03), rgba(mix(NAVY2, a, 0.32), aMid + 0.03)),
    "--dsw-alias-button-primary-dimmed": pair(rgba(mix(WHITE, a, 0.2), aMid - 0.14), rgba(mix(NAVY2, a, 0.32), aMid - 0.14)),
    "--dsw-alias-button-tool-bar-fill": pair(rgba(mix(WHITE, a, 0.08), aMid), rgba(mix([60, 68, 96], a, 0.2), aMid)),
    "--dsw-alias-button-tool-bar-hover": pair(rgba(mix(WHITE, a, 0.14), aMid + 0.03), rgba(mix([72, 80, 110], a, 0.2), aMid + 0.03)),
    "--dsw-alias-interactive-bg-hover-solid": pair(rgba(mix(WHITE, a, 0.08), aMid), rgba(mix(NAVY2, a, 0.16), aMid)),
    "--dsw-alias-state-business-tertiary": pair(rgba(mix(WHITE, a, 0.2), aMid - 0.2), rgba(mix(NAVY2, a, 0.34), aMid - 0.2)),
    "--dsw-specific-bubble": pair(rgba(mix(WHITE, a, 0.09), aMid), rgba(mix(NAVY2, a, 0.2), aMid)),
    "--dsw-specific-bubble-highlight": pair(rgba(mix(WHITE, a, 0.16), aMid + 0.03), rgba(mix(NAVY2, a, 0.3), aMid + 0.03)),
    "--dsw-specific-input-major": pair(rgba(WHITE, aMid + 0.02), rgba([18, 23, 41], aMid + 0.02)),
    "--dsw-specific-login-input": pair(rgba(PAPER, aMid), rgba([16, 21, 39], aMid)),
    "--dsw-specific-selector": pair(rgba(PAPER, aMid), rgba(mix(NAVY2, a, 0.16), aMid)),
    "--dsw-specific-tip": pair(rgba(PAPER, aMid), rgba(NAVY2, aMid)),
    "--dsw-alias-markdown-code-block": pair(rgba(mix(WHITE, a, 0.04), aMid), rgba(mix(NAVY, a, 0.1), aMid)),
    "--dsw-alias-markdown-code-block-banner": pair(rgba(mix(WHITE, a, 0.08), aMid + 0.03), rgba(mix(NAVY2, a, 0.14), aMid + 0.03)),
    "--dsw-alias-markdown-inline-code": pair(rgba(mix(WHITE, a, 0.14), aMid), rgba(mix(NAVY2, a, 0.26), aMid)),
    "--dsw-alias-markdown-code-segment-selected": pair(rgba(WHITE, aMid + 0.03), rgba(mix(NAVY2, a, 0.22), aMid + 0.03)),
    "--dsw-alias-markdown-code-segment-unselected": pair(rgba(mix(WHITE, a, 0.06), aMid), rgba(mix(NAVY, a, 0.12), aMid)),
    "--dsw-alias-markdown-citation": pair(rgba(mix(WHITE, a, 0.1), aMid), rgba(mix(NAVY2, a, 0.16), aMid)),
    "--dsw-alias-markdown-placeholder": pair(rgba(PAPER, aMid), rgba(NAVY2, aMid)),
    "--dsw-alias-markdown-tag": pair(rgba(mix(WHITE, a, 0.1), aMid), rgba(mix(NAVY2, a, 0.18), aMid)),

    /* tier C — floating reading surfaces (dialogs, menus, overlays) */
    "--dsw-alias-bg-layer-2": pair(rgba(PAPER, aTop), rgba(mix(NAVY, a, 0.08), aTop)),
    "--dsw-alias-bg-layer-3": pair(rgba(WHITE, aTop), rgba(mix(NAVY2, a, 0.14), aTop)),
    "--dsw-alias-bg-overlay": pair(rgba(mix(WHITE, a, 0.14), aTop), rgba(mix(NAVY2, a, 0.26), aTop)),
    "--dsw-specific-menu": pair(rgba(WHITE, aTop), rgba([26, 33, 56], aTop)),
    "--dsw-alias-toast-bg": pair(rgba([24, 28, 38], aTop), rgba([26, 33, 56], aTop)),
    "--dsw-alias-tooltip-bg": pair(rgba([24, 28, 38], aTop), rgba([26, 33, 56], aTop)),
    // Hover card: light = the dialog-surface material (bg-layer-2, what the
    // rename/settings dialogs are made of), dark = the always-dark tooltip
    // plate. The card declares --dsw-hovercard-bg on ITSELF, so the chrome
    // stylesheet rebinds that local variable to this token (see GLASS_CSS);
    // the pair is what makes the rebinding mode-aware.
    "--dsh-glass-hovercard-bg": pair(rgba(PAPER, aTop), rgba([26, 33, 56], aTop)),
    // Hover card text: the rows hardcode a light-on-dark palette. Light mode
    // rebinds it to the dialog-surface ink/grey scale; dark mode keeps the
    // product's hardcoded values verbatim, so the dark look never changes.
    "--dsh-glass-hovercard-title": pair(rgb(INK), "rgb(255, 255, 255)"),
    "--dsh-glass-hovercard-meta": pair(rgb(INK2), "rgb(207, 211, 214)"),
    "--dsh-glass-hovercard-caption": pair(rgb([98, 104, 118]), "rgb(173, 178, 184)"),

    /* hairlines, hover tints, scrollbars */
    "--dsw-alias-border-l1": edge(0.14),
    "--dsw-alias-border-l2": edge(0.24),
    "--dsw-alias-border-l3": edge(0.34),
    "--dsw-alias-border-l4": edge(0.45),
    "--dsw-alias-interactive-bg-hover": pair(rgba(a, 0.1), rgba(a, 0.16)),
    "--dsw-alias-interactive-bg-hover-accent": pair(rgba(a, 0.16), rgba(a, 0.24)),
    "--dsw-alias-interactive-bg-active": pair(rgba(a, 0.15), rgba(a, 0.22)),
    "--dsw-alias-interactive-bg-hover-danger": pair("rgba(236, 19, 19, 0.08)", "rgba(242, 90, 90, 0.18)"),
    "--dsw-alias-scrollbar-bg-l1": pair(rgba(a, 0.22), rgba(a, 0.3)),
    "--dsw-alias-scrollbar-bg-l2": pair(rgba(a, 0.22), rgba(a, 0.3)),
    "--dsw-alias-scrollbar-hover-l1": pair(rgba(a, 0.4), rgba(a, 0.48)),
    "--dsw-alias-scrollbar-hover-l2": pair(rgba(a, 0.4), rgba(a, 0.48)),

    /* text — opaque, and deliberately not translucency-coupled */
    "--dsw-alias-label-primary": pair(rgb(INK), rgb([232, 236, 248])),
    "--dsw-alias-label-secondary": pair(rgb(INK2), rgb([168, 174, 196])),
    "--dsw-alias-label-tertiary": pair(rgb([98, 104, 118]), rgb([150, 158, 182])),
    "--dsw-alias-label-caption": pair(rgb([108, 114, 128]), rgb([146, 154, 178])),
    "--dsw-alias-label-dimmed": pair(rgb([176, 180, 190]), rgb([74, 82, 104])),
    "--dsw-alias-label-primary-inverted": pair(rgb(WHITE), rgb([30, 36, 52])),

    /* elevation — the inset pair is the specular rim, see `rim` above */
    "--dsw-shadow-lv1": pair("0 2px 4px rgba(20, 24, 40, 0.08)", "0 2px 4px rgba(0, 0, 0, 0.3)"),
    "--dsw-shadow-lv1-blur": pair("0 4px 12px rgba(20, 24, 40, 0.05)", "0 4px 12px rgba(0, 0, 0, 0.2)"),
    "--dsw-shadow-lv2": pair(
      `${rim(0.4)}, 0 4px 12px ${rgba(a, 0.1)}, 0 2px 8px rgba(20, 24, 40, 0.08)`,
      `${rimDark(0.08)}, 0 4px 12px rgba(0, 0, 0, 0.24), 0 2px 8px rgba(0, 0, 0, 0.3)`
    ),
    "--dsw-shadow-lv3": pair(
      `${rim(0.55)}, 0 0 1px rgba(20, 24, 40, 0.2), 0 12px 32px ${rgba(a, 0.14)}`,
      `${rimDark(0.12)}, 0 0 1px rgba(0, 0, 0, 0.5), 0 12px 32px rgba(0, 0, 0, 0.42)`
    )
  };
}

const glassColor = {
  rgbToHsl,
  hslToRgb,
  mix,
  tune,
  rgb,
  rgba,
  quantize,
  pickAccent,
  analyzeWallpaper,
  nestedTintScale,
  buildTokens
};


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

   The marker comes in two kinds (see tagSurface): overlays (fixed/absolute,
   and in-flow panels nested inside an overlay shell) get
   `data-dsh-glass-surface`, which carries the backdrop-filter directly;
   top-level in-flow sheets get `data-dsh-glass-sheet`, whose frost lives on
   a `::before` pseudo instead — the sheet itself never becomes a containing
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
function paintsHovercardBg(el, cs) {
  const own = parseColor(cs.backgroundColor);
  const ref = parseColor(cs.getPropertyValue(HOVERCARD_VAR));
  if (own === null || ref === null || ref.a <= 0) return false;
  const round2 = (x) => Math.round(x * 100) / 100;
  return round2(own.a) === round2(ref.a) && own.rgb.every((v, i) => v === ref.rgb[i]);
}

/**
 * Rebind the hover card's hardcoded text palette to the per-mode hovercard
 * tokens. Light mode lands on the same ink/grey scale the rename dialog uses
 * on its light surface; dark mode resolves to the exact hardcoded values, so
 * the dark look is unchanged. Values are inline `var()`s, so the light/dark
 * switch is followed with no reapplication; a colour the product set inline
 * is left alone, like the nested-fill rule.
 */
function treatHovercardText(card) {
  const walk = (node) => {
    const cs = getComputedStyle(node);
    for (const [from, to] of HOVERCARD_TEXT_MAP) {
      if (cs.color === from && node.style.color === "") {
        node.style.setProperty("color", to);
        break;
      }
    }
    for (const child of node.children) walk(child);
  };
  walk(card);
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
 * Attribute-only check for "inside a marked glass region" (sheet or
 * surface), bounded like {@link tagSurface}'s ancestor scan. The drain uses
 * it to apply nested-fill tinting to subtrees that entered the DOM through
 * the mutation observer, whose walk starts outside the glass context — the
 * settings dialog is the canonical case: its panel and mask sit inside the
 * sidebar's sheet region, so their fills must be scaled like any other
 * nested fill or the dialog stops being see-through.
 */
function hasGlassRegionAncestor(el) {
  let p = el.parentElement;
  for (let i = 0; p !== null && i < ANCESTOR_SCAN; i++) {
    if (p.hasAttribute(SURFACE_ATTR) || p.hasAttribute(SHEET_ATTR)) return true;
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

/** How many ancestors an in-flow candidate checks before calling itself a sheet. */
const ANCESTOR_SCAN = 12;

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
  // Out-of-flow overlays sit over app content and take the filter directly.
  if (cs.position === "fixed" || cs.position === "absolute") {
    el.setAttribute(SURFACE_ATTR, tier);
    return true;
  }
  // In-flow element. Inside an already-marked glass region it belongs to the
  // outer marker. Inside a fixed/absolute overlay wrapper whose own box is
  // transparent (the settings dialog's shell), its backdrop is *app content*,
  // so it needs the real filter too — a pseudo would be buried under the
  // overlay's mask and lose the frost. Only top-level in-flow sheets
  // (columns, cards) get the pseudo frost, which keeps the sheet from being
  // the containing block for the inline fixed tooltip bubbles inside it.
  let p = el.parentElement;
  for (let i = 0; p !== null && i < ANCESTOR_SCAN; i++) {
    if (p.hasAttribute(SURFACE_ATTR) || p.hasAttribute(SHEET_ATTR)) return false;
    const pos = getComputedStyle(p).position;
    if (pos === "fixed" || pos === "absolute") {
      el.setAttribute(SURFACE_ATTR, tier);
      return true;
    }
    p = p.parentElement;
  }
  el.setAttribute(SHEET_ATTR, tier);
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
      const entry = queue.pop();
      const el = entry.el;
      let inGlass = entry.inGlass;
      let surfaceColor = entry.surfaceColor;
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
      // transparent fixed wrapper, an unmarked absolute container) takes its
      // content OFF the sheet's backdrop: reset the glass context so panels
      // inside it get their own marker instead of being suppressed as nested
      // fills — otherwise a retag while the dialog is open would strip the
      // panel's frost for good.
      if ((cs.position === "fixed" || cs.position === "absolute") &&
          !el.hasAttribute(SURFACE_ATTR) && !el.hasAttribute(SHEET_ATTR)) {
        inGlass = false;
        surfaceColor = null;
      }
      // Descent continues past a glass surface even though tagging stops:
      // pruning would be cheaper, but a fixed-position overlay nested inside
      // glass is exactly what has to be found, and pruning would hide it.
      const tagged = !inGlass && tagSurface(el, suspended, cs);
      // the hover card paints its background from --dsw-hovercard-bg (its only
      // consumer); once tagged as a glass surface, its hardcoded light-on-dark
      // text palette is rebound to the per-mode hovercard tokens, so light mode
      // matches the rename/settings dialog material and dark mode is unchanged
      if (tagged && (cs.position === "fixed" || cs.position === "absolute") && paintsHovercardBg(el, cs)) {
        treatHovercardText(el);
      }
      // an element we already tinted reports its scaled colour, so recover the
      // original for both the repeat test and what children compare against
      const bg = el.getAttribute(TINT_ATTR) !== null ? el.getAttribute(TINT_ATTR) : cs.backgroundColor;
      // A walk that starts outside the glass context (the mutation observer's
      // add()) still tints nested fills when the element sits inside a marked
      // glass region — otherwise a dialog panel mounted inside the sidebar's
      // sheet region would compound to opacity. Short-circuits when the walk
      // is already inside glass.
      const inRegion = inGlass || hasGlassRegionAncestor(el);
      let childColor = surfaceColor;
      if (tagged) {
        if (inRegion) scaleNestedTint(el, bg, tintScale);
        childColor = bg;
      } else if (inGlass && surfaceColor !== null && bg === surfaceColor) {
        el.setAttribute(MERGE_ATTR, "");   // repeat of the surface's own colour
      } else if (alphaOf(bg) > 0) {
        // a new painted layer: tint it rather than let it add opacity, and
        // make it the reference its own children compare against
        if (inRegion) scaleNestedTint(el, bg, tintScale);
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

		return module.exports;
	}
});
