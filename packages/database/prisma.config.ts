// MultiWA Gateway - Prisma CLI configuration (Prisma 7)
// packages/database/prisma.config.ts
//
// Prisma 7 no longer reads the datasource URL from schema.prisma. The CLI
// (`prisma db push`, `prisma generate`, `prisma studio`) reads it from here.
// The runtime client uses the node-postgres driver adapter instead (see
// src/prisma-client.ts). Both resolve DATABASE_URL from the same environment.
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: './prisma/schema.prisma',
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
