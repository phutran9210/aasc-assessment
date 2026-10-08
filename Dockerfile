# syntax=docker/dockerfile:1

# ── Base: Node + pnpm (version pinned to package.json "packageManager") ──────────────────
FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN npm install -g pnpm@11.2.2
WORKDIR /app
# Manifests only: the dependency layers below are rebuilt only when these files change.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# ── Build: all dependencies, compile TypeScript to dist/ ─────────────────────────────────
FROM base AS build
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
COPY nest-cli.json tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN pnpm build

# ── Production dependencies only (no test tools, no faker) ───────────────────────────────
FROM base AS prod-deps
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --prod --frozen-lockfile

# ── Runtime: small image, non-root user ──────────────────────────────────────────────────
FROM node:24-bookworm-slim AS runtime
# The app refuses to start in production with the development JWT secret: pass JWT_SECRET,
# or override NODE_ENV (docker-compose.yml does so through the .env file).
ENV NODE_ENV=production \
    PORT=3000 \
    DATABASE_PATH=data/app.sqlite
WORKDIR /app

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY public ./public
# Default lead mapping; docker-compose mounts ./config over it so it can be edited without a rebuild.
COPY config ./config

# SQLite lives in /app/data: mount a volume there to keep data between containers.
RUN mkdir -p data && chown -R node:node /app
USER node
VOLUME ["/app/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"

CMD ["node", "dist/main.js"]
