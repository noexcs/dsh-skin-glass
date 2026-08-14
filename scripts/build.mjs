/* dsh-skin-glass — scripts/build.mjs
 * Compose lib/client.js from src/color.cjs (bundle-only tail stripped) and
 * src/main.js inside the __ModuleLoader__.load factory wrapper.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const color = readFileSync(join(root, "src/color.cjs"), "utf8").replace(/\n\/\/#bundle-only\nmodule\.exports = glassColor;\s*$/, "");
const main = readFileSync(join(root, "src/main.js"), "utf8");

if (color.includes("//#bundle-only")) throw new Error("color.cjs bundle-only tail not stripped");
if (main.includes("</script")) throw new Error("main.js contains </script>");

const bundle = `window.__ModuleLoader__.load({
\tid: "dsh-skin-glass",
\tfactory: (require) => {
\t\tvar module = { exports: {} };
\t\tvar exports = module.exports;
\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

${color}

${main}
\t\treturn module.exports;
\t}
});
`;

writeFileSync(join(root, "lib/client.js"), bundle);
// byte length, not string length: the i18n dictionaries are CJK, so the two differ
console.log(`built lib/client.js (${Buffer.byteLength(bundle, "utf8")} bytes)`);
