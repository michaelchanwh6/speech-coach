import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma";

// Reuse the client across hot reloads in dev so we don't exhaust the
// Postgres connection pool with a new PrismaClient per file change.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createPrismaClient() {
  // Using DIRECT_URL (session mode, port 5432) rather than the pooled
  // DATABASE_URL (port 6543): Supabase's transaction-mode pooler hangs
  // indefinitely on connection for this project (protocol handshake never
  // completes, TCP connects fine). Fine for now since `next dev` is a
  // single long-lived process; revisit pooling before a serverless deploy
  // where many short-lived instances would otherwise exhaust Postgres's
  // native connection limit.
  const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
