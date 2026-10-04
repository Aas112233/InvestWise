// Deep i18n audit: goes beyond key parity (validate-i18n.mjs) and checks real
// usage across the app.
//
//   1. broken      - static t("x") refs that do not exist in en.json
//   2. dynamic     - t(`a.${v}.b`) template keys; resolves the concrete set when
//                    the template uses a snake_case/camelCase identifier, else flags
//   3. orphan      - keys in en.json never referenced by any call site
//   4. placeholder - t("x", {v}) passes a var the message never declares
//   5. hardcoded   - user-facing JSX text / attrs not routed through t()
//
// Run: node scripts/audit-i18n.mjs [--json] [--hardcoded]
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const LOCALES = ["en", "ur", "hi", "bn"];
const SCAN_DIRS = ["app", "components", "lib"];
const EXTS = new Set([".ts", ".tsx"]);
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "build", ".git"]);

const argv = process.argv.slice(2);
const AS_JSON = argv.includes("--json");
const SHOW_HARDCODED = argv.includes("--hardcoded");

// ---------------------------------------------------------------- dict utils
function flatten(obj, prefix = "", out = new Map()) {
  if (obj !== null && typeof obj === "object" && !Array.isArray(obj)) {
    const entries = Object.entries(obj);
    if (entries.length === 0 && prefix) out.set(prefix, obj);
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
  dicts.set(locale, flatten(JSON.parse(readFileSync(join(root, "messages", `${locale}.json`), "utf8"))));
}
const en = dicts.get("en");

// ------------------------------------------------------------------- sources
function walk(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, acc);
    else if (EXTS.has(extname(entry))) acc.push(full);
  }
  return acc;
}

const sources = SCAN_DIRS.filter((d) => {
  try { return statSync(join(root, d)).isDirectory(); } catch { return false; }
}).flatMap((d) => walk(join(root, d)));

const findings = { broken: [], dynamic: [], orphan: [], placeholder: [], hardcoded: [], serverLeak: [] };
const used = new Set();

/** Candidate values for a dynamic segment: ["snake_case"] -> snake, camel, kebab. */
function variants(name) {
  const snake = name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
  const camel = snake.replace(/_(\w)/g, (_, c) => c.toUpperCase());
  const kebab = snake.replace(/_/g, "-");
  return [...new Set([name, snake, camel, kebab])];
}

/**
 * Statically expand a template-literal key. Returns concrete keys when every
 * dynamic segment is a plain identifier, else null (unresolvable).
 */
function expandTemplate(raw) {
  const parts = raw.split("${").map((p, i) => (i === 0 ? p : p.replace(/^\s*\w+\s*}?/, "")));
  const segs = raw.split("${");
  const out = [];
  for (let i = 0; i < segs.length; i++) {
    if (i === 0) {
      out.push(segs[0].split(".").filter(Boolean));
      continue;
    }
    const name = segs[i].match(/^\s*([A-Za-z_$][\w$]*)/)?.[1];
    if (!name) return null;
    out.push(variants(name).map((v) => v.split(".").filter(Boolean)).reduce((a, b) => a.concat(b)));
  }
  void parts;
  const combos = [[]];
  for (const seg of out) {
    const next = [];
    for (const c of combos) for (const s of seg) next.push([...c, s]);
    combos.length = 0;
    combos.push(...next);
  }
  return combos.map((c) => c.join("."));
}

/**
 * Extract the top-level keys of a JS object literal string.
 * Depth-aware so that a *value* identifier (e.g. `{ email: sentTo }` -> key
 * "email", not "sentTo") is never mistaken for a key, and nested objects are
 * skipped. Returns identifiers only.
 */
function objectKeys(src) {
  const keys = new Set();
  let depth = 0;
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === "{" || c === "[" || c === "(") { depth++; i++; continue; }
    if (c === "}" || c === "]" || c === ")") { depth--; i++; continue; }
    if (c === '"' || c === "'" || c === "`") {
      const q = c; i++;
      while (i < n && src[i] !== q) { if (src[i] === "\\") i++; i++; }
      i++; continue;
    }
    if (depth === 1 && /[A-Za-z_$]/.test(c)) {
      let j = i;
      while (j < n && /[\w$]/.test(src[j])) j++;
      const word = src.slice(i, j);
      let k = j;
      while (k < n && /\s/.test(src[k])) k++;
      if (src[k] === ":") keys.add(word);
      i = j; continue;
    }
    i++;
  }
  return keys;
}

/**
 * Find every t("...") / t(`...`) call with its optional trailing object arg.
 * A small scanner instead of a regex so nested braces in the vars object are
 * captured whole and `t(` inside a string does not confuse the match.
 */
function findCalls(src) {
  const calls = [];
  const re = /\bt\(\s*/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const argStart = m.index + m[0].length;
    const q = src[argStart];
    if (q !== '"' && q !== "'" && q !== "`") continue;

    // read the string literal
    let i = argStart + 1;
    while (i < src.length) {
      if (src[i] === "\\") { i += 2; continue; }
      if (src[i] === q) break;
      i++;
    }
    const argEnd = i;
    i++;

    // optional , { ... }
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

for (const file of sources) {
  const rel = relative(root, file).replace(/\\/g, "/");
  const src = readFileSync(file, "utf8");

  // ---- 1/2/4: t("...") and t(`...`) with the optional vars object
  for (const call of findCalls(src)) {
    const line = src.slice(0, call.index).split("\n").length;
    const raw = call.arg;
    const varsObj = call.varsObj;
    let keys;
    if (raw.startsWith("`")) {
      const inner = raw.slice(1, -1);
      if (!inner.includes("${")) keys = [inner];
      else {
        const expanded = expandTemplate(inner);
        if (expanded) {
          keys = expanded;
          const resolved = expanded.filter((k) => en.has(k));
          if (resolved.length === 0) {
            findings.dynamic.push({ file: rel, line, key: inner, resolved });
            keys = [];
          } else if (resolved.length < expanded.length) {
            findings.dynamic.push({ file: rel, line, key: inner, resolved, partial: true });
          }
        } else {
          // Dynamic segment is a loop/call variable (e.g. MONTH_KEYS, member.status).
          // Not statically expandable -> manual check, not a hard failure.
          findings.dynamic.push({ file: rel, line, key: inner, resolved: null, manual: true });
          keys = [];
        }
      }
    } else {
      keys = [raw.slice(1, -1)];
    }

    for (const key of keys) {
      used.add(key);
      if (!en.has(key)) {
        // A defaultValue saves the copy but still means untranslated across
        // ur/hi/bn, so track severity separately.
        const hasDefault = !!varsObj && /defaultValue\s*:/.test(varsObj);
        findings.broken.push({ file: rel, line, key, hasDefault });
        continue;
      }
      // 4: declared placeholders vs passed vars
      if (varsObj) {
        const declared = new Set(placeholders(en.get(key)));
        for (const p of objectKeys(varsObj)) {
          if (p === "defaultValue") continue;
          if (declared.size && !declared.has(p)) {
            findings.placeholder.push({ file: rel, line, key, var: p, declared: [...declared] });
          }
        }
      }
    }
  }

  // ---- 6: server `message` rendered directly, bypassing t()
  if (extname(file) === ".tsx" && !rel.includes("/api/")) {
    const leakRe = /\b(?:res|response)\.message\s*\?\?/g;
    let s;
    while ((s = leakRe.exec(src)) !== null) {
      findings.serverLeak.push({
        file: rel,
        line: src.slice(0, s.index).split("\n").length,
        text: src.split("\n")[s.index === 0 ? 0 : src.slice(0, s.index).split("\n").length - 1].trim(),
      });
    }
  }

  // ---- 5: hardcoded user-facing text
  const isClientUI = /<[A-Z]/.test(src);
  if (isClientUI && SHOW_HARDCODED) {
    const jsxTextRe = />([A-Za-z][A-Za-z0-9 ,.'&!?()\-/:]{2,})</g;
    let h;
    while ((h = jsxTextRe.exec(src)) !== null) {
      const text = h[1].trim();
      if (text.length < 4) continue;
      findings.hardcoded.push({ file: rel, line: src.slice(0, h.index).split("\n").length, text });
    }
    for (const attr of ["placeholder", "title", "label", "aria-label", "confirmLabel"]) {
      const ar = new RegExp(`${attr}=["']([A-Za-z][^"']{2,})["']`, "g");
      let a;
      while ((a = ar.exec(src)) !== null) {
        findings.hardcoded.push({
          file: rel,
          line: src.slice(0, a.index).split("\n").length,
          text: `${attr}="${a[1]}"`,
        });
      }
    }
  }
}

// ---- 3: orphans
for (const key of en.keys()) if (!used.has(key)) findings.orphan.push(key);

// ------------------------------------------------------------------- report
const stats = {
  locales: LOCALES.length,
  enKeys: en.size,
  keyCounts: Object.fromEntries([...dicts].map(([l, d]) => [l, d.size])),
  filesScanned: sources.length,
  usedKeys: used.size,
  coverage: `${(((en.size - findings.orphan.length) / en.size) * 100).toFixed(1)}%`,
};

if (AS_JSON) {
  const out = { stats, findings };
  const dest = join(root, "docs", "i18n-audit.json");
  try {
    writeFileSync(dest, JSON.stringify(out, null, 2), "utf8");
    console.log(`JSON report written to ${relative(root, dest)}`);
  } catch {
    console.log(JSON.stringify(out, null, 2));
  }
  process.exit(0);
}

const bar = (n) => "█".repeat(Math.min(n, 40)) + (n > 40 ? `+${n - 40}` : "");
const section = (title, n) => console.log(`\n${title} ${n > 0 ? `(${n})` : "(0) ✓"}`);

/** Group records by the module segment of the key (or the file's 2nd path part). */
function byModule(records) {
  const g = new Map();
  for (const r of records) {
    const k = (r.key ?? "").split(".")[0] || r.file.split("/")[1] || "?";
    if (!g.has(k)) g.set(k, []);
    g.get(k).push(r);
  }
  return [...g].sort((a, b) => b[1].length - a[1].length);
}

console.log("i18n AUDIT");
console.log("=".repeat(70));
console.log(`locales          : ${LOCALES.join(", ")}`);
console.log(`en keys          : ${en.size}`);
console.log(`key counts       : ${Object.entries(stats.keyCounts).map(([l, n]) => `${l}=${n}`).join("  ")}`);
console.log(`files scanned    : ${sources.length} (${SCAN_DIRS.join(", ")})`);
console.log(`used keys        : ${used.size}   coverage: ${stats.coverage}`);
console.log("=".repeat(70));

const critical = findings.broken.filter((f) => !f.hasDefault);
const defaulted = findings.broken.filter((f) => f.hasDefault);

section("BROKEN t() refs — no defaultValue (UI shows raw key path)", critical.length);
for (const [mod, list] of byModule(critical)) {
  console.log(`  ── ${mod} (${list.length})`);
  const seen = new Set();
  for (const f of list) {
    if (seen.has(f.key)) continue;
    seen.add(f.key);
    const n = list.filter((x) => x.key === f.key).length;
    console.log(`     t("${f.key}")${n > 1 ? `  ×${n}` : ""}   e.g. ${f.file}:${f.line}`);
  }
}

section("BROKEN t() refs — has defaultValue (EN only, untranslated in ur/hi/bn)", defaulted.length);
for (const [mod, list] of byModule(defaulted)) {
  console.log(`  ── ${mod} (${list.length}): ${[...new Set(list.map((x) => x.key))].join(", ")}`);
}

section("DYNAMIC template keys (not statically expandable — manual check)", findings.dynamic.length);
findings.dynamic.forEach((f) => {
  const tail =
    f.resolved === null || f.resolved.length === 0
      ? "  [runtime value — verify manually]"
      : `  [resolved: ${f.resolved.join(", ")}]`;
  console.log(`  ${f.file}:${f.line}  t(\`${f.key}\`)${tail}`);
});

section("SERVER message rendered directly (bypasses t(), not translatable)", findings.serverLeak.length);
findings.serverLeak.forEach((f) => console.log(`  ${f.file}:${f.line}  ${f.text}`));

section("PLACEHOLDER mismatches", findings.placeholder.length);
findings.placeholder.forEach((f) =>
  console.log(`  ${f.file}:${f.line}  ${f.key}  passes {${f.var}} but message declares {${f.declared.join(",")}}`),
);

section("ORPHAN keys (defined, never used)", findings.orphan.length);
const orphanByNs = new Map();
for (const k of findings.orphan) {
  const ns = k.split(".")[0];
  orphanByNs.set(ns, (orphanByNs.get(ns) ?? 0) + 1);
}
for (const [ns, n] of [...orphanByNs].sort((a, b) => b[1] - a[1])) console.log(`  ${ns.padEnd(14)} ${n}`);

if (SHOW_HARDCODED) {
  section("HARDCODED user-facing text", findings.hardcoded.length);
  findings.hardcoded.forEach((f) => console.log(`  ${f.file}:${f.line}  ${f.text}`));
}

const total = findings.broken.length + findings.dynamic.filter((d) => !d.manual).length + findings.placeholder.length + findings.serverLeak.length;
console.log("\n" + "-".repeat(70));
console.log(
  `${total === 0 ? "PASS" : "FAIL"}: ${critical.length} critical + ${defaulted.length} defaulted broken, ` +
    `${findings.dynamic.length} dynamic (${findings.dynamic.filter((d) => !d.manual).length} need review), ` +
    `${findings.placeholder.length} placeholder, ${findings.serverLeak.length} server-leak, ` +
    `${findings.orphan.length} orphan (${bar(findings.orphan.length)})`,
);
process.exit(total === 0 ? 0 : 1);
