import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const root = process.cwd();

// exact flatten from audit-i18n.mjs
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

const raw = JSON.parse(readFileSync(join(root, "messages", "en.json"), "utf8"));
const en = flatten(raw);
console.log("audit-style en size:", en.size);

for (const k of ["admin.actionLog.target", "admin.users.title", "governance.issuedSuccess", "common.refresh"]) {
  console.log(`${k.padEnd(30)} has=${en.has(k)} type=${typeof en.get(k)}`);
}

console.log("\nadmin.actionLog subtree:");
for (const k of [...en.keys()].filter((x) => x.startsWith("admin.actionLog"))) {
  console.log("  ", k, "=", JSON.stringify(en.get(k)));
}

console.log("\nraw admin.actionLog:", JSON.stringify(raw.admin?.actionLog)?.slice(0, 200));
