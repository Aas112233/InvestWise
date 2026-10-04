// Phase 5 i18n sync: backfills every t("...") reference whose key was missing
// from the dictionaries, so no screen silently falls back to its English
// defaultValue in ur/hi/bn.
//
// English is taken verbatim from docs/i18n-missing-keys.json, which is produced
// by scripts/extract-missing-keys.mjs straight from the `defaultValue` literals
// in the components — so the backfilled copy is exactly what the UI renders today.
//
// ur/hi/bn come from docs/.i18n-tmp/<locale>.json.
//
// Re-runnable (deep merge, never deletes). A durable record of everything this
// script added is written to docs/i18n-phase5-added.json.
//
// Run: node scripts/phase5-i18n.mjs
// Validate after: node scripts/validate-i18n.mjs && node scripts/audit-i18n.mjs
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const LOCALES = ["en", "ur", "hi", "bn"];
const TMP = join(root, "docs", ".i18n-tmp");

function deepMerge(target, source) {
  for (const [key, value] of Object.entries(source)) {
    if (
      value !== null && typeof value === "object" && !Array.isArray(value) &&
      target[key] !== null && typeof target[key] === "object" && !Array.isArray(target[key])
    ) {
      deepMerge(target[key], value);
    } else {
      target[key] = value;
    }
  }
  return target;
}

/** "a.b.c" -> { a: { b: { c: value } } } */
function nest(path, value) {
  const parts = path.split(".");
  let node = {};
  let cur = node;
  for (let i = 0; i < parts.length - 1; i++) {
    cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
  return node;
}

// ---- load inputs
const missing = JSON.parse(readFileSync(join(root, "docs", "i18n-missing-keys.json"), "utf8"));
const keyList = Object.keys(missing);
if (keyList.length === 0) {
  console.log("nothing to add: docs/i18n-missing-keys.json is empty");
  process.exit(0);
}

const payloads = { en: {} };
for (const locale of LOCALES) {
  if (locale === "en") continue;
  const p = join(TMP, `${locale}.json`);
  if (!existsSync(p)) {
    console.error(`missing translation payload: ${p}`);
    process.exit(1);
  }
  payloads[locale] = JSON.parse(readFileSync(p, "utf8"));
}

// ---- integrity gate: all locales must carry exactly the same key set
const want = keyList.slice().sort();
for (const locale of LOCALES) {
  if (locale === "en") continue;
  const got = Object.keys(payloads[locale]).sort();
  const missingKeys = want.filter((k) => !got.includes(k));
  const extra = got.filter((k) => !want.includes(k));
  if (missingKeys.length || extra.length) {
    console.error(`i18n payload mismatch for ${locale}:`);
    if (missingKeys.length) console.error(`  missing (${missingKeys.length}): ${missingKeys.slice(0, 8).join(", ")}`);
    if (extra.length) console.error(`  extra (${extra.length}): ${extra.slice(0, 8).join(", ")}`);
    process.exit(1);
  }
}

// ---- merge
const existing = {};
for (const locale of LOCALES) {
  existing[locale] = JSON.parse(readFileSync(join(root, "messages", `${locale}.json`), "utf8"));
}

const added = { en: {}, ur: {}, hi: {}, bn: {} };
for (const locale of LOCALES) {
  const payload = locale === "en"
    ? Object.fromEntries(keyList.map((k) => [k, missing[k].en]))
    : payloads[locale];
  for (const [k, v] of Object.entries(payload)) {
    added[locale][k] = v;
    deepMerge(existing[locale], nest(k, v));
  }
}

for (const locale of LOCALES) {
  writeFileSync(join(root, "messages", `${locale}.json`), `${JSON.stringify(existing[locale], null, 2)}\n`, "utf8");
}

// durable record
const record = {
  appliedAt: new Date().toISOString(),
  keyCount: keyList.length,
  source: "scripts/extract-missing-keys.mjs (defaultValue literals from components)",
  keys: keyList,
  values: added,
};
mkdirSync(join(root, "docs"), { recursive: true });
writeFileSync(join(root, "docs", "i18n-phase5-added.json"), `${JSON.stringify(record, null, 2)}\n`, "utf8");

console.log(`phase5 i18n: added ${keyList.length} keys across ${LOCALES.length} locales (${keyList.length * LOCALES.length} strings).`);
console.log(`record: docs/i18n-phase5-added.json`);
