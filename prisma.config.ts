import { config } from "dotenv";
import { defineConfig, env } from "prisma/config";

// The Prisma CLI only auto-loads .env by default; Next.js's convention of
// putting local secrets in .env.local needs loading explicitly.
config({ path: ".env.local" });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Migrations use the direct/session connection, not the pooled one —
    // PgBouncer's transaction mode (used by DATABASE_URL) doesn't support
    // the prepared statements schema operations need.
    url: env("DIRECT_URL"),
  },
});
