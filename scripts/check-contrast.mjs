/* dsh-skin-glass — scripts/check-contrast.mjs
 * Guards the invariant the tiered-translucency design rests on: for every
 * translucency setting, every accent, and the *worst possible* wallpaper
 * (pure black or pure white), body text composited over each surface still
 * clears WCAG AA.
 *
 * The compositing chain mirrors what the browser paints:
 *   wallpaper → scrim → [modal mask] → surface → text
 * Run: node scripts/check-contrast.mjs
 */
import { createRequire } from "node:module";

const glassColor = createRequire(import.meta.url)("../src/color.cjs");

const AA = 4.5;
const ACCENTS = {
  indigo: [99, 102, 241],
  crimson: [206, 44, 62],
  olive: [122, 138, 62],
  slate: [110, 118, 132],
  cyan: [46, 190, 205]
};

/**
 * Wallpaper profiles. Since the scrim is now sized from the image's own
 * brightness profile, a test may not hand the skin one profile and then
 * composite against a backdrop from a different one — that would grade the
 * skin against a wallpaper it was never told about. So each profile carries
 * both the stats the skin sees and the worst local backdrop that profile can
 * actually produce.
 *
 * The chrome layer blurs the wallpaper, which pulls extreme pixels toward the
 * mean, so the worst local patch is bounded at mean ± 2σ rather than at the
 * image's absolute min/max.
 */
const SIGMA = 2;
const PROFILES = [
  { name: "uniform black", meanL: 0, stdL: 0 },
  { name: "uniform white", meanL: 1, stdL: 0 },
  { name: "dark busy photo", meanL: 0.2, stdL: 0.18 },
  { name: "bright busy photo", meanL: 0.8, stdL: 0.18 },
  { name: "mid flat", meanL: 0.5, stdL: 0.06 },
  { name: "mid high-contrast", meanL: 0.5, stdL: 0.25 },
  { name: "pathological", meanL: 0.5, stdL: 0.5 }
];

const clamp01 = (v) => Math.max(0, Math.min(1, v));

/** The darkest and brightest local patches a profile can present after blur. */
function extremes(profile) {
  return [
    clamp01(profile.meanL - SIGMA * profile.stdL),
    clamp01(profile.meanL + SIGMA * profile.stdL)
  ].map((l) => [l * 255, l * 255, l * 255]);
}

/** Parse "rgba(r, g, b, a)" / "rgb(r, g, b)" into { rgb, a }. */
function parse(value) {
  const m = /^rgba?\(([^)]+)\)$/.exec(value.trim());
  if (m === null) return null;
  const parts = m[1].split(",").map((s) => Number(s.trim()));
  if (parts.slice(0, 3).some((n) => !Number.isFinite(n))) return null;
  return { rgb: parts.slice(0, 3), a: parts.length > 3 ? parts[3] : 1 };
}

/** Paint `src` (with its alpha) over the opaque `dst`. */
function over(src, dst) {
  const s = parse(src);
  if (s === null) throw new Error(`unparseable color: ${src}`);
  return s.rgb.map((c, i) => s.a * c + (1 - s.a) * dst[i]);
}

function luminance([r, g, b]) {
  const f = (v) => {
    const n = v / 255;
    return n <= 0.03928 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(fg, bg) {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Surfaces that carry body text.
 *
 * `mask` is a modal scrim painted under the surface. `parent` names the
 * surface this one is normally painted *inside* — the detector scales a
 * nested fill's alpha (glassColor.nestedTintScale) so it tints its parent
 * rather than thickening it, so a nested surface must be graded on the stack
 * the browser will actually paint: parent at full alpha, then this one
 * scaled. Grading it standalone would model a composite that never occurs.
 *
 * Surfaces that appear in both roles are listed twice.
 */
const READING_SURFACES = [
  { token: "--dsw-alias-bg-base", label: "chat background (assistant text)" },
  { token: "--dsw-specific-sidebar-fill", label: "sidebar" },
  { token: "--dsw-alias-bg-layer-1", label: "layer-1 panel (trajectory)" },
  { token: "--dsw-alias-bg-layer-2", label: "settings panel / dialog", mask: "--dsw-alias-bg-mask-1" },
  { token: "--dsw-alias-bg-layer-3", label: "layer-3" },
  { token: "--dsw-alias-bg-overlay", label: "overlay" },
  { token: "--dsw-specific-menu", label: "dropdown menu" },
  { token: "--dsw-specific-bubble", label: "user bubble", parent: "--dsw-alias-bg-base" },
  { token: "--dsw-specific-input-major", label: "composer input", parent: "--dsw-alias-bg-base" },
  { token: "--dsw-alias-markdown-code-block", label: "code block", parent: "--dsw-alias-bg-base" },
  { token: "--dsw-alias-markdown-inline-code", label: "inline code", parent: "--dsw-alias-bg-base" },
  { token: "--dsw-specific-selector", label: "selector", parent: "--dsw-alias-bg-base" },
  { token: "--dsw-specific-tip", label: "tip", parent: "--dsw-alias-bg-base" },
  // the trajectory rows: a tinted fill inside the layer-1 panel
  { token: "--dsw-alias-bg-module-platform", label: "trajectory row", parent: "--dsw-alias-bg-layer-1" },
  { token: "--dsw-alias-markdown-code-block", label: "payload in trajectory", parent: "--dsw-alias-bg-layer-1" }
];

/** Reading tiers must never drop below this alpha, whatever the setting. */
const ALPHA_FLOOR = 0.64;
const FLOOR_EXEMPT = new Set(["--dsw-alias-bg-base", "--dsw-specific-sidebar-fill"]);

const failures = [];
let checks = 0;

/** Re-express a colour at a fraction of its alpha, as the detector does. */
function scaleAlpha(color, scale) {
  const c = parse(color);
  return `rgba(${c.rgb.join(", ")}, ${Math.round(c.a * scale * 1000) / 1000})`;
}

/** Composite body text over one surface for one wallpaper patch. */
function evaluate(tokens, surface, mode, patch, t) {
  const text = parse(tokens["--dsw-alias-label-primary"][mode]).rgb;
  let backdrop = over(tokens["--dsh-glass-scrim"][mode], patch);
  if (surface.mask !== undefined) backdrop = over(tokens[surface.mask][mode], backdrop);
  let fill = tokens[surface.token][mode];
  if (surface.parent !== undefined) {
    backdrop = over(tokens[surface.parent][mode], backdrop);
    fill = scaleAlpha(fill, glassColor.nestedTintScale(t));
  }
  return contrast(text, over(fill, backdrop));
}

for (const [accentName, accent] of Object.entries(ACCENTS)) {
  for (const t of [0, 0.25, 0.45, 0.75, 1]) {
    for (const profile of PROFILES) {
      const tokens = glassColor.buildTokens(accent, {
        t,
        blurPx: 18,
        wallpaper: { meanL: profile.meanL, stdL: profile.stdL }
      });

      // structural guard: any malformed color silently disappears at the
      // CSSOM boundary, so a token that stringifies to undefined/NaN is a
      // bug that would otherwise only show up as "this panel ignores me"
      for (const [name, value] of Object.entries(tokens)) {
        const text = `${value.light}|${value.dark}`;
        if (text.includes("undefined") || text.includes("NaN") || value.light === "" || value.dark === "") {
          failures.push(`malformed token ${name}: ${text}`);
        }
      }

      for (const mode of ["light", "dark"]) {
        for (const surface of READING_SURFACES) {
          const parsed = parse(tokens[surface.token][mode]);
          if (surface.parent === undefined && !FLOOR_EXEMPT.has(surface.token) && parsed.a < ALPHA_FLOOR - 1e-9) {
            failures.push(`alpha floor: ${surface.token} (${mode}) = ${parsed.a} < ${ALPHA_FLOOR}`);
          }

          for (const patch of extremes(profile)) {
            const ratio = evaluate(tokens, surface, mode, patch, t);
            checks += 1;
            if (ratio < AA) {
              failures.push(
                `contrast ${ratio.toFixed(2)}:1 < ${AA} — ${surface.label} [${surface.token}] ` +
                `mode=${mode} accent=${accentName} t=${t} wallpaper="${profile.name}" ` +
                `patch=${Math.round(patch[0])}`
              );
            }
          }
        }
      }
    }
  }
}

// Two things worth eyeballing: the tightest margin anywhere (is the design
// safe?) and how much scrim a friendly image gets away with (is the adaptive
// part actually buying transparency?).
{
  const worstBySurface = new Map();
  for (const [accentName, accent] of Object.entries(ACCENTS)) {
    for (const profile of PROFILES) {
      const tokens = glassColor.buildTokens(accent, { t: 1, blurPx: 18, wallpaper: profile });
      for (const mode of ["light", "dark"]) {
        for (const surface of READING_SURFACES) {
          for (const patch of extremes(profile)) {
            const ratio = evaluate(tokens, surface, mode, patch, 1);
            const prev = worstBySurface.get(surface.label);
            if (prev === undefined || ratio < prev.ratio) {
              worstBySurface.set(surface.label, { ratio, where: `${mode}/${profile.name}/${accentName}` });
            }
          }
        }
      }
    }
  }
  console.log("tightest contrast at full translucency (t=1), across all accents & wallpapers:");
  for (const [label, { ratio, where }] of worstBySurface) {
    console.log(`  ${label.padEnd(34)} ${ratio.toFixed(2)}:1   (${where})`);
  }

  console.log("\nadaptive scrim — strength the wallpaper actually earns at t=1:");
  for (const profile of PROFILES) {
    const tokens = glassColor.buildTokens(ACCENTS.indigo, { t: 1, blurPx: 18, wallpaper: profile });
    const l = parse(tokens["--dsh-glass-scrim"].light).a;
    const d = parse(tokens["--dsh-glass-scrim"].dark).a;
    console.log(`  ${profile.name.padEnd(20)} light ${l.toFixed(2)}   dark ${d.toFixed(2)}`);
  }
}

console.log(`\n${checks} contrast checks across ${Object.keys(ACCENTS).length} accents × 5 translucency steps × ${PROFILES.length} wallpaper profiles × 2 modes × 2 extremes`);
if (failures.length > 0) {
  const unique = [...new Set(failures)];
  console.error(`\nFAIL (${unique.length} distinct):`);
  for (const f of unique.slice(0, 30)) console.error("  " + f);
  process.exit(1);
}
console.log("PASS — every reading surface clears WCAG AA at every setting");
