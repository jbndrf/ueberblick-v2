#!/bin/sh
# Make /data and the backup folder writable for the user "node" (top level only: the backup may be a NAS mount),
# then drop root. The user "node" (uid 1000) owns /data, so Litestream, the restore and the app use the same files.
set -eu
if [ "$(id -u)" = "0" ]; then
  chown node:node "${DATA_DIR:-/data}" "${BACKUP_TARGET:-/backup}" 2>/dev/null || true
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi
exec "$@"
