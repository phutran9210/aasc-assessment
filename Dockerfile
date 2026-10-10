# syntax=docker/dockerfile:1

# AASC assessment app (port 3000, SQLite).
# Build:  docker build -t aasc-assessment:latest .

# The base image is pinned by tag and digest so a rebuild cannot silently pick up another Node.
# Update both together (or let Renovate/Dependabot do it).
ARG NODE_IMAGE=node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20
# Version pinned to package.json "packageManager".
ARG PNPM_VERSION=11.2.2

# ── Base: Node + pnpm, dependency manifests only ─────────────────────────────────────────
FROM ${NODE_IMAGE} AS base
ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true
RUN npm install --global --no-fund --no-audit "pnpm@${PNPM_VERSION}"
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

# ── Runtime: non-root, no build tools, no package manager ────────────────────────────────
FROM ${NODE_IMAGE} AS runtime
# The app refuses to start in production with the development JWT secret: pass JWT_SECRET,
# or override NODE_ENV (docker-compose.yml does so through the .env file).
ENV NODE_ENV=production \
    PORT=3000 \
    DATABASE_PATH=data/app.sqlite
WORKDIR /app

# The runtime only ever runs `node`: without a package manager in the image there is nothing to
# install or download with from inside a compromised container.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-* \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
      /usr/local/bin/yarn /usr/local/bin/yarnpkg

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY public ./public
# Default lead mapping; docker-compose mounts ./config over it so it can be edited without a rebuild.
COPY config ./config

# SQLite lives in /app/data: mount a volume there to keep data between containers. Only the data
# and secrets directories are writable by the app; the code stays owned by root.
RUN mkdir -p data secrets && chown 1000:1000 data secrets

# Passed by CI or `docker build --build-arg`, so a running container can be traced to its commit.
ARG VERSION=local
ARG REVISION=unknown
LABEL org.opencontainers.image.title="aasc-assessment" \
      org.opencontainers.image.description="AASC assessment application (REST, WebSocket games, Bitrix24 and Google Sheets integrations)" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}"

# The `node` user by number, so orchestrators can verify the container does not run as root.
USER 1000:1000
VOLUME ["/app/data"]
EXPOSE 3000
STOPSIGNAL SIGTERM

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"

CMD ["node", "dist/main.js"]
