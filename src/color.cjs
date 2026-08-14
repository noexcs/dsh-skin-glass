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
  if (samples.length === 0) return [];
  k = Math.min(k, samples.length);
  const centers = [];
  const stride = Math.max(1, Math.floor(samples.length / k));
  for (let i = 0; i < k; i++) centers.push(samples[Math.min(i * stride, samples.length - 1)].slice());
  const dist = (p, c) => (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
  const nearest = (p) => {
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < k; i++) {
      const d = dist(p, centers[i]);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  };
  for (let iter = 0; iter < iterations; iter++) {
    const sums = Array.from({ length: k }, () => [0, 0, 0, 0]);
    for (const p of samples) {
      const best = nearest(p);
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
  for (const p of samples) clusters[nearest(p)].count += 1;
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

/** A finite number, or the fallback. */
const num = (v, fallback) => (typeof v === "number" && isFinite(v) ? v : fallback);

/** Default translucency when the caller passes nothing. */
const DEFAULT_T = 0.45;
/** Default wallpaper blur radius, mirroring main.js's DEFAULT_BLUR. */
const DEFAULT_BLUR_PX = 18;

/** Translucency 0..1 — 0 is the most legible (near-opaque), 1 the most see-through. */
const clampT = (t) => clamp01(num(t, DEFAULT_T));

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
  const blurPx = Math.max(0, num(options.blurPx, DEFAULT_BLUR_PX));
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
  //
  // The 1.6 weight on stdL is calibrated, not guessed: at 1.2 a busy
  // mid-luminance wallpaper drove the dark-mode sidebar to 4.47:1, just under
  // AA (scripts/check-contrast.mjs pins this).
  const CONTRASTINESS_WEIGHT = 1.6;
  const wall = options.wallpaper;
  const known = wall !== null && typeof wall === "object" && isFinite(wall.meanL);
  const meanL = known ? clamp01(wall.meanL) : 0;
  const stdL = known ? clamp01(num(wall.stdL, 0)) : 0;
  const needLight = known ? clamp01(1 - meanL + CONTRASTINESS_WEIGHT * stdL) : 1;
  const needDark = known ? clamp01(meanL + CONTRASTINESS_WEIGHT * stdL) : 1;
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

/* The namespace the bundle and the check scripts consume. The conversion and
   mixing helpers above are internal to the token builder; only the four
   image→theme entry points and the compositing rule the detector shares with
   scripts/check-contrast.mjs are exposed. */
const glassColor = {
  quantize,
  pickAccent,
  analyzeWallpaper,
  nestedTintScale,
  buildTokens
};

//#bundle-only
module.exports = glassColor;
