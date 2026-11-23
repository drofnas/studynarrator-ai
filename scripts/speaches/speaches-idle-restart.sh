#!/usr/bin/env bash
# Restart a Speaches container after it has been idle for a while, to release
# the model memory Speaches keeps after requests finish.
#
# Run it on the Docker host that runs Speaches, either as a service with
# --watch (see speaches-idle-restart.service) or once a minute from cron. Each
# check takes one CPU sample. A sample at or above the CPU threshold marks the
# container active. When the container has stayed below the threshold for the
# idle period and still holds memory at or above the memory threshold, the
# script restarts it.
#
# Open connections are ignored: a reverse proxy such as Tailscale Serve in a
# shared network namespace keeps its connection to Speaches open while idle.
#
# Usage: speaches-idle-restart.sh [--watch] [--dry-run]
#   --watch    keep running and check every SPEACHES_CHECK_INTERVAL_SECONDS.
#   --dry-run  report the decision without restarting.
set -euo pipefail

CONTAINER="${SPEACHES_CONTAINER:-speaches}"
IDLE_MINUTES="${SPEACHES_IDLE_MINUTES:-10}"
IDLE_CPU_THRESHOLD="${SPEACHES_IDLE_CPU_THRESHOLD:-2}"
RESTART_MEMORY_THRESHOLD="${SPEACHES_RESTART_MEMORY_THRESHOLD:-5}"
CHECK_INTERVAL_SECONDS="${SPEACHES_CHECK_INTERVAL_SECONDS:-60}"
STATE_DIR="${SPEACHES_STATE_DIR:-${XDG_STATE_HOME:-${HOME:-/var/tmp}/.local/state}/speaches-idle-restart}"

WATCH="false"
DRY_RUN="false"
for arg in "$@"; do
    case "$arg" in
        --watch) WATCH="true" ;;
        --dry-run) DRY_RUN="true" ;;
        *)
            echo "Usage: $0 [--watch] [--dry-run]" >&2
            exit 2
            ;;
    esac
done

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

# Only one copy runs at a time, so a cron entry left beside the service, or an
# overlapping cron run, exits quietly.
if command -v flock >/dev/null 2>&1; then
    exec 9>"$STATE_DIR/$CONTAINER.lock"
    if ! flock -n 9; then
        [[ "$WATCH" == "true" ]] && report "error=already-running"
        exit 0
    fi
fi

# Returns 1 when the check could not read the container.
check_once() {
    if ! docker inspect "$CONTAINER" >/dev/null 2>&1; then
        report "error=container-not-found"
        return 1
    fi

    if [[ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER")" != "true" ]]; then
        report "status=stopped action=none"
        return 0
    fi

    local now started_at started last_active stats cpu memory memory_percent
    now=$(date +%s)

    # A container that started after the last recorded activity has been idle
    # only since it started, so a restart never repeats on the next check.
    started_at=$(docker inspect -f '{{.State.StartedAt}}' "$CONTAINER")
    started_at="${started_at%%.*}"
    started_at="${started_at%Z}"
    started=$(date -u -d "${started_at/T/ }" +%s 2>/dev/null || echo "$now")

    last_active=$(cat "$STATE_FILE" 2>/dev/null || true)
    if ! [[ "$last_active" =~ ^[0-9]+$ ]]; then
        # First check: start the idle clock now.
        last_active="$now"
    fi
    if ((started > last_active)); then
        last_active="$started"
    fi

    stats=$(docker stats "$CONTAINER" --no-stream --format '{{.CPUPerc}}|{{.MemUsage}}|{{.MemPerc}}')
    IFS='|' read -r cpu memory memory_percent <<<"$stats"
    cpu="${cpu%\%}"
    memory_percent="${memory_percent%\%}"

    if ! below "$cpu" "$IDLE_CPU_THRESHOLD"; then
        last_active="$now"
    fi

    local idle_seconds=$((now - last_active))
    local action="none"
    if ((idle_seconds >= IDLE_MINUTES * 60)) &&
        at_or_above "$memory_percent" "$RESTART_MEMORY_THRESHOLD"; then
        if [[ "$DRY_RUN" == "true" ]]; then
            action="would-restart"
        else
            if docker restart "$CONTAINER" >/dev/null; then
                action="restarted"
                last_active=$(date +%s)
            else
                action="restart-failed"
            fi
        fi
    fi

    echo "$last_active" >"$STATE_FILE.tmp"
    mv "$STATE_FILE.tmp" "$STATE_FILE"

    report "status=running cpu=${cpu}% memory=\"$memory\" memory_percent=${memory_percent}%" \
        "idle=$((idle_seconds / 60))m/${IDLE_MINUTES}m action=$action"
}

if [[ "$WATCH" != "true" ]]; then
    check_once
    exit
fi

report "watching every ${CHECK_INTERVAL_SECONDS}s; restart after ${IDLE_MINUTES}m below ${IDLE_CPU_THRESHOLD}% CPU"
while true; do
    # A failed check is logged and retried on the next interval.
    check_once || true
    sleep "$CHECK_INTERVAL_SECONDS"
done
