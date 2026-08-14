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

/* ── chrome stylesheet: image layer + frosted blur ────────────────── */

const GLASS_TAG_ID = "dsh-skin-glass/chrome.css";
const GLASS_CSS = [
  "/* dsh-skin-glass: background layer + frosted surfaces */",
  "html{background:#0b0e17}",
  "body{background:transparent !important}",
  "body::before{content:'';position:fixed;inset:0;z-index:-1;pointer-events:none;",
  "background-image:var(--dsh-glass-image,none);background-size:cover;background-position:center;background-repeat:no-repeat;",
  "filter:blur(5px) saturate(1.15)}",
  "#root > div{backdrop-filter:blur(var(--dsh-glass-blur,24px)) saturate(1.35)}"
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

/** Extract the accent color from a (downscaled) background image. */
async function extractAccent(dataUrl) {
  const samples = await samplePixels(dataUrl);
  const clusters = glassColor.quantize(samples, 6, 10);
  return glassColor.pickAccent(clusters);
}

/* ── settings row dictionaries ────────────────────────────────────── */

const zh = {
  "glass.title": "背景图",
  "glass.choose": "选择图片",
  "glass.remove": "移除",
  "glass.blur": "毛玻璃强度",
  "glass.hint": "主题色自动取自背景图，组件呈毛玻璃效果",
  "glass.processing": "正在处理图片…",
  "glass.error.decode": "图片解码失败：请换一张图片（如 JPG/PNG/WebP）",
  "glass.error.write": "保存到浏览器存储失败（图片过大或隐私模式）"
};
const en = {
  "glass.title": "Background",
  "glass.choose": "Choose image",
  "glass.remove": "Remove",
  "glass.blur": "Frosted blur",
  "glass.hint": "Theme colors are extracted from the image; surfaces render frosted glass",
  "glass.processing": "Processing image…",
  "glass.error.decode": "Image decode failed: try another image (JPG/PNG/WebP)",
  "glass.error.write": "Failed to persist to browser storage (image too large or private mode)"
};

/* ── settings row store ───────────────────────────────────────────── */

const createRowStore = () => defineStore({
  init: () => ({ image: "", blur: 24, ready: false, status: "", error: "" }),
  actions: {
    sync: (d, value) => {
      d.image = value && typeof value.image === "string" ? value.image : "";
      d.blur = value && typeof value.blur === "number" ? value.blur : 24;
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

const errorStyle = { color: "var(--dsw-alias-state-error-primary)", fontSize: 12 };
const statusStyle = { color: "var(--dsw-alias-label-tertiary)", fontSize: 12 };

function GlassRow({ t, useStore, chooseFile, clearImage, setBlur }) {
  const { image, blur, status, error } = useStore((s) => s);
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
    React.createElement("div", { style: rowLine },
      React.createElement("label", { style: { fontSize: 13 } }, t("glass.blur")),
      React.createElement("input", {
        type: "range",
        min: 0,
        max: 40,
        step: 1,
        value: blur,
        style: { flex: 1, minWidth: 120 },
        onChange: (e) => setBlur(Number(e.target.value))
      }),
      React.createElement("span", { style: { fontSize: 12, minWidth: 30 } }, `${blur}px`)
    ),
    status ? React.createElement("div", { style: statusStyle }, status) : null,
    error ? React.createElement("div", { style: errorStyle }, error) : null,
    React.createElement("div", { style: hintStyle }, t("glass.hint"))
  );
}

/* ── persistence (browser-local: the settings wire boundary only exposes
   the product's hardcoded namespace allowlist, so the skin keeps its own
   state in localStorage) ─────────────────────────────────────────── */

const STORAGE_KEY = "dsh-skin-glass:v1";

function readStored() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { image: "", blur: 24 };
    const parsed = JSON.parse(raw);
    return {
      image: typeof parsed.image === "string" ? parsed.image : "",
      blur: typeof parsed.blur === "number" ? parsed.blur : 24
    };
  } catch (_read) {
    return { image: "", blur: 24 };
  }
}

function writeStored(value) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
}

/* ── plugin body ──────────────────────────────────────────────────── */

const inject = ["slots", "locale", "theme"];

function apply(ctx) {
  ensureChromeTag();

  const store = createRowStore();
  let stored = readStored();
  let bound;
  let tokenDisposer = null;
  let applySeq = 0;

  const syncRow = () => {
    if (!bound) return;
    bound.sync(stored);
  };

  /** Re-render the glass chrome and (re)apply the token layer. */
  const refresh = (value) => {
    const image = value && typeof value.image === "string" ? value.image : "";
    const blur = value && typeof value.blur === "number" ? value.blur : 24;
    const root = document.documentElement;
    const escaped = image.replace(/"/g, '\\"');
    root.style.setProperty("--dsh-glass-image", image ? `url("${escaped}")` : "none");
    root.style.setProperty("--dsh-glass-blur", `${blur}px`);
    if (!image) {
      if (tokenDisposer) {
        tokenDisposer();
        tokenDisposer = null;
      }
      return;
    }
    const seq = ++applySeq;
    extractAccent(image).then((accent) => {
      if (seq !== applySeq) return;
      tokenDisposer = ctx.theme.overrideTokens("dsh-skin-glass", glassColor.buildTokens(accent));
    }).catch((err) => {
      if (seq !== applySeq) return;
      console.error("[dsh-skin-glass] extractAccent failed:", err);
      bound && bound.error("glass.error.decode");
    });
  };

  // initial application from persisted state
  refresh(stored);
  console.log("[dsh-skin-glass] ready:", JSON.stringify({
    image: stored.image ? "set" : "none",
    blur: stored.blur,
    theme: typeof ctx.theme.overrideTokens === "function"
  }));

  ctx.effect(() => {
    return () => {
      if (tokenDisposer) tokenDisposer();
      tokenDisposer = null;
      const root = document.documentElement;
      root.style.removeProperty("--dsh-glass-image");
      root.style.removeProperty("--dsh-glass-blur");
    };
  }, "dsh-skin-glass: token layer");

  ctx.effect(() => ctx.locale.register(GLASS_NS, { zh, en }), "dsh-skin-glass: row dictionaries");

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
            stored = { ...stored, image: dataUrl };
            try {
              writeStored(stored);
            } catch (err) {
              console.error("[dsh-skin-glass] persist failed:", err);
              bound.status("");
              bound.error("glass.error.write");
              return;
            }
            bound.status("");
            bound.error("");
            syncRow();
            refresh(stored);
          }).catch((err) => {
            console.error("[dsh-skin-glass] chooseFile failed:", err);
            bound.status("");
            bound.error("glass.error.decode");
          });
        },
        clearImage: () => {
          stored = { ...stored, image: "" };
          try {
            writeStored(stored);
          } catch (err) {
            console.error("[dsh-skin-glass] persist failed:", err);
          }
          syncRow();
          refresh(stored);
        },
        setBlur: (v) => {
          stored = { ...stored, blur: Math.round(v) };
          try {
            writeStored(stored);
          } catch (err) {
            console.error("[dsh-skin-glass] persist failed:", err);
          }
          syncRow();
          refresh(stored);
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
