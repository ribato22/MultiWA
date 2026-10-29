# ============================================
# MultiWA — Single Dockerfile (All-in-One)
# The quick start (docker-compose.yml) builds two targets from it: api and admin.
# Build one by hand: docker build --target api -t multiwa-api .
# The worker, CI and the published images use docker/Dockerfile.{api,worker,admin}.
# ============================================

# ── Stage 1: Install & Build ─────────────────
FROM node:24-slim AS builder

WORKDIR /app

# Install system deps (git for baileys). pnpm is pinned to packageManager in
# package.json: an unpinned install takes whatever pnpm is latest that day.
RUN apt-get update && apt-get install -y git && \
    npm install -g pnpm@9.15.0 && \
    rm -rf /var/lib/apt/lists/*

# Copy workspace config first (cache layer)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
# pnpm.patchedDependencies references patches/ — install fails without it.
COPY patches ./patches

# Copy all package.json files. Every workspace package.json must be present or
# `--frozen-lockfile` fails its lockfile check; `--filter` below keeps the ones
# api and admin don't need out of the install.
COPY apps/api/package.json ./apps/api/
COPY apps/admin/package.json ./apps/admin/
COPY apps/worker/package.json ./apps/worker/
COPY packages/core/package.json ./packages/core/
COPY packages/database/package.json ./packages/database/
COPY packages/engines/package.json ./packages/engines/
COPY packages/engine-runtime/package.json ./packages/engine-runtime/
COPY packages/sdk/package.json ./packages/sdk/
COPY packages/chatwoot-bridge/package.json ./packages/chatwoot-bridge/
COPY packages/n8n-nodes-multiwa/package.json ./packages/n8n-nodes-multiwa/

# Install exactly what pnpm-lock.yaml pins
RUN pnpm install --frozen-lockfile --filter @multiwa/api... --filter @multiwa/admin...

# Copy prisma schema + Prisma 7 CLI config, and generate with the workspace's prisma
COPY packages/database/prisma ./packages/database/prisma
COPY packages/database/prisma.config.ts ./packages/database/
RUN cd packages/database && pnpm exec prisma generate

# Copy all source code
COPY . .

# Build workspace packages in order. No `|| true`: a failed build fails the image.
RUN pnpm --filter @multiwa/database build
RUN pnpm --filter @multiwa/core build
RUN pnpm --filter @multiwa/engines build

# Build shared engine runtime (apps/api + apps/worker depend on it). Fail hard if
# it does not emit — a missing dist would break the API at runtime.
RUN pnpm --filter @multiwa/engine-runtime build
RUN test -f packages/engine-runtime/dist/index.js || (echo "❌ engine-runtime build produced no dist" && exit 1)

# Build API
RUN pnpm --filter @multiwa/api build
RUN test -f apps/api/dist/main.js && echo "✅ API build OK" || (echo "❌ API build failed" && exit 1)

# Build Admin Dashboard
# Both URLs are baked into the Next.js build: NEXT_PUBLIC_API_URL for the
# browser, INTERNAL_API_URL for the server-side proxy over the Docker network.
ARG NEXT_PUBLIC_API_URL=http://localhost:3333
ARG INTERNAL_API_URL=http://api:3333
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV INTERNAL_API_URL=$INTERNAL_API_URL
RUN pnpm --filter @multiwa/admin build


# ── Stage 2: API Runtime ─────────────────────
FROM node:24-slim AS api

WORKDIR /app

# Install Chromium for whatsapp-web.js + runtime deps
RUN apt-get update && apt-get install -y \
      chromium libnss3 libfreetype6 libharfbuzz0b \
      ca-certificates fonts-freefont-ttf libxshmfence1 libgbm1 \
      git --no-install-recommends && \
    npm install -g pnpm@9.15.0 && \
    rm -rf /var/lib/apt/lists/*

# Copy workspace config, patches/ (the prod install re-applies them) and every
# workspace package.json (the frozen-lockfile check needs all of them)
COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=builder /app/patches ./patches
COPY --from=builder /app/apps/api/package.json ./apps/api/
COPY --from=builder /app/apps/admin/package.json ./apps/admin/
COPY --from=builder /app/apps/worker/package.json ./apps/worker/
COPY --from=builder /app/packages/core/package.json ./packages/core/
COPY --from=builder /app/packages/database/package.json ./packages/database/
COPY --from=builder /app/packages/engines/package.json ./packages/engines/
COPY --from=builder /app/packages/engine-runtime/package.json ./packages/engine-runtime/
COPY --from=builder /app/packages/sdk/package.json ./packages/sdk/
COPY --from=builder /app/packages/chatwoot-bridge/package.json ./packages/chatwoot-bridge/
COPY --from=builder /app/packages/n8n-nodes-multiwa/package.json ./packages/n8n-nodes-multiwa/

# Install production deps only
RUN pnpm install --frozen-lockfile --prod --filter @multiwa/api...

# Copy built artifacts
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/packages/database ./packages/database
COPY --from=builder /app/packages/core ./packages/core
COPY --from=builder /app/packages/engines ./packages/engines
COPY --from=builder /app/packages/engine-runtime ./packages/engine-runtime

# Generate Prisma client with the workspace's Prisma 7 (a prod dep of
# @multiwa/database): prisma.config.ts imports `prisma/config`, which a global
# prisma install can't resolve.
RUN cd packages/database && pnpm exec prisma generate

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

# Entrypoint bootstraps strong secrets on first boot (so the default compose
# stack boots securely with no committed secret), then runs `prisma db push`
# (no migrations dir) and hands off to the API.
COPY docker/entrypoint-api.sh /usr/local/bin/entrypoint-api.sh
RUN chmod +x /usr/local/bin/entrypoint-api.sh
CMD ["/usr/local/bin/entrypoint-api.sh"]


# ── Stage 3: Admin Dashboard Runtime ─────────
FROM node:24-alpine AS admin

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
