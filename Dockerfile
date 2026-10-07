# Überblick v4: ein Image / one image (WP-940).
# Stage 1 baut die App und hat Compiler für better-sqlite3 (für die Plattform des Images).
# Stage 1 builds the app and has the compilers for better-sqlite3 (built for the image's platform).
FROM node:22-bookworm AS build
WORKDIR /app
COPY . .
RUN npm ci --no-audit --no-fund
RUN npm run build -w @ueberblick/web
# WP-952: adapter-node lässt die `dependencies` von apps/web extern (workspace-Pakete sind im Build). Die Laufzeit
# bekommt genau diese, abgeleitet aus apps/web/package.json (nie von Hand), samt Plattform-Binärdateien (sharp, better-sqlite3).
# WP-952: adapter-node keeps the `dependencies` of apps/web external (workspace packages are bundled). The runtime gets
# exactly those, derived from apps/web/package.json (never hand-picked), with platform binaries (sharp, better-sqlite3).
RUN node scripts/docker/runtime-deps.mjs /deploy \
 && cd /deploy && npm install --omit=dev --no-audit --no-fund

# Stage 2: schlanke Laufzeit, nur der Build und seine externen Abhängigkeiten / slim runtime: the build and its external dependencies only.
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATA_DIR=/data
WORKDIR /app
COPY --from=build /app/apps/web/build ./build
COPY --from=build /deploy/node_modules ./node_modules
COPY scripts/tls/*.mjs ./scripts/tls/
COPY scripts/docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh \
 && mkdir -p /data \
 && chown node:node /data
VOLUME /data
EXPOSE 3000 8443
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
# Der Einstiegspunkt macht /data für den Benutzer "node" schreibbar und startet die App ohne Root-Rechte.
# The entrypoint makes /data writable for the user "node" and starts the app without root rights.
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["node", "build/index.js"]
