# syntax=docker/dockerfile:1

# ---- deps ----------------------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- build ---------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# src/lib/env.ts validates the environment at import time, so the build needs
# syntactically valid values. These are never baked into the image: every
# variable is read again from the real environment at runtime.
ENV NEXT_TELEMETRY_DISABLED=1 \
    CONATO_ACCESS_SECRET=build-time-placeholder-0123456789 \
    CONATO_COOKIE_SECRET=build-time-placeholder-9876543210 \
    DATABASE_URL=postgresql://build:build@localhost:5432/build
RUN npm run build

# ---- runtime -------------------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public
# The prompt preamble is read from disk at runtime, relative to cwd.
COPY --from=build --chown=nextjs:nodejs /app/src/lib/llm/preamble.md ./src/lib/llm/preamble.md

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
