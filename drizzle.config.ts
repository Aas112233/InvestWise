import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./db/schema/index.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    // Transaction-mode pooler (Supabase 6543): drizzle-kit manages its own
    // connection, prepare flags are handled by the driver defaults here.
    url: process.env.DATABASE_URL as string,
  },
  verbose: true,
  strict: true,
});
