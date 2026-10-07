#!/usr/bin/env bash
# Concurrency gate (WP-140): holds one of K flock slots while it runs a command, so at most K full
# checks run at once on the machine. Usage: scripts/ops/check-gate.sh <command...>
#   K = $UEB_CHECK_SLOTS, else the number in <slot dir>/K (one setting every worktree reads at once, whatever its
#   checkout of this script), else 6. Slots are files in <git common dir>/check-slots (or $UEB_CHECK_DIR).
#   Under land.sh ($UEB_LOCKED set) the command takes the separate reserved slot and waits for nothing
#   but another land check. The command is exec'd with the slot fd open: the slot frees when it exits,
#   by any signal including SIGKILL. If the gate itself cannot work it exits non-zero; it never skips.
#   Two pools (WP-905). "full" is the one above. "light" (K = $UEB_LIGHT_SLOTS, default max(4, nproc/8); slot
#   files lslot.<n>, tickets lq.<n>) is for short CPU bursts: scoped test runs, check:fast (pre-commit), npm ci.
#   --light (first argument): the whole command runs in the light pool.
#   --scoped-after N (first argument): the first N words of the command are fixed, the rest are what the
#   caller appended (`npm test -- <args>`). If any appended word is not an option (no leading "-") the
#   run is scoped to a path and takes a light slot; otherwise it takes a full slot. This is the only place that decides it.
#   A command started under a gate does not take a second slot: UEB_GATE_HELD=<slot file>:<pid> is honoured
#   only if that pid is an ancestor of this process, is named in the slot file and still holds the slot's
#   lock. A full slot (or the land slot) covers a nested light or full command; a light slot covers only a nested
#   light one. Any other value (set by hand) is ignored with a note and the command queues.
#   Third pool (WP-1016): --e2e (K = $UEB_E2E_SLOTS, else <slot dir>/K.e2e, else 2; slot files eslot.<n>, tickets eq.<n>)
#   serialises `npm run e2e` (scripts/e2e/run.mjs), whose build and headless browsers are CPU-heavy. An e2e slot
#   covers a nested e2e command; a full slot or the land slot covers one too (a land train's e2e).
#   Disk guard (WP-1024, e2e pool only): while free space on the filesystem of $TMPDIR (else /tmp) is under
#   $UEB_E2E_MIN_FREE_GB (default 10; ENOSPC hit e2e runs at about 8 GB free on 2026-10-04) the effective K is 1; under half of it the gate starts nothing and prints
#   "waiting for disk: N GB free". $UEB_E2E_FREE_GB replaces the free-space probe (specs). Light and full pools: none.
#   Land (UEB_LOCKED) bypasses both pools through its reserved slot.
#   Waiters are served first come, first served: a ticket q.<n> under the slot dir, locked while its owner
#   lives (a dead owner's ticket is pruned), and only the lowest live ticket tries the slots.
set -euo pipefail
pool=full
[ "$#" -gt 0 ] || { echo "check-gate: no command" >&2; exit 2; }
if [ "${1:-}" = "--light" ]; then pool=light; shift; elif [ "${1:-}" = "--e2e" ]; then pool=e2e; shift; fi
if [ "${1:-}" = "--scoped-after" ]; then
  fixed=${2:-}
  case $fixed in ''|*[!0-9]*) echo "check-gate: --scoped-after needs a number" >&2; exit 2;; esac
  shift 2
  [ "$#" -gt 0 ] && [ "$#" -ge "$fixed" ] || { echo "check-gate: no command" >&2; exit 2; }
  i=0
  for a in "$@"; do
    i=$((i + 1))
    if [ "$i" -gt "$fixed" ]; then case $a in -*) ;; *) pool=light;; esac; fi
  done
fi
command -v flock >/dev/null || { echo "check-gate: flock not found" >&2; exit 2; }
dir=${UEB_CHECK_DIR:-$(git rev-parse --path-format=absolute --git-common-dir)/check-slots}
mkdir -p "$dir" || exit 2
if [ "$pool" = e2e ]; then
  pre=eslot; qn=eq; word=e2e
  def=2
  [ -r "$dir/K.e2e" ] && def=$(tr -dc 0-9 <"$dir/K.e2e")
  slots=${UEB_E2E_SLOTS:-$def}
  case $slots in ''|*[!0-9]*|0) echo "check-gate: UEB_E2E_SLOTS must be a positive integer" >&2; exit 2;; esac
elif [ "$pool" = light ]; then
  pre=lslot; qn=lq; word=light
  cores=$(nproc 2>/dev/null || echo 4)
  def=$((cores / 8)); [ "$def" -ge 4 ] || def=4
  [ -r "$dir/K.light" ] && def=$(tr -dc 0-9 <"$dir/K.light")
  slots=${UEB_LIGHT_SLOTS:-$def}
  case $slots in ''|*[!0-9]*|0) echo "check-gate: UEB_LIGHT_SLOTS must be a positive integer" >&2; exit 2;; esac
else
  pre=slot; qn=q; word=check
  def=6
  [ -r "$dir/K" ] && def=$(tr -dc 0-9 <"$dir/K")
  slots=${UEB_CHECK_SLOTS:-$def}
  case $slots in ''|*[!0-9]*|0) echo "check-gate: UEB_CHECK_SLOTS must be a positive integer" >&2; exit 2;; esac
fi

held_ok() { # $1 = <slot file>:<pid>; true only if that pid is our ancestor and holds the slot
  local slot=${1%%:*} pid=${1#*:} p=$$ f first
  case $slot in
    slot.[0-9]*|land.slot) ;;
    lslot.[0-9]*) [ "$pool" = light ] || return 1;;
    eslot.[0-9]*) [ "$pool" = e2e ] || return 1;;
    *) return 1;;
  esac
  case $pid in ''|*[!0-9]*) return 1;; esac
  f="$dir/$slot"
  [ -s "$f" ] || return 1
  read -r first _ <"$f" || return 1
  [ "$first" = "$pid" ] || return 1
  while [ "$p" -gt 1 ] && [ "$p" != "$pid" ]; do
    p=$(awk '/^PPid:/ {print $2}' "/proc/$p/status" 2>/dev/null) || return 1
    [ -n "$p" ] || return 1
  done
  [ "$p" = "$pid" ] || return 1
  exec 6<"$f" || return 1
  if flock -n 6; then exec 6<&-; return 1; fi
  exec 6<&-
  return 0
}
if [ -n "${UEB_GATE_HELD:-}" ]; then
  if held_ok "$UEB_GATE_HELD"; then exec "$@"; fi
  echo "check-gate: ignoring UEB_GATE_HELD (no ancestor of this command holds that slot); queueing" >&2
fi

waited_since=$(date +%s%N) # UEB_GATE_WAIT_MS (WP-953): exported to the command; steps.mjs and test-record.mjs record it as gateWaitMs
wait_ms() { echo $(( ($(date +%s%N) - waited_since) / 1000000 )); }
if [ -n "${UEB_LOCKED:-}" ]; then
  exec 9>>"$dir/land.slot"
  flock -w 1800 9 || { echo "check-gate: waited 30 min for the land slot" >&2; exit 75; }
  echo "$$ $(date +%s) land" >"$dir/land.slot"
  export UEB_GATE_HELD="land.slot:$$"
  UEB_GATE_WAIT_MS=$(wait_ms)
  export UEB_GATE_WAIT_MS
  exec "$@"
fi

take() { # $1 = slot file; on success fd 9 holds the lock and the file names this process
  exec 9>>"$1"
  if flock -n 9; then
    echo "$$ $(date +%s) $(basename "$PWD")" >"$1"
    UEB_GATE_HELD="$(basename "$1"):$$"
    export UEB_GATE_HELD
    return 0
  fi
  exec 9>&-
  return 1
}
holders() {
  local out="" f pid t now
  now=$(date +%s)
  for f in "$dir"/$pre.*; do
    [ -s "$f" ] || continue
    read -r pid t _ <"$f" || continue
    out="$out${out:+, }pid $pid ($(( (now - t) / 60 )) min)"
  done
  echo "$out"
}
live() { # slots whose lock is held right now (the label in a slot file outlives its owner, so it proves nothing)
  local n=0 f
  for f in "$dir"/$pre.*; do
    [ -e "$f" ] || continue
    exec 5<"$f" 2>/dev/null || continue
    if flock -n 5; then :; else n=$((n + 1)); fi
    exec 5<&-
  done
  echo "$n"
}

# Ticket queue. Ticket files are q.<12-digit n>; q.lock guards the counter and every prune.
exec 7>>"$dir/$qn.lock" || exit 2
flock 7 || exit 2
n=$(cat "$dir/$qn.count" 2>/dev/null || true)
case $n in
  ''|*[!0-9]*)
    # Empty or garbage counter (a killed writer, a full disk): rebuild it from the highest ticket.
    n=0
    for f in "$dir"/$qn.[0-9]*; do
      [ -e "$f" ] || continue
      t=${f##*/$qn.}
      case $t in ''|*[!0-9]*) continue;; esac
      t=$((10#$t))
      [ "$t" -gt "$n" ] && n=$t
    done
    echo "check-gate: queue counter was unreadable; rebuilt it from the tickets (now $n)" >&2
    ;;
esac
n=$((10#$n + 1))
echo "$n" >"$dir/$qn.count.$$" && mv -f "$dir/$qn.count.$$" "$dir/$qn.count" || { rm -f "$dir/$qn.count.$$"; exit 2; }
ticket=$(printf '%s/%s.%012d' "$dir" "$qn" "$n")
exec 8>>"$ticket" || exit 2
flock -n 8 || exit 2
exec 7>&-
trap 'rm -f "$ticket"' EXIT

position() { # prints 1 + the live tickets ahead of ours; prunes dead ones (their owner holds no lock)
  local f k=1
  exec 7>>"$dir/$qn.lock" || return 1
  flock 7 || return 1
  for f in "$dir"/$qn.[0-9]*; do
    [ "$f" = "$ticket" ] && break
    exec 5<"$f" 2>/dev/null || continue
    if flock -n 5; then rm -f "$f"; else k=$((k + 1)); fi
    exec 5<&-
  done
  exec 7>&-
  echo "$k"
}

disk_gb() { # whole GB free where e2e writes (build, browsers, transform cache); UEB_E2E_FREE_GB overrides the probe
  local kb
  if [ -n "${UEB_E2E_FREE_GB:-}" ]; then echo "$UEB_E2E_FREE_GB"; return; fi
  kb=$(df -Pk "${TMPDIR:-/tmp}" 2>/dev/null | awk 'NR==2 {print $4}')
  case $kb in ''|*[!0-9]*) echo 999999; return;; esac
  echo $((kb / 1048576))
}
min_gb=${UEB_E2E_MIN_FREE_GB:-10}
case $min_gb in ''|*[!0-9]*) echo "check-gate: UEB_E2E_MIN_FREE_GB must be a whole number" >&2; exit 2;; esac

start=$(date +%s)
last=$start
said=0
said_disk=0
while :; do
  pos=$(position) || exit 2
  eff=$slots hold=0
  if [ "$pool" = e2e ]; then
    free=$(disk_gb)
    if [ $((free * 2)) -lt "$min_gb" ]; then
      hold=1
      if [ "$said_disk" != 2 ]; then echo "waiting for disk: $free GB free (under $((min_gb / 2)) GB, half of $min_gb)" >&2; said_disk=2; fi
    elif [ "$free" -lt "$min_gb" ]; then
      eff=1
      if [ "$said_disk" = 0 ]; then echo "disk guard: $free GB free (under $min_gb GB), e2e slots lowered to 1" >&2; said_disk=1; fi
    fi
  fi
  if [ "$pos" = 1 ] && [ "$hold" = 0 ] && { [ "$eff" = "$slots" ] || [ "$(live)" -lt "$eff" ]; }; then
    for i in $(seq 1 "$slots"); do
      if take "$dir/$pre.$i"; then
        rm -f "$ticket"; exec 8>&-; trap - EXIT
        UEB_GATE_WAIT_MS=$(wait_ms)
        export UEB_GATE_WAIT_MS
        exec "$@"
      fi
    done
  fi
  now=$(date +%s)
  if [ "$pos" = 1 ] && [ $((now - start)) -ge 600 ] && [ "$(live)" -lt "$slots" ] \
    && [ $((now - ${warned:-0})) -ge 300 ]; then # age alarm (WP-1024): head ticket, free slot, still not running
    echo "check-gate: WARNING head of the $word queue for $(((now - start) / 60)) min while a slot is free (disk hold: $hold)" >&2
    warned=$now
  fi
  if [ "$said" = 0 ]; then
    echo "waiting for a $word slot ($(live) running), queue position $pos" >&2
    said=1
  elif [ $((now - last)) -ge "${UEB_CHECK_REPORT_SECS:-30}" ]; then
    echo "waiting $((now - start)) s for a $word slot (position $pos); holders: $(holders)" >&2
    last=$now
  fi
  sleep "0.$((RANDOM % 3 + 2))"
done
