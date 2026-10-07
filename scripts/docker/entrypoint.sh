#!/bin/sh
# Docker creates a missing bind-mount folder as root. Fix the owner of the data folder, then drop root.
set -eu
# adapter-node reads this when it starts: bodies above UPLOAD_LIMIT are refused with 413 (WP-942).
export BODY_SIZE_LIMIT="${UPLOAD_LIMIT:-50M}"
# adapter-node's view of the address people open, derived from PUBLIC_URL in one place (WP-954): ORIGIN in proxy mode,
# the X-Forwarded-* header names in direct mode. Never set ORIGIN by hand.
eval "$(node scripts/tls/origin.mjs)"
# HTTPS_MODE=direct: the TLS front (scripts/tls/front.mjs) starts the app command as its child (WP-941).
if [ "${HTTPS_MODE:-proxy}" = "direct" ]; then
  set -- node scripts/tls/front.mjs "$@"
fi
if [ "$(id -u)" = "0" ]; then
  chown node:node "${DATA_DIR:-/data}"
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi
exec "$@"
