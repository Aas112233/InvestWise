import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const postgres = require(path.resolve('node_modules/postgres'));
const s = postgres(process.env.DATABASE_URL, { prepare: false });
await s`delete from rate_limit_buckets where bucket_key like 'login:ip:%'`;
console.log('login buckets cleared');
await s.end();
