// Validates the 4-locale rule: messages/{en,ur,hi,bn}.json must share an
// identical key shape, every `{placeholder}` must match across locales, and
// every literal t("key") used in the UI must exist in en. Without the last
// check a screen can call t() on a missing key, silently render its English
// defaultValue, and still pass parity — which is how the whole meetings
// module shipped English-only.
// Run: node scripts/validate-i18n.mjs (also wired as npm run i18n:validate)
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const LOCALES = ["en", "ur", "hi", "bn"];
const UI_ROOTS = ["app", "components", "lib", "client"];

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

function sourceFiles(abs, acc = []) {
  if (!existsSync(abs)) return acc;
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    const child = join(abs, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") sourceFiles(child, acc);
    } else if (/\.tsx?$/.test(entry.name) && !entry.name.includes(".test.")) {
      acc.push(child);
    }
  }
  return acc;
}

// Dynamic keys (t(`a.${x}`) / t(prefix + k)) are skipped on purpose: they
// always pass a defaultValue fallback and cannot be resolved statically.
const enKeys = new Set(en.keys());
for (const file of UI_ROOTS.flatMap((dir) => sourceFiles(join(root, dir)))) {
  const rel = file.slice(root.length + 1).split(sep).join("/");
  const src = readFileSync(file, "utf8");
  for (const m of src.matchAll(/\bt\(\s*["']([a-zA-Z][\w.]*)["']/g)) {
    if (!enKeys.has(m[1])) fail(`t("${m[1]}") in ${rel} has no entry in en.json`);
  }
}

if (errors > 0) {
  console.error(`i18n validation failed with ${errors} error(s).`);
  process.exit(1);
}
console.log(`i18n OK: ${en.size} keys identical across ${LOCALES.join(", ")}.`);
