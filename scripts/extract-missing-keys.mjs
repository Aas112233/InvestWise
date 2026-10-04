// Extracts every t("key", { defaultValue: "..." }) reference whose key is
// missing from messages/en.json, and emits the English text verbatim from the
// source so the backfilled dictionary matches today's UI copy exactly.
//
// Run: node scripts/extract-missing-keys.mjs
// Out: docs/i18n-missing-keys.json  (key -> { en, hasPlaceholder, source })
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCAN_DIRS = ["app", "components", "lib"];
const EXTS = new Set([".ts", ".tsx"]);
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "build", ".git"]);

function flatten(obj, prefix = "", out = new Map()) {
  if (obj !== null && typeof obj === "object" && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  } else out.set(prefix, obj);
  return out;
}

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (EXTS.has(extname(entry))) acc.push(full);
  }
  return acc;
}

const en = flatten(JSON.parse(readFileSync(join(root, "messages", "en.json"), "utf8")));

/** Balanced scan for t("key", { defaultValue: "..." }). */
function findCalls(src) {
  const calls = [];
  const re = /\bt\(\s*/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const argStart = m.index + m[0].length;
    const q = src[argStart];
    if (q !== '"' && q !== "'" && q !== "`") continue;
    let i = argStart + 1;
    while (i < src.length) {
      if (src[i] === "\\") { i += 2; continue; }
      if (src[i] === q) break;
      i++;
    }
    const argEnd = i;
    i++;
    let j = i;
    while (j < src.length && /\s/.test(src[j])) j++;
    let varsObj = null;
    if (src[j] === ",") {
      j++;
      while (j < src.length && /\s/.test(src[j])) j++;
      if (src[j] === "{") {
        const start = j;
        let depth = 0;
        while (j < src.length) {
          const c = src[j];
          if (c === '"' || c === "'" || c === "`") {
            const qq = c; j++;
            while (j < src.length && src[j] !== qq) { if (src[j] === "\\") j++; j++; }
            j++; continue;
          }
          if (c === "{") depth++;
          else if (c === "}") { depth--; if (depth === 0) { j++; break; } }
          j++;
        }
        varsObj = src.slice(start, j);
      }
    }
    calls.push({ arg: src.slice(argStart, argEnd + 1), varsObj, index: m.index });
    re.lastIndex = argEnd;
  }
  return calls;
}

/** defaultValue: "..." — returns the string, or null when it is not a literal. */
function readDefault(varsObj) {
  if (!varsObj) return null;
  const idx = varsObj.indexOf("defaultValue");
  if (idx === -1) return null;
  let i = idx + "defaultValue".length;
  while (i < varsObj.length && /\s/.test(varsObj[i])) i++;
  if (varsObj[i] !== ":") return null;
  i++;
  while (i < varsObj.length && /\s/.test(varsObj[i])) i++;
  const q = varsObj[i];
  if (q !== '"' && q !== "'" && q !== "`") return null;
  let j = i + 1;
  let out = "";
  while (j < varsObj.length && varsObj[j] !== q) {
    if (varsObj[j] === "\\") {
      const n = varsObj[j + 1];
      out += n === "n" ? "\n" : n === "t" ? "\t" : n;
      j += 2; continue;
    }
    out += varsObj[j++];
  }
  return out;
}

const missing = new Map();
const unresolved = [];

for (const file of SCAN_DIRS.flatMap((d) => walk(join(root, d)))) {
  const rel = relative(root, file).replace(/\\/g, "/");
  const src = readFileSync(file, "utf8");
  for (const call of findCalls(src)) {
    const raw = call.arg;
    if (raw.startsWith("`")) continue; // dynamic, handled separately
    const key = raw.slice(1, -1);
    if (en.has(key) || missing.has(key)) continue;
    const dv = readDefault(call.varsObj);
    const line = src.slice(0, call.index).split("\n").length;
    if (dv === null) {
      unresolved.push({ key, file: rel, line });
      continue;
    }
    missing.set(key, {
      en: dv,
      hasPlaceholder: /\{\w+\}/.test(dv),
      source: `${rel}:${line}`,
    });
  }
}

const outObj = Object.fromEntries([...missing].sort(([a], [b]) => a.localeCompare(b)));
const dest = join(root, "docs", "i18n-missing-keys.json");
writeFileSync(dest, JSON.stringify(outObj, null, 2), "utf8");

console.log(`missing keys with a literal defaultValue : ${missing.size}`);
console.log(`  of which contain a {placeholder}       : ${[...missing.values()].filter((v) => v.hasPlaceholder).length}`);
console.log(`unresolved (non-literal defaultValue)    : ${unresolved.length}`);
if (unresolved.length) {
  console.log("\n!! these need manual English:");
  for (const u of unresolved) console.log(`   ${u.key}  <- ${u.file}:${u.line}`);
}
console.log(`\nwritten: ${relative(root, dest)}`);
