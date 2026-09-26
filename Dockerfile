# Outreach OS — engine and interface in one container.
#
# The engine is a long-running process with a SQLite database, so it needs a host
# with an always-on process and a persistent disk. Mount a volume at /data (see
# OUTREACH_DB_PATH below), or every restart starts from an empty database.

FROM node:22-bookworm-slim

# better-sqlite3 ships prebuilt binaries for linux/glibc, but keep a toolchain
# present so the image still builds if a prebuild is missing for a new Node release.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependencies first, so a source-only change does not reinstall them.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
RUN npm ci --no-audit --no-fund

COPY tsconfig.base.json ./
COPY packages ./packages

# Builds the interface; the engine serves it, so one container is the whole app.
RUN npm run build

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    OUTREACH_DATA_DIR=/data

# The platform sets PORT; this is only a default for a plain `docker run`.
ENV PORT=4317
EXPOSE 4317

# The server runs from TypeScript via tsx, which is how it runs everywhere else.
CMD ["npx", "tsx", "packages/server/src/index.ts"]
