// Validates the 4-locale rule: messages/{en,ur,hi,bn}.json must share an
// identical key shape, and every `{placeholder}` must match across locales.
// Run: node scripts/validate-i18n.mjs (also wired as npm run i18n:validate)
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const LOCALES = ["en", "ur", "hi", "bn"];

function flatten(obj, prefix = "", out = new Map()) {
  if (obj !== null && typeof obj === "object" && !Array.isArray(obj)) {
    const entries = Object.entries(obj);
    if (entries.length === 0) out.set(prefix, obj);
    for (const [k, v] of entries) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  } else {
    out.set(prefix, obj);
  }
  return out;
}

function placeholders(value) {
  if (typeof value !== "string") return [];
  return [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
}

const dicts = new Map();
for (const locale of LOCALES) {
  const raw = readFileSync(join(root, "messages", `${locale}.json`), "utf8");
  dicts.set(locale, flatten(JSON.parse(raw)));
}

const en = dicts.get("en");
let errors = 0;
const fail = (msg) => {
  errors += 1;
  console.error(`i18n error: ${msg}`);
};

for (const locale of LOCALES) {
  if (locale === "en") continue;
  const dict = dicts.get(locale);
  for (const key of en.keys()) {
    if (!dict.has(key)) fail(`missing key "${key}" in ${locale}`);
  }
  for (const key of dict.keys()) {
    if (!en.has(key)) fail(`extra key "${key}" in ${locale} (not in en)`);
  }
  for (const [key, enValue] of en.entries()) {
    if (!dict.has(key)) continue;
    const other = dict.get(key);
    if (typeof enValue !== typeof other) {
      fail(`type mismatch at "${key}": en is ${typeof enValue}, ${locale} is ${typeof other}`);
      continue;
    }
    const a = placeholders(enValue).join(",");
    const b = placeholders(other).join(",");
    if (a !== b) fail(`placeholder mismatch at "${key}": en={${a}} ${locale}={${b}}`);
  }
}

if (errors > 0) {
  console.error(`i18n validation failed with ${errors} error(s).`);
  process.exit(1);
}
console.log(`i18n OK: ${en.size} keys identical across ${LOCALES.join(", ")}.`);
