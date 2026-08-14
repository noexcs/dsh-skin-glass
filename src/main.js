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
  "filter:blur(2px) saturate(1.15)}",
  "#root > div{backdrop-filter:blur(var(--dsh-glass-blur,18px)) saturate(1.35)}"
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
  init: () => ({ image: "", blur: 18, ready: false, status: "", error: "" }),
  actions: {
    sync: (d, value) => {
      d.image = value && typeof value.image === "string" ? value.image : "";
      d.blur = value && typeof value.blur === "number" ? value.blur : 18;
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
        max: 48,
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
    if (!raw) return { image: "", blur: 18 };
    const parsed = JSON.parse(raw);
    return {
      image: typeof parsed.image === "string" ? parsed.image : "",
      blur: typeof parsed.blur === "number" ? parsed.blur : 18
    };
  } catch (_read) {
    return { image: "", blur: 18 };
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
  let accentCache = null;
  let applySeq = 0;

  const syncRow = () => {
    if (!bound) return;
    bound.sync(stored);
  };

  /** Apply (or re-apply) the token layer with the cached accent + current frost. */
  const applyTokens = () => {
    if (!accentCache) return;
    tokenDisposer = ctx.theme.overrideTokens("dsh-skin-glass", glassColor.buildTokens(accentCache, stored.blur / 48));
  };

  /** Re-render the glass chrome and (re)apply the token layer. */
  const refresh = (value) => {
    const image = value && typeof value.image === "string" ? value.image : "";
    const blur = value && typeof value.blur === "number" ? value.blur : 18;
    const root = document.documentElement;
    const escaped = image.replace(/"/g, '\\"');
    root.style.setProperty("--dsh-glass-image", image ? `url("${escaped}")` : "none");
    root.style.setProperty("--dsh-glass-blur", `${blur}px`);
    if (!image) {
      accentCache = null;
      if (tokenDisposer) {
        tokenDisposer();
        tokenDisposer = null;
      }
      return;
    }
    if (accentCache) {
      applyTokens();   // blur-only change: same accent, new frost
      return;
    }
    const seq = ++applySeq;
    extractAccent(image).then((accent) => {
      if (seq !== applySeq) return;
      accentCache = accent;
      applyTokens();
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
