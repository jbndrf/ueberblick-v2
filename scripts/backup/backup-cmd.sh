#!/bin/sh
# Befehle des Sicherungs-Images / commands of the backup image: `run` (default) or `restore [--force]`.
set -eu
cmd="${1:-run}"
[ "$#" -gt 0 ] && shift
case "$cmd" in
  run) exec node scripts/backup/run.mjs ;;
  restore) exec node --disable-warning=ExperimentalWarning --experimental-transform-types --import ./scripts/backup/register.mjs scripts/backup/restore.mjs "${BACKUP_TARGET:-/backup}" "${DATA_DIR:-/data}" "$@" ;;
  *) echo "usage: run | restore [--force]" >&2; exit 2 ;;
esac
