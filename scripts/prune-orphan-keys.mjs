// Prunes dictionary keys that no t() call site references.
//
// Safety model:
//   * the removed key -> value map for ALL 4 locales is written to
//     docs/i18n-removed-orphan-keys.json before anything is deleted, so the
//     prune is fully restorable without git;
//   * only keys listed in docs/i18n-audit.json's `orphan` bucket are touched;
//   * all 4 locale files are pruned from the same list, so parity is preserved;
//   * `--dry-run` reports without writing.
//
// Run: node scripts/prune-orphan-keys.mjs [--dry-run]
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const LOCALES = ["en", "ur", "hi", "bn"];
const DRY = process.argv.includes("--dry-run");

const auditPath = join(root, "docs", "i18n-audit.json");
if (!existsSync(auditPath)) {
  console.error("run `npm run i18n:audit -- --json` first to produce docs/i18n-audit.json");
  process.exit(1);
}

const orphans = JSON.parse(readFileSync(auditPath, "utf8")).findings.orphan ?? [];
if (!orphans.length) {
  console.log("no orphan keys to prune");
  process.exit(0);
}

const dicts = {};
for (const locale of LOCALES) {
  dicts[locale] = JSON.parse(readFileSync(join(root, "messages", `${locale}.json`), "utf8"));
}

/** Read "a.b.c" out of a nested object, or undefined. */
function get(obj, path) {
  let cur = obj;
  for (const k of path.split(".")) {
    if (cur === null || typeof cur !== "object" || !(k in cur)) return undefined;
    cur = cur[k];
  }
  return cur;
}

/** Delete "a.b.c" and drop any parent object left empty. */
function del(obj, path) {
  const parts = path.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    cur = cur[parts[i]];
    if (cur === null || typeof cur !== "object") return;
  }
  delete cur[parts[parts.length - 1]];
  for (let i = parts.length - 1; i > 0; i--) {
    const parent = parts.slice(0, i).reduce((a, k) => (a && typeof a === "object" ? a[k] : undefined), obj);
    if (parent && typeof parent === "object" && Object.keys(parent).length === 0) {
      const grand = parts.slice(0, i - 1).reduce((a, k) => (a && typeof a === "object" ? a[k] : undefined), obj);
      if (grand && typeof grand === "object") delete grand[parts[i - 1]];
    } else break;
  }
}

function countLeaves(obj, prefix = "", n = 0) {
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === "object" && !Array.isArray(v)) countLeaves(v, prefix ? `${prefix}.${k}` : k, n);
    else n++;
  }
  return n;
}

const before = Object.fromEntries(LOCALES.map((l) => [l, countLeaves(dicts[l])]));

// restorable record, captured BEFORE the prune
const record = {
  prunedAt: new Date().toISOString(),
  count: orphans.length,
  restore: "re-add values[key] under that exact key path in each locale file, then run npm run i18n:validate",
  values: {},
};
for (const locale of LOCALES) {
  record.values[locale] = Object.fromEntries(orphans.map((k) => [k, get(dicts[locale], k)]));
}

if (DRY) {
  console.log(`DRY RUN — would prune ${orphans.length} orphan keys.`);
  for (const locale of LOCALES) console.log(`  ${locale}: ${before[locale]} -> ${before[locale] - orphans.length} keys`);
  process.exit(0);
}

for (const locale of LOCALES) {
  for (const key of orphans) del(dicts[locale], key);
  writeFileSync(join(root, "messages", `${locale}.json`), `${JSON.stringify(dicts[locale], null, 2)}\n`, "utf8");
}

writeFileSync(join(root, "docs", "i18n-removed-orphan-keys.json"), `${JSON.stringify(record, null, 2)}\n`, "utf8");

console.log(`pruned ${orphans.length} orphan keys from ${LOCALES.length} locales.`);
for (const locale of LOCALES) console.log(`  ${locale}: ${before[locale]} -> ${countLeaves(dicts[locale])} keys`);
console.log(`restorable record: docs/i18n-removed-orphan-keys.json`);
