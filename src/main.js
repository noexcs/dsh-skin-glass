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
  "glass.hint": "主题色自动取自背景图，组件呈毛玻璃效果"
};
const en = {
  "glass.title": "Background",
  "glass.choose": "Choose image",
  "glass.remove": "Remove",
  "glass.blur": "Frosted blur",
  "glass.hint": "Theme colors are extracted from the image; surfaces render frosted glass"
};

/* ── settings row store ───────────────────────────────────────────── */

const createRowStore = () => defineStore({
  init: () => ({ image: "", blur: 24, ready: false }),
  actions: {
    sync: (d, value) => {
      d.image = value && typeof value.image === "string" ? value.image : "";
      d.blur = value && typeof value.blur === "number" ? value.blur : 24;
      d.ready = true;
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

function GlassRow({ t, useStore, chooseFile, clearImage, setBlur }) {
  const { image, blur } = useStore((s) => s);
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
    React.createElement("div", { style: hintStyle }, t("glass.hint"))
  );
}

/* ── plugin body ──────────────────────────────────────────────────── */

const inject = ["slots", "locale", "settingsScope", "theme"];

function apply(ctx) {
  ensureChromeTag();

  const scope = ctx.settingsScope.bind({ namespace: GLASS_NS });
  const store = createRowStore();
  let bound;
  let tokenDisposer = null;
  let applySeq = 0;

  const syncRow = () => {
    if (!bound) return;
    const snap = scope.getSnapshot();
    bound.sync(snap.value);
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
    }).catch(() => {});
  };

  const onScope = () => {
    const snap = scope.getSnapshot();
    syncRow();
    refresh(snap.value);
  };

  ctx.effect(() => {
    const disposers = [
      scope.subscribe(onScope),
      () => {
        if (tokenDisposer) tokenDisposer();
        tokenDisposer = null;
        const root = document.documentElement;
        root.style.removeProperty("--dsh-glass-image");
        root.style.removeProperty("--dsh-glass-blur");
      }
    ];
    scope.load();
    return () => {
      for (const dispose of disposers) dispose();
    };
  }, "dsh-skin-glass: scope bind + token layer");

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
          processImageFile(file).then((dataUrl) => scope.set("image", dataUrl)).catch(() => {});
        },
        clearImage: () => scope.set("image", ""),
        setBlur: (v) => scope.set("blur", Math.round(v))
      };
    }
  }, GlassRow));
}

exports.apply = apply;
exports.inject = inject;
