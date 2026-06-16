# ============================================
# MultiWA — Single Dockerfile (All-in-One)
# Build: docker build -t multiwa .
# ============================================

# ── Stage 1: Install & Build ─────────────────
FROM node:20-slim AS builder

WORKDIR /app

# Install system deps (git for baileys, chromium build deps)
RUN apt-get update && apt-get install -y git && \
    npm install -g pnpm && \
    rm -rf /var/lib/apt/lists/*

# Copy workspace config first (cache layer)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./

# Copy all package.json files
COPY apps/api/package.json ./apps/api/
COPY apps/admin/package.json ./apps/admin/
COPY apps/worker/package.json ./apps/worker/
COPY packages/core/package.json ./packages/core/
COPY packages/database/package.json ./packages/database/
COPY packages/engines/package.json ./packages/engines/
COPY packages/engine-runtime/package.json ./packages/engine-runtime/
COPY packages/sdk/package.json ./packages/sdk/

# Install all dependencies
RUN pnpm install --no-frozen-lockfile

# Copy prisma schema and generate
COPY packages/database/prisma ./packages/database/prisma
RUN cd packages/database && npx prisma generate

# Copy all source code
COPY . .

# Build workspace packages in order
RUN pnpm --filter @multiwa/database build || true
RUN if [ ! -f packages/database/dist/index.js ]; then \
      mkdir -p packages/database/dist && \
      cp packages/database/src/*.js packages/database/dist/ 2>/dev/null || true; \
    fi
RUN pnpm --filter @multiwa/core build || true
RUN pnpm --filter @multiwa/engines build || true
RUN if [ ! -f packages/engines/dist/index.js ]; then \
      mkdir -p packages/engines/dist && \
      cp -r packages/engines/src/* packages/engines/dist/ 2>/dev/null || true; \
    fi

# Build shared engine runtime (apps/api + apps/worker depend on it). Fail hard if
# it does not emit — a missing dist would break the API at runtime.
RUN pnpm --filter @multiwa/engine-runtime build
RUN test -f packages/engine-runtime/dist/index.js || (echo "❌ engine-runtime build produced no dist" && exit 1)

# Build API
RUN pnpm --filter @multiwa/api build || true
RUN test -f apps/api/dist/main.js && echo "✅ API build OK" || (echo "❌ API build failed" && exit 1)

# Build Admin Dashboard
# Both URLs are baked into the Next.js build: NEXT_PUBLIC_API_URL for the
# browser, INTERNAL_API_URL for the server-side proxy over the Docker network.
ARG NEXT_PUBLIC_API_URL=http://localhost:3333
ARG INTERNAL_API_URL=http://api:3333
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV INTERNAL_API_URL=$INTERNAL_API_URL
RUN pnpm --filter @multiwa/admin build || true


# ── Stage 2: API Runtime ─────────────────────
FROM node:20-slim AS api

WORKDIR /app

# Install Chromium for whatsapp-web.js + runtime deps
RUN apt-get update && apt-get install -y \
      chromium libnss3 libfreetype6 libharfbuzz0b \
      ca-certificates fonts-freefont-ttf libxshmfence1 libgbm1 \
      git --no-install-recommends && \
    npm install -g pnpm && \
    rm -rf /var/lib/apt/lists/*

# Copy workspace config
COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=builder /app/apps/api/package.json ./apps/api/
COPY --from=builder /app/packages/core/package.json ./packages/core/
COPY --from=builder /app/packages/database/package.json ./packages/database/
COPY --from=builder /app/packages/engines/package.json ./packages/engines/
COPY --from=builder /app/packages/engine-runtime/package.json ./packages/engine-runtime/
COPY --from=builder /app/packages/sdk/package.json ./packages/sdk/

# Install production deps only
RUN pnpm install --no-frozen-lockfile --prod

# Copy built artifacts
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/packages/database ./packages/database
COPY --from=builder /app/packages/core ./packages/core
COPY --from=builder /app/packages/engines ./packages/engines
COPY --from=builder /app/packages/engine-runtime ./packages/engine-runtime

# Generate Prisma client
RUN npm install -g prisma@6.19.2 && cd packages/database && prisma generate

# Workspace symlinks
RUN rm -rf /app/node_modules/@multiwa && mkdir -p /app/node_modules/@multiwa && \
    ln -sf /app/packages/core /app/node_modules/@multiwa/core && \
    ln -sf /app/packages/engines /app/node_modules/@multiwa/engines && \
    ln -sf /app/packages/engine-runtime /app/node_modules/@multiwa/engine-runtime && \
    ln -sf /app/packages/database /app/node_modules/@multiwa/database && \
    rm -rf /app/apps/api/node_modules/@multiwa && mkdir -p /app/apps/api/node_modules/@multiwa && \
    ln -sf /app/packages/core /app/apps/api/node_modules/@multiwa/core && \
    ln -sf /app/packages/engines /app/apps/api/node_modules/@multiwa/engines && \
    ln -sf /app/packages/engine-runtime /app/apps/api/node_modules/@multiwa/engine-runtime && \
    ln -sf /app/packages/database /app/apps/api/node_modules/@multiwa/database

# Prisma client symlinks
RUN mkdir -p /app/node_modules/@prisma /app/node_modules/.prisma \
      /app/apps/api/node_modules/@prisma /app/apps/api/node_modules/.prisma && \
    ln -sf /app/packages/database/node_modules/@prisma/client /app/node_modules/@prisma/client && \
    ln -sf /app/packages/database/node_modules/.prisma/client /app/node_modules/.prisma/client && \
    ln -sf /app/packages/database/node_modules/@prisma/client /app/apps/api/node_modules/@prisma/client && \
    ln -sf /app/packages/database/node_modules/.prisma/client /app/apps/api/node_modules/.prisma/client

# Session storage
RUN mkdir -p /data/sessions

ENV NODE_ENV=production
ENV SESSIONS_PATH=/data/sessions
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

EXPOSE 3333

WORKDIR /app/apps/api
# On startup, sync the database schema before booting the API. There is no
# migrations directory, so use `prisma db push` (idempotent: creates tables on a
# fresh DB, no-op when the schema already matches). The schema lives at
# /app/packages/database/prisma/schema.prisma and DATABASE_URL comes from env.
CMD ["sh", "-c", "cd /app/packages/database && prisma db push --skip-generate || echo 'prisma db push failed; starting API anyway'; cd /app/apps/api && exec node dist/main.js"]


# ── Stage 3: Admin Dashboard Runtime ─────────
FROM node:20-alpine AS admin

WORKDIR /app

ENV NODE_ENV=production
ENV HOSTNAME="0.0.0.0"
ENV PORT=3001

COPY --from=builder /app/apps/admin/.next/standalone ./
COPY --from=builder /app/apps/admin/.next/static ./apps/admin/.next/static
COPY --from=builder /app/apps/admin/public ./apps/admin/public

EXPOSE 3001

WORKDIR /app/apps/admin
CMD ["node", "server.js"]
