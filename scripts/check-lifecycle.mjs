/* dsh-skin-glass — scripts/check-lifecycle.mjs
 * Tests for the plugin body's state machine in src/main.js: persistence,
 * normalization, and when a picked image is (re)analyzed.
 *
 * The detector has check-surfaces.mjs; this covers the other half — the part
 * that decides *what the token layer is built from*. It caught a real bug:
 * the image analysis was cached but never keyed on the image, so choosing a
 * second wallpaper kept the first one's extracted accent forever.
 *
 * Same technique as check-surfaces.mjs: src/main.js is evaluated against a
 * stubbed browser, with analyzeImage swapped for a recording stub so the
 * canvas/decode path stays out of it.
 *
 * Run: node scripts/check-lifecycle.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/* ── assertions ───────────────────────────────────────────────────── */

const failures = [];
let ran = 0;

function check(name, actual, expected) {
  ran += 1;
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) failures.push(`${name}: expected ${e}, got ${a}`);
}

/* ── stubbed browser ──────────────────────────────────────────────── */

/**
 * Boot the plugin against a fresh stub world.
 * @returns handles onto the recorded side effects.
 */
function boot({ storage = null } = {}) {
  const analyzed = [];       // every image string handed to analyzeImage
  const built = [];          // every accent handed to buildTokens
  const rootProps = new Map();
  const rootAttrs = new Set();
  const persisted = { value: storage };

  const noopEl = () => ({
    dataset: {}, style: { cssText: "" }, id: "", innerHTML: "",
    setAttribute() {}, appendChild() {}, remove() {},
    getContext: () => ({ fillRect() {}, drawImage() {}, getImageData: () => ({ data: [] }) })
  });

  const bodyEl = {
    nodeType: 1, isConnected: true, children: [], parentElement: null,
    hasAttribute: () => false, getAttribute: () => null,
    setAttribute() {}, removeAttribute() {},
    getBoundingClientRect: () => ({ width: 0, height: 0 }),
    style: { backgroundColor: "", setProperty() {}, removeProperty() {} }
  };

  const sandbox = {
    require: (name) => {
      if (name === "react") return { createElement: () => null, useRef: () => ({}) };
      if (name === "@deepseek-ai/dsh-client-runtime/client") return { defineStore: (d) => d };
      throw new Error("unexpected require: " + name);
    },
    glassColor: {
      quantize: () => [],
      pickAccent: () => [0, 0, 0],
      analyzeWallpaper: () => ({ meanL: 0.5, stdL: 0.1 }),
      nestedTintScale: () => 1,
      buildTokens: (accent) => { built.push(accent); return {}; }
    },
    CSS: { supports: () => false },
    getComputedStyle: () => ({
      backgroundColor: "rgba(0, 0, 0, 0)", position: "static", color: "",
      getPropertyValue: () => ""
    }),
    innerWidth: 1440, innerHeight: 900,
    document: {
      documentElement: {
        style: {
          setProperty: (k, v) => rootProps.set(k, v),
          removeProperty: (k) => rootProps.delete(k)
        },
        setAttribute: (k) => rootAttrs.add(k),
        removeAttribute: (k) => rootAttrs.delete(k)
      },
      body: bodyEl,
      head: { appendChild() {} },
      createElement: noopEl,
      querySelector: () => null,
      querySelectorAll: () => [],
      getElementById: () => null
    },
    requestIdleCallback: (fn) => fn(),
    MutationObserver: function () { this.observe = () => {}; this.disconnect = () => {}; },
    matchMedia: null,
    console: { log() {}, error() {} },
    localStorage: {
      getItem: () => persisted.value,
      setItem: (_k, v) => { persisted.value = v; }
    },
    Image: function () {},
    URL: { createObjectURL: () => "blob:stub", revokeObjectURL() {} },
    analyzed
  };

  // Replace the decode/canvas path: processImageFile becomes identity (so a
  // test can hand in a plain string) but still rejects for the "!bad"
  // sentinel, which is where a real decode failure surfaces; analyzeImage
  // records what it was asked to look at.
  const source = readFileSync(join(root, "src/main.js"), "utf8")
    .replace(
      /async function processImageFile\(file\) \{[\s\S]*?\n\}/,
      "async function processImageFile(file){ " +
      "if (file === '!bad') throw new Error('image decode failed'); return file; }"
    )
    .replace(
      /async function analyzeImage\(dataUrl\) \{[\s\S]*?\n\}/,
      "async function analyzeImage(dataUrl){ analyzed.push(dataUrl); " +
      "return { accent: [dataUrl.length, 0, 0], wallpaper: { meanL: 0.5, stdL: 0.1 } }; }"
    );

  const factory = new Function(
    ...Object.keys(sandbox), "exports", "module",
    `${source}\n;return { apply, normalize, DEFAULTS };`
  );
  const api = factory(...Object.values(sandbox), {}, { exports: {} });

  const errors = [];
  let actions = null;
  const rowState = {};
  const ctx = {
    effect: (fn) => fn(),
    theme: { overrideTokens: () => () => {} },
    locale: { register: () => () => {} },
    slots: {
      inject: (_name, fn) => fn(),
      register: (cfg) => {
        actions = cfg.inject({
          sync: (v) => Object.assign(rowState, v),
          status: () => {},
          error: (code) => errors.push(code)
        });
      }
    }
  };
  api.apply(ctx);
  return { api, actions, analyzed, built, rootProps, rootAttrs, persisted, errors, rowState };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

/* ── normalization / migration ────────────────────────────────────── */

{
  const { api } = boot();
  const { normalize, DEFAULTS } = api;
  check("normalize fills an empty record", normalize({}), DEFAULTS);
  check("normalize tolerates null", normalize(null), DEFAULTS);
  check("normalize tolerates a non-object", normalize(7), DEFAULTS);
  // this is the migration path for records written before translucency existed
  check("a pre-translucency record takes the default",
    normalize({ image: "x", blur: 30 }),
    { image: "x", blur: 30, translucency: DEFAULTS.translucency });
  check("wrong types fall back per field",
    normalize({ image: 5, blur: "30", translucency: NaN }), DEFAULTS);
  check("valid values survive",
    normalize({ image: "d", blur: 4, translucency: 0.9 }),
    { image: "d", blur: 4, translucency: 0.9 });
}

/* ── persisted state is read at boot ──────────────────────────────── */

{
  const stored = JSON.stringify({ image: "AAA", blur: 30, translucency: 0.8 });
  const { rowState, rootProps, rootAttrs } = boot({ storage: stored });
  check("boot restores the persisted record", rowState,
    { image: "AAA", blur: 30, translucency: 0.8 });
  check("boot gates the chrome stylesheet on the attribute", rootAttrs.has("data-dsh-glass"), true);
  check("boot publishes the wallpaper blur", rootProps.get("--dsh-glass-blur"), "30px");
  // surfaces blur their backdrop less than the wallpaper does
  check("boot publishes the surface blur", rootProps.get("--dsh-surface-blur"), "21px");
}

{
  const { rowState, rootAttrs } = boot({ storage: "{not json" });
  check("a corrupt record falls back to defaults", rowState.image, "");
  check("and leaves the native theme untouched", rootAttrs.has("data-dsh-glass"), false);
}

/* ── image analysis is keyed on the image ─────────────────────────────
   The regression this file was written for: the analysis was cached in a
   plain `imageCache` truthiness check, so the *second* wallpaper a user
   picked reused the first one's extracted accent and the theme colours
   never changed. */

{
  const { actions, analyzed, built } = boot();
  await actions.chooseFile("AAAA");
  await settle();
  check("the first image is analyzed", analyzed, ["AAAA"]);
  check("and its accent builds the tokens", built.at(-1), [4, 0, 0]);

  await actions.chooseFile("BBBBBBBB");
  await settle();
  check("a different image is analyzed too", analyzed, ["AAAA", "BBBBBBBB"]);
  check("and the tokens follow the new image", built.at(-1), [8, 0, 0]);
}

{
  const { actions, analyzed, built } = boot();
  await actions.chooseFile("AAAA");
  await settle();
  const afterImage = built.length;

  // a slider move must reuse the analysis: re-decoding on every drag frame is
  // exactly what the cache is for
  actions.setBlur(30);
  actions.setTranslucency(0.9);
  await settle();
  check("blur/translucency changes never re-analyze", analyzed, ["AAAA"]);
  check("but they do rebuild the token layer", built.length > afterImage, true);
  check("reusing the cached accent", built.at(-1), [4, 0, 0]);
}

{
  const { actions, analyzed, rootAttrs, rootProps } = boot();
  await actions.chooseFile("AAAA");
  await settle();
  actions.clearImage();
  await settle();
  check("clearing ungates the chrome stylesheet", rootAttrs.has("data-dsh-glass"), false);
  check("and blanks the image variable", rootProps.get("--dsh-glass-image"), "none");

  // the same image again must be re-analyzed: the cache was dropped with it
  await actions.chooseFile("AAAA");
  await settle();
  check("re-picking the cleared image re-analyzes", analyzed, ["AAAA", "AAAA"]);
}

/* ── persistence ──────────────────────────────────────────────────── */

{
  const { actions, persisted } = boot();
  await actions.chooseFile("AAAA");
  actions.setBlur(30.4);
  actions.setTranslucency(1.8);
  await settle();
  check("the record is written back", JSON.parse(persisted.value),
    { image: "AAAA", blur: 30, translucency: 1 });
  check("blur is rounded to whole pixels", JSON.parse(persisted.value).blur, 30);
  check("translucency is clamped to 0..1", JSON.parse(persisted.value).translucency, 1);
}

/* ── failure paths ────────────────────────────────────────────────────
   An image that will not decode is reported to the row and changes nothing:
   the previous wallpaper (here, none) stays exactly as it was. */

{
  const { actions, errors, analyzed, rootAttrs } = boot();
  await actions.chooseFile("!bad");
  await settle();
  check("a decode failure reaches the row", errors.at(-1), "glass.error.decode");
  check("nothing was analyzed", analyzed, []);
  check("and the skin stays ungated", rootAttrs.has("data-dsh-glass"), false);
}

{
  // a decode failure must not disturb a wallpaper that is already applied
  const { actions, errors, rootAttrs, rootProps } = boot();
  await actions.chooseFile("AAAA");
  await settle();
  await actions.chooseFile("!bad");
  await settle();
  check("a later decode failure is reported", errors.at(-1), "glass.error.decode");
  check("the existing wallpaper survives it", rootAttrs.has("data-dsh-glass"), true);
  check("and still points at the good image", rootProps.get("--dsh-glass-image"), 'url("AAAA")');
}

/* ── report ───────────────────────────────────────────────────────── */

console.log(`${ran} lifecycle assertions`);
if (failures.length > 0) {
  console.error(`\nFAIL (${failures.length}):`);
  for (const f of failures) console.error("  " + f);
  process.exit(1);
}
console.log("PASS — state normalizes, persists, and re-analyzes only when the image changes");
