# Datensicherungs-Dienst / backup service (WP-943): Litestream (pinned) + scripts/backup (run and restore).
# Build context: the repository root (docker compose --profile backup).
# The restore replays erasures through the server code, so the image carries the workspace sources and production modules.
FROM node:22-bookworm AS build
WORKDIR /app
COPY . .
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:22-bookworm-slim AS runtime
ARG TARGETARCH
# Pinned Litestream release; checksums as in scripts/backup/litestream.mjs (LITESTREAM_SHA256).
ARG LITESTREAM_VERSION=0.3.13
ARG LITESTREAM_SHA256_AMD64=eb75a3de5cab03875cdae9f5f539e6aedadd66607003d9b1e7a9077948818ba0
ARG LITESTREAM_SHA256_ARM64=9585f5a508516bd66af2b2376bab4de256a5ef8e2b73ec760559e679628f2d59
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
 && ARCH="${TARGETARCH:-amd64}" \
 && if [ "$ARCH" = "arm64" ]; then SHA="$LITESTREAM_SHA256_ARM64"; else SHA="$LITESTREAM_SHA256_AMD64"; fi \
 && curl -fsSL -o /tmp/ls.tgz "https://github.com/benbjohnson/litestream/releases/download/v${LITESTREAM_VERSION}/litestream-v${LITESTREAM_VERSION}-linux-${ARCH}.tar.gz" \
 && echo "${SHA}  /tmp/ls.tgz" | sha256sum -c - \
 && tar xzf /tmp/ls.tgz -C /usr/local/bin litestream \
 && rm /tmp/ls.tgz \
 && apt-get purge -y curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages ./packages
COPY --from=build /app/scripts/backup ./scripts/backup
RUN chmod +x scripts/backup/entrypoint.sh scripts/backup/backup-cmd.sh \
 && ln -s /app/scripts/backup/entrypoint.sh /usr/local/bin/entrypoint.sh
ENV DATA_DIR=/data BACKUP_TARGET=/backup
ENTRYPOINT ["/usr/local/bin/entrypoint.sh", "/app/scripts/backup/backup-cmd.sh"]
CMD ["run"]
