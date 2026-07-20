// MultiWA Gateway - Prisma Client Singleton
// packages/database/src/prisma-client.ts

import { config } from 'dotenv';
import { resolve } from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

// Load .env file from CWD (apps/api/.env) before anything else
// This ensures DATABASE_URL is available before PrismaClient is constructed
config({ path: resolve(process.cwd(), '.env') });

declare global {

  var prisma: PrismaClient | undefined;
}

// Explicitly read DATABASE_URL at runtime, not compile time
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.warn('⚠️ DATABASE_URL not found in environment. Prisma may fail to connect.');
}

/**
 * Build a PrismaClient wired to the node-postgres driver adapter.
 *
 * Prisma 7 removed the schema-level `url` and the `datasources` constructor
 * option; the connection now flows through a driver adapter. Centralising the
 * adapter wiring here keeps every instantiation site (the singleton below and
 * the worker processors) consistent and reading the same DATABASE_URL.
 */
export function createPrismaClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: databaseUrl });
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development'
      ? ['query', 'info', 'warn', 'error']
      : ['error'],
  });
}

export const prisma = globalThis.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalThis.prisma = prisma;
}

export { PrismaClient };
