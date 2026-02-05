// MultiWA Gateway - Prisma Client Singleton
// packages/database/src/prisma-client.ts

import { config } from 'dotenv';
import { resolve } from 'path';
import { PrismaClient } from '@prisma/client';

// Load .env file from CWD (apps/api/.env) before anything else
// This ensures DATABASE_URL is available before PrismaClient is constructed
config({ path: resolve(process.cwd(), '.env') });

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

// Explicitly pass DATABASE_URL to ensure it's read at runtime, not compile time
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.warn('⚠️ DATABASE_URL not found in environment. Prisma may fail to connect.');
}

export const prisma = globalThis.prisma ?? new PrismaClient({
  datasources: {
    db: {
      url: databaseUrl,
    },
  },
  log: process.env.NODE_ENV === 'development' 
    ? ['query', 'info', 'warn', 'error']
    : ['error'],
});

if (process.env.NODE_ENV !== 'production') {
  globalThis.prisma = prisma;
}

export { PrismaClient };
