# syntax=docker/dockerfile:1

# --- Stage 1: Build ---
FROM node:22-alpine AS builder

WORKDIR /app

# Copy configuration and manifests
COPY package.json package-lock.json tsconfig.base.json eslint.config.js ./
COPY packages/ packages/
COPY apps/server/ apps/server/
COPY apps/web/ apps/web/

# Install dependencies
RUN npm ci

# Generate Prisma client
RUN npm run db:generate -w @leash/server

# Build all packages and applications
RUN npm run build --workspaces --if-present

# --- Stage 2: Production Server ---
FROM node:22-alpine AS server

WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4000

RUN apk add --no-cache curl dumb-init

RUN addgroup -g 1001 -S leash && \
    adduser -u 1001 -S leash -G leash

COPY --from=builder --chown=leash:leash /app/node_modules ./node_modules
COPY --from=builder --chown=leash:leash /app/packages ./packages
COPY --from=builder --chown=leash:leash /app/apps/server/dist ./apps/server/dist
COPY --from=builder --chown=leash:leash /app/apps/server/package.json ./apps/server/package.json
COPY --from=builder --chown=leash:leash /app/apps/server/prisma ./apps/server/prisma
COPY --from=builder --chown=leash:leash /app/apps/server/prisma.config.ts ./apps/server/prisma.config.ts
COPY --from=builder --chown=leash:leash /app/package.json ./package.json

USER leash

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:4000/healthz || exit 1

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "apps/server/dist/index.js"]

