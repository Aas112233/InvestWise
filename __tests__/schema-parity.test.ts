import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Schema drift guard.
 *
 * The data model is defined twice on disk: the canonical copy at `db/schema`
 * (what drizzle-kit targets and every `app/api/**` route imports) and the copy
 * under `server/src/db/schema` that the delegated server handlers import. The
 * two must stay byte-for-byte equivalent in *code*. They physically diverge
 * only because the server slice resolves its own drizzle-orm install (0.38)
 * whose column types are not interchangeable with the root install (0.45), so
 * it cannot import the root files directly.
 *
 * That duplication already caused a real defect: the server copy once kept the
 * legacy GLOBAL unique on `users.email` long after the security work replaced
 * it with per-tenant partial uniques. This test fails the moment the two
 * copies disagree again, so the drift is caught in CI instead of in review.
 */

const ROOT_SCHEMA_DIR = fileURLToPath(new URL('../db/schema', import.meta.url));
const SERVER_SCHEMA_DIR = fileURLToPath(new URL('../server/src/db/schema', import.meta.url));

/** Strip line comments, blank lines and indentation so only code is compared. */
function normalize(source: string): string {
  return source
    // Line endings are not code: without this, CRLF files defeat the comment
    // strip below (JS `.` cannot cross `\r`, so `//.*$` never matches) and
    // comment lines count as "code" — false parity failures.
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, '').trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

function schemaFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.ts'))
    .sort();
}

describe('schema parity (db/schema vs server/src/db/schema)', () => {
  it('declares the same set of schema files', () => {
    expect(schemaFiles(SERVER_SCHEMA_DIR)).toEqual(schemaFiles(ROOT_SCHEMA_DIR));
  });

  it('keeps every schema file code-identical to the canonical copy', () => {
    const mismatches: string[] = [];
    for (const file of schemaFiles(ROOT_SCHEMA_DIR)) {
      const root = normalize(readFileSync(`${ROOT_SCHEMA_DIR}/${file}`, 'utf8'));
      const server = normalize(readFileSync(`${SERVER_SCHEMA_DIR}/${file}`, 'utf8'));
      if (root !== server) mismatches.push(file);
    }
    expect(mismatches).toEqual([]);
  });
});
