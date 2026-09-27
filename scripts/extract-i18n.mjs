// One-shot extractor: ports client/i18n/translations.ts (en + bn) into
// messages/{en,bn}.json and seeds messages/{ur,hi}.json with the same key
// shape so the 4-locale rule holds structurally. Placeholders are copied
// verbatim, so they always match across locales.
// Run: node scripts/extract-i18n.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcPath = join(root, "client", "i18n", "translations.ts");
const outDir = join(root, "messages");
mkdirSync(outDir, { recursive: true });

const src = readFileSync(srcPath, "utf8");
const marker = "export const translations =";
const start = src.indexOf(marker);
if (start === -1) throw new Error("translations object not found");
const braceStart = src.indexOf("{", start);
// The object ends right before the trailing `export type Language` declaration.
const tailMarker = "export type Language";
const tail = src.indexOf(tailMarker, braceStart);
if (tail === -1) throw new Error("end marker not found");
const literal = src.slice(braceStart, tail).trim().replace(/;$/, "");

// The source is plain object literals + comments: safe to evaluate as an
// expression in an isolated function scope (no imports executed).
const translations = new Function(`return (${literal});`)();

const en = translations["en"];
const bn = translations["bn"];
if (!en || !bn) throw new Error("expected en + bn locales in source");

// Seed ur/hi from en so key shape + placeholders match exactly. These are
// structural seeds: translators replace values without renaming keys.
const ur = JSON.parse(JSON.stringify(en));
const hi = JSON.parse(JSON.stringify(en));

for (const [name, dict] of Object.entries({ en, bn, ur, hi })) {
  writeFileSync(join(outDir, `${name}.json`), `${JSON.stringify(dict, null, 2)}\n`);
  console.log(`wrote messages/${name}.json`);
}
