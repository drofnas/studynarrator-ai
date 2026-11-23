#!/usr/bin/env bash
# Report a Speaches container's state, memory, and open client connections,
# and recommend a restart when it is idle while holding memory. Speaches keeps
# model memory after requests finish, so an idle restart releases it.
# Run on the Docker host that runs Speaches. This script only reports; it does
# not restart anything.
set -euo pipefail

CONTAINER="${SPEACHES_CONTAINER:-speaches}"
PORT="${SPEACHES_PORT:-8080}"

RESTART_MEMORY_THRESHOLD="${SPEACHES_RESTART_MEMORY_THRESHOLD:-5}"

# ------------------------------------------------------------
# Container status
# ------------------------------------------------------------

if ! docker inspect "$CONTAINER" >/dev/null 2>&1; then
    echo "ERROR: Container '$CONTAINER' does not exist."
    exit 1
fi

RUNNING=$(docker inspect -f '{{.State.Running}}' "$CONTAINER")

if [[ "$RUNNING" != "true" ]]; then
    echo "Container:   $CONTAINER"
    echo "Status:      STOPPED"
    echo "Memory:      N/A"
    echo "Connections: 0"
    echo "Restart?:    False"
    exit 0
fi

# ------------------------------------------------------------
# Memory
# ------------------------------------------------------------

STATS=$(docker stats "$CONTAINER" \
    --no-stream \
    --format '{{.MemUsage}}|{{.MemPerc}}')

MEMORY="${STATS%%|*}"
MEMORY_PERCENT="${STATS##*|}"
MEMORY_PERCENT_VALUE="${MEMORY_PERCENT%\%}"

# ------------------------------------------------------------
# Connections
# ------------------------------------------------------------

PID=$(docker inspect -f '{{.State.Pid}}' "$CONTAINER")

HEX_PORT=$(printf '%04X' "$PORT")

IPV4_COUNT=$(
    awk -v port=":$HEX_PORT" \
        '$2 ~ port"$" && $4 == "01" {count++}
         END {print count+0}' \
        "/proc/$PID/net/tcp" 2>/dev/null || echo 0
)

IPV6_COUNT=$(
    awk -v port=":$HEX_PORT" \
        '$2 ~ port"$" && $4 == "01" {count++}
         END {print count+0}' \
        "/proc/$PID/net/tcp6" 2>/dev/null || echo 0
)

CONNECTIONS=$((IPV4_COUNT + IPV6_COUNT))

# ------------------------------------------------------------
# Restart recommendation
# ------------------------------------------------------------

SHOULD_RESTART="False"

if [[ "$CONNECTIONS" -eq 0 ]] && \
   awk -v usage="$MEMORY_PERCENT_VALUE" \
       -v threshold="$RESTART_MEMORY_THRESHOLD" \
       'BEGIN { exit !(usage >= threshold) }'
then
    SHOULD_RESTART="True"
fi

# ------------------------------------------------------------
# Output
# ------------------------------------------------------------

echo "Container:   $CONTAINER"
echo "Status:      RUNNING"
echo "Memory:      $MEMORY ($MEMORY_PERCENT)"
echo "Connections: $CONNECTIONS"
echo "Restart?:    $SHOULD_RESTART"
