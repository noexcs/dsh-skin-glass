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

/** rgba(r, g, b, a) CSS string. */
function rgba(rgb, a) {
  return `rgba(${rgbStr(rgb)}, ${a})`;
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

/* ── Token table builder ──────────────────────────────────────────── */

const WHITE = [255, 255, 255];
const PAPER = [246, 247, 252];
const NAVY = [10, 14, 24];
const NAVY2 = [16, 21, 36];
const INK = [23, 26, 32];
const INK2 = [80, 85, 96];

/**
 * Build the { light, dark } token pair table for the glass skin from one
 * accent color extracted from the background image.
 * @param accent - [r, g, b] accent triplet.
 */
function buildTokens(accent) {
  const a = accent;
  const aLight = tune(a, 0.5, 0.58);      // accent usable on light surfaces
  const aDark = tune(a, 0.74, 0.58);      // accent usable on dark surfaces
  const aLightHover = tune(a, 0.42, 0.58);
  const aDarkHover = tune(a, 0.82, 0.58);
  const fillLight = `linear-gradient(135deg, ${rgb(tune(a, 0.5, 0.62))}, ${rgb(tune(a, 0.62, 0.68))})`;
  const fillDark = `linear-gradient(135deg, ${rgb(tune(a, 0.8, 0.6))}, ${rgb(tune(a, 0.68, 0.66))})`;
  const hoverLight = `linear-gradient(135deg, ${rgb(tune(a, 0.44, 0.6))}, ${rgb(tune(a, 0.56, 0.66))})`;
  const hoverDark = `linear-gradient(135deg, ${rgb(tune(a, 0.86, 0.6))}, ${rgb(tune(a, 0.74, 0.66))})`;

  return {
    "--dsw-alias-brand-primary": { light: rgb(aLight), dark: rgb(aDark) },
    "--dsw-alias-brand-text": { light: rgb(aLight), dark: rgb(aDark) },
    "--dsw-alias-brand-primary-invert": { light: rgb(NAVY), dark: rgb(PAPER) },
    "--dsw-alias-button-primary-fill": { light: fillLight, dark: fillDark },
    "--dsw-alias-button-primary-hover": { light: hoverLight, dark: hoverDark },
    "--dsw-alias-button-primary-dimmed": { light: rgba(mix(WHITE, a, 0.2), 0.6), dark: rgba(mix(NAVY2, a, 0.32), 0.6) },
    "--dsw-alias-button-info-fill": { light: rgb(aLight), dark: rgb(aDark) },
    "--dsw-alias-button-info-hover": { light: rgb(tune(a, 0.58, 0.6)), dark: rgb(tune(a, 0.8, 0.6)) },
    "--dsw-alias-button-elevated-fill": { light: rgba(WHITE, 0.55), dark: rgba(NAVY2, 0.55) },
    "--dsw-alias-button-floating-fill": { light: rgba(WHITE, 0.6), dark: rgba(NAVY2, 0.6) },
    "--dsw-alias-button-floating-hover": { light: rgba(mix(WHITE, a, 0.1), 0.7), dark: rgba(mix(NAVY2, a, 0.18), 0.7) },
    "--dsw-alias-button-ghost-active-fill": { light: rgba(mix(WHITE, a, 0.14), 0.6), dark: rgba(mix(NAVY2, a, 0.24), 0.6) },
    "--dsw-alias-button-ghost-active-hover": { light: rgba(mix(WHITE, a, 0.2), 0.7), dark: rgba(mix(NAVY2, a, 0.32), 0.7) },
    "--dsw-alias-button-tool-bar-fill": { light: "rgba(255, 255, 255, 0.5)", dark: "rgba(93, 103, 140, 0.4)" },
    "--dsw-alias-button-tool-bar-hover": { light: "rgba(255, 255, 255, 0.65)", dark: "rgba(93, 103, 140, 0.55)" },
    "--dsw-alias-bg-base": { light: rgba(mix(WHITE, a, 0.06), 0.52), dark: rgba(mix(NAVY, a, 0.14), 0.5) },
    "--dsw-alias-bg-layer-1": { light: rgba(WHITE, 0.58), dark: rgba(NAVY2, 0.58) },
    "--dsw-alias-bg-layer-2": { light: rgba(PAPER, 0.44), dark: rgba(mix(NAVY, a, 0.08), 0.5) },
    "--dsw-alias-bg-layer-3": { light: rgba(WHITE, 0.66), dark: rgba(mix(NAVY2, a, 0.14), 0.6) },
    "--dsw-alias-bg-module-platform": { light: rgba(PAPER, 0.55), dark: rgba(mix(NAVY2, a, 0.16), 0.55) },
    "--dsw-alias-bg-multi-select": { light: rgba(PAPER, 0.55), dark: rgba(mix(NAVY2, a, 0.16), 0.55) },
    "--dsw-alias-bg-overlay": { light: rgba(mix(WHITE, a, 0.14), 0.82), dark: rgba(mix(NAVY2, a, 0.26), 0.82) },
    "--dsw-alias-bg-mask-drop": { light: rgba(WHITE, 0.5), dark: rgba(NAVY, 0.55) },
    "--dsw-alias-border-l1": { light: rgba(a, 0.09), dark: rgba(a, 0.15) },
    "--dsw-alias-border-l2": { light: rgba(a, 0.15), dark: rgba(a, 0.22) },
    "--dsw-alias-border-l3": { light: rgba(a, 0.21), dark: rgba(a, 0.28) },
    "--dsw-alias-border-l4": { light: rgba(a, 0.28), dark: rgba(a, 0.34) },
    "--dsw-alias-interactive-bg-hover": { light: rgba(a, 0.07), dark: rgba(a, 0.13) },
    "--dsw-alias-interactive-bg-hover-accent": { light: rgba(a, 0.13), dark: rgba(a, 0.2) },
    "--dsw-alias-interactive-bg-active": { light: rgba(a, 0.11), dark: rgba(a, 0.18) },
    "--dsw-alias-interactive-bg-hover-solid": { light: rgba(mix(WHITE, a, 0.08), 0.7), dark: rgba(mix(NAVY2, a, 0.16), 0.7) },
    "--dsw-alias-interactive-bg-hover-danger": { light: "rgba(236, 19, 19, 0.06)", dark: "rgba(242, 90, 90, 0.16)" },
    "--dsw-alias-label-primary": { light: rgb(INK), dark: rgb(232, 236, 248) },
    "--dsw-alias-label-secondary": { light: rgb(INK2), dark: rgb(168, 174, 196) },
    "--dsw-alias-label-tertiary": { light: rgb(112, 118, 132), dark: rgb(122, 130, 156) },
    "--dsw-alias-label-caption": { light: rgb(122, 128, 142), dark: rgb(122, 130, 156) },
    "--dsw-alias-label-dimmed": { light: rgb(226, 228, 234), dark: rgb(44, 51, 72) },
    "--dsw-alias-label-primary-inverted": { light: rgb(WHITE), dark: rgb(30, 36, 52) },
    "--dsw-alias-markdown-code-block": { light: rgba(mix(WHITE, a, 0.04), 0.45), dark: rgba(mix(NAVY, a, 0.1), 0.45) },
    "--dsw-alias-markdown-code-block-banner": { light: rgba(mix(WHITE, a, 0.08), 0.5), dark: rgba(mix(NAVY2, a, 0.14), 0.5) },
    "--dsw-alias-markdown-inline-code": { light: rgba(mix(WHITE, a, 0.14), 0.6), dark: rgba(mix(NAVY2, a, 0.26), 0.6) },
    "--dsw-alias-markdown-code-segment-selected": { light: rgba(WHITE, 0.7), dark: rgba(mix(NAVY2, a, 0.22), 0.7) },
    "--dsw-alias-markdown-code-segment-unselected": { light: rgba(mix(WHITE, a, 0.06), 0.5), dark: rgba(mix(NAVY, a, 0.12), 0.5) },
    "--dsw-alias-markdown-citation": { light: rgba(mix(WHITE, a, 0.1), 0.5), dark: rgba(mix(NAVY2, a, 0.16), 0.5) },
    "--dsw-alias-markdown-placeholder": { light: rgba(PAPER, 0.5), dark: rgba(NAVY2, 0.5) },
    "--dsw-alias-markdown-tag": { light: rgba(mix(WHITE, a, 0.1), 0.55), dark: rgba(mix(NAVY2, a, 0.18), 0.55) },
    "--dsw-alias-scrollbar-bg-l1": { light: rgba(a, 0.16), dark: rgba(a, 0.24) },
    "--dsw-alias-scrollbar-bg-l2": { light: rgba(a, 0.16), dark: rgba(a, 0.24) },
    "--dsw-alias-scrollbar-hover-l1": { light: rgba(a, 0.32), dark: rgba(a, 0.4) },
    "--dsw-alias-scrollbar-hover-l2": { light: rgba(a, 0.32), dark: rgba(a, 0.4) },
    "--dsw-alias-state-business-primary": { light: rgb(aLight), dark: rgb(aDark) },
    "--dsw-alias-state-business-tertiary": { light: rgba(mix(WHITE, a, 0.2), 0.55), dark: rgba(mix(NAVY2, a, 0.34), 0.55) },
    "--dsw-alias-toast-bg": { light: "rgba(24, 28, 38, 0.82)", dark: "rgba(26, 33, 56, 0.82)" },
    "--dsw-alias-tooltip-bg": { light: "rgba(24, 28, 38, 0.84)", dark: "rgba(26, 33, 56, 0.84)" },
    "--dsw-specific-sidebar-fill": { light: rgba(245, 247, 253, 0.4), dark: rgba(13, 17, 30, 0.45) },
    "--dsw-specific-sidebar-nav-item-active": { light: rgba(a, 0.13), dark: rgba(a, 0.2) },
    "--dsw-specific-sidebar-nav-item-active-accent": { light: rgba(a, 0.2), dark: rgba(a, 0.3) },
    "--dsw-specific-sidebar-nav-item-hover": { light: rgba(mix(WHITE, a, 0.06), 0.5), dark: rgba(mix(NAVY2, a, 0.12), 0.5) },
    "--dsw-specific-bubble": { light: rgba(mix(WHITE, a, 0.09), 0.5), dark: rgba(mix(NAVY2, a, 0.2), 0.5) },
    "--dsw-specific-bubble-highlight": { light: rgba(mix(WHITE, a, 0.16), 0.6), dark: rgba(mix(NAVY2, a, 0.3), 0.6) },
    "--dsw-specific-input-major": { light: rgba(WHITE, 0.55), dark: rgba(18, 23, 41, 0.55) },
    "--dsw-specific-login-input": { light: rgba(PAPER, 0.5), dark: rgba(16, 21, 39, 0.5) },
    "--dsw-specific-selector": { light: rgba(PAPER, 0.55), dark: rgba(mix(NAVY2, a, 0.16), 0.55) },
    "--dsw-specific-tip": { light: rgba(PAPER, 0.5), dark: rgba(NAVY2, 0.5) },
    "--dsw-specific-menu": { light: rgba(WHITE, 0.75), dark: rgba(26, 33, 56, 0.75) },
    "--dsw-shadow-lv1": { light: "0 2px 4px rgba(20, 24, 40, 0.08)", dark: "0 2px 4px rgba(0, 0, 0, 0.3)" },
    "--dsw-shadow-lv1-blur": { light: "0 4px 12px rgba(20, 24, 40, 0.05)", dark: "0 4px 12px rgba(0, 0, 0, 0.2)" },
    "--dsw-shadow-lv2": { light: `0 4px 12px ${rgba(a, 0.1)}, 0 2px 8px rgba(20, 24, 40, 0.08)`, dark: "0 4px 12px rgba(0, 0, 0, 0.24), 0 2px 8px rgba(0, 0, 0, 0.3)" },
    "--dsw-shadow-lv3": { light: `0 0 1px rgba(20, 24, 40, 0.2), 0 12px 32px ${rgba(a, 0.14)}`, dark: "0 0 1px rgba(0, 0, 0, 0.5), 0 12px 32px rgba(0, 0, 0, 0.42)" }
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
  buildTokens
};

//#bundle-only
module.exports = glassColor;
