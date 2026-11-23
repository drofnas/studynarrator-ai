#!/usr/bin/env bash
# Restart a Speaches container after it has been idle for a while, to release
# the model memory Speaches keeps after requests finish.
#
# Run it every minute from cron or a systemd timer on the Docker host that runs
# Speaches. Each run takes one CPU sample. A sample at or above the CPU
# threshold marks the container active. When the container has stayed below
# the threshold for the idle period and still holds memory at or above the
# memory threshold, the script restarts it.
#
# Open connections are ignored: a reverse proxy such as Tailscale Serve in a
# shared network namespace keeps its connection to Speaches open while idle.
#
# Usage: speaches-idle-restart.sh [--dry-run]
#   --dry-run  report the decision without restarting.
set -euo pipefail

CONTAINER="${SPEACHES_CONTAINER:-speaches}"
IDLE_MINUTES="${SPEACHES_IDLE_MINUTES:-10}"
IDLE_CPU_THRESHOLD="${SPEACHES_IDLE_CPU_THRESHOLD:-2}"
RESTART_MEMORY_THRESHOLD="${SPEACHES_RESTART_MEMORY_THRESHOLD:-5}"
STATE_DIR="${SPEACHES_STATE_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/speaches-idle-restart}"

DRY_RUN="false"
case "${1:-}" in
    "") ;;
    --dry-run) DRY_RUN="true" ;;
    *)
        echo "Usage: $0 [--dry-run]" >&2
        exit 2
        ;;
esac

# Succeeds when $1 is a number at or above $2. A value that is not a number,
# such as docker's "--", fails.
at_or_above() {
    awk -v value="$1" -v threshold="$2" \
        'BEGIN { exit !(value ~ /^[0-9]+(\.[0-9]+)?$/ && value + 0 >= threshold + 0) }'
}

# Succeeds when $1 is a number below $2. A value that is not a number fails,
# so an unreadable sample counts as active.
below() {
    awk -v value="$1" -v threshold="$2" \
        'BEGIN { exit !(value ~ /^[0-9]+(\.[0-9]+)?$/ && value + 0 < threshold + 0) }'
}

report() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') container=$CONTAINER $*"
}

mkdir -p "$STATE_DIR"
STATE_FILE="$STATE_DIR/$CONTAINER.last-active"

# Skip this run if the previous one is still going.
if command -v flock >/dev/null 2>&1; then
    exec 9>"$STATE_DIR/$CONTAINER.lock"
    flock -n 9 || exit 0
fi

if ! docker inspect "$CONTAINER" >/dev/null 2>&1; then
    report "error=container-not-found"
    exit 1
fi

if [[ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER")" != "true" ]]; then
    report "status=stopped action=none"
    exit 0
fi

NOW=$(date +%s)

# A container that started after the last recorded activity has been idle only
# since it started, so a restart never repeats on the next run.
STARTED_AT=$(docker inspect -f '{{.State.StartedAt}}' "$CONTAINER")
STARTED_AT="${STARTED_AT%%.*}"
STARTED_AT="${STARTED_AT%Z}"
STARTED=$(date -u -d "${STARTED_AT/T/ }" +%s 2>/dev/null || echo "$NOW")

LAST_ACTIVE=$(cat "$STATE_FILE" 2>/dev/null || true)
if ! [[ "$LAST_ACTIVE" =~ ^[0-9]+$ ]]; then
    # First run: start the idle clock now.
    LAST_ACTIVE="$NOW"
fi
if ((STARTED > LAST_ACTIVE)); then
    LAST_ACTIVE="$STARTED"
fi

STATS=$(docker stats "$CONTAINER" --no-stream --format '{{.CPUPerc}}|{{.MemUsage}}|{{.MemPerc}}')
IFS='|' read -r CPU MEMORY MEMORY_PERCENT <<<"$STATS"
CPU="${CPU%\%}"
MEMORY_PERCENT="${MEMORY_PERCENT%\%}"

if ! below "$CPU" "$IDLE_CPU_THRESHOLD"; then
    LAST_ACTIVE="$NOW"
fi

IDLE_SECONDS=$((NOW - LAST_ACTIVE))
IDLE_LIMIT_SECONDS=$((IDLE_MINUTES * 60))
SUMMARY="cpu=${CPU}% memory=\"$MEMORY\" memory_percent=${MEMORY_PERCENT}% idle=$((IDLE_SECONDS / 60))m/${IDLE_MINUTES}m"

ACTION="none"
if ((IDLE_SECONDS >= IDLE_LIMIT_SECONDS)) &&
    at_or_above "$MEMORY_PERCENT" "$RESTART_MEMORY_THRESHOLD"; then
    if [[ "$DRY_RUN" == "true" ]]; then
        ACTION="would-restart"
    else
        docker restart "$CONTAINER" >/dev/null
        ACTION="restarted"
        LAST_ACTIVE=$(date +%s)
    fi
fi

echo "$LAST_ACTIVE" >"$STATE_FILE.tmp"
mv "$STATE_FILE.tmp" "$STATE_FILE"

report "status=running $SUMMARY action=$ACTION"
