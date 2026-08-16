/* dsh-skin-glass — scripts/check-token-parity.mjs
 * Pins buildTokens output to the exact values captured in the fixture
 * (scripts/check-token-parity.fixture.json), so any refactor of the token
 * table — like the tier A/B/C table-driven rewrite — is provably
 * value-identical, not just "passed the contrast harness".
 *
 * The fixture was generated from the pre-refactor src/color.cjs over the
 * grid: 5 accents × 5 translucency steps × 3 blur values × 8 wallpaper
 * profiles. To regenerate it (only after a DELIBERATE value change):
 *   node /tmp/make-fixture.mjs <color.cjs> <fixture path>
 *
 * Run: node scripts/check-token-parity.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const glassColor = require(join(root, "src", "color.cjs"));

const ACCENTS = {
  indigo: [99, 102, 241],
  crimson: [206, 44, 62],
  olive: [122, 138, 62],
  slate: [110, 118, 132],
  cyan: [46, 190, 205]
};
const PROFILES = [
  undefined,
  { meanL: 0, stdL: 0 }, { meanL: 1, stdL: 0 },
  { meanL: 0.2, stdL: 0.18 }, { meanL: 0.8, stdL: 0.18 },
  { meanL: 0.5, stdL: 0.06 }, { meanL: 0.5, stdL: 0.25 }, { meanL: 0.5, stdL: 0.5 }
];

const fixture = JSON.parse(readFileSync(join(root, "scripts", "check-token-parity.fixture.json"), "utf8"));
const failures = [];
let compared = 0;

for (const entry of fixture) {
  const tokens = glassColor.buildTokens(ACCENTS[entry.accent], {
    t: entry.t,
    blurPx: entry.blurPx,
    wallpaper: entry.profile === null ? undefined : PROFILES[entry.profile]
  });
  // compare per token name: key order is irrelevant, the VALUES are the pin
  const expected = entry.tokens;
  for (const name of Object.keys(expected)) {
    compared += 1;
    const got = tokens[name];
    const want = expected[name];
    if (got === undefined || got.light !== want.light || got.dark !== want.dark) {
      failures.push(
        `${name} [${entry.accent} t=${entry.t} blur=${entry.blurPx} profile=${entry.profile}]\n` +
        `  expected ${JSON.stringify(want)}\n  got      ${JSON.stringify(got)}`
      );
    }
  }
  const extra = Object.keys(tokens).filter((n) => expected[n] === undefined);
  for (const name of extra) {
    failures.push(`${name} [${entry.accent} t=${entry.t}] is new — not in the fixture`);
  }
}

console.log(`${compared} token-pair comparisons across ${fixture.length} buildTokens outputs`);
if (failures.length > 0) {
  console.error(`\nFAIL (${failures.length}):`);
  for (const f of failures.slice(0, 10)) console.error("  " + f);
  process.exit(1);
}
console.log("PASS — token output is value-identical to the pre-refactor fixture");
