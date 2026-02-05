"use strict";
// MultiWA Gateway - Prisma Client Singleton
// packages/database/src/prisma-client.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.PrismaClient = exports.prisma = void 0;
const client_1 = require("@prisma/client");
Object.defineProperty(exports, "PrismaClient", { enumerable: true, get: function () { return client_1.PrismaClient; } });
// Explicitly pass DATABASE_URL to ensure it's read at runtime, not compile time
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
    console.warn('⚠️ DATABASE_URL not found in environment. Prisma may fail to connect.');
}
exports.prisma = globalThis.prisma ?? new client_1.PrismaClient({
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
    globalThis.prisma = exports.prisma;
}
//# sourceMappingURL=prisma-client.js.map