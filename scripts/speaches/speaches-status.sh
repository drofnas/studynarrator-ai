#!/usr/bin/env bash
# Report a Speaches container's state, memory, and open client connections,
# and recommend a restart when it is idle while holding memory. Speaches keeps
# model memory after requests finish, so an idle restart releases it.
#
# Idle means CPU use stayed below a threshold for every sample in a short
# window. Open connections are reported but do not decide idleness: a reverse
# proxy such as Tailscale Serve in a shared network namespace presents every
# client as 127.0.0.1 and keeps its upstream connection open while idle.
#
# Run on the Docker host that runs Speaches. This script only reports; it does
# not restart anything. A run that finds high memory takes up to
# IDLE_SAMPLES * IDLE_INTERVAL_SECONDS to confirm idleness.
set -euo pipefail

CONTAINER="${SPEACHES_CONTAINER:-speaches}"
PORT="${SPEACHES_PORT:-8080}"

RESTART_MEMORY_THRESHOLD="${SPEACHES_RESTART_MEMORY_THRESHOLD:-5}"
IDLE_CPU_THRESHOLD="${SPEACHES_IDLE_CPU_THRESHOLD:-2}"
IDLE_SAMPLES="${SPEACHES_IDLE_SAMPLES:-6}"
IDLE_INTERVAL_SECONDS="${SPEACHES_IDLE_INTERVAL_SECONDS:-10}"

# Succeeds when $1 is a number at or above $2. A value that is not a number,
# such as docker's "--", fails.
at_or_above() {
    awk -v value="$1" -v threshold="$2" \
        'BEGIN { exit !(value ~ /^[0-9]+(\.[0-9]+)?$/ && value + 0 >= threshold + 0) }'
}

# Succeeds when $1 is a number below $2. A value that is not a number fails,
# so an unreadable sample counts as busy.
below() {
    awk -v value="$1" -v threshold="$2" \
        'BEGIN { exit !(value ~ /^[0-9]+(\.[0-9]+)?$/ && value + 0 < threshold + 0) }'
}

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
CPU="not sampled (memory below ${RESTART_MEMORY_THRESHOLD}%)"

if at_or_above "$MEMORY_PERCENT_VALUE" "$RESTART_MEMORY_THRESHOLD"; then
    SHOULD_RESTART="True"
    PEAK_CPU="0"

    for ((sample = 1; sample <= IDLE_SAMPLES; sample++)); do
        CPU_SAMPLE=$(docker stats "$CONTAINER" --no-stream --format '{{.CPUPerc}}')
        CPU_SAMPLE="${CPU_SAMPLE%\%}"

        if ! below "$CPU_SAMPLE" "$IDLE_CPU_THRESHOLD"; then
            SHOULD_RESTART="False"
            PEAK_CPU="$CPU_SAMPLE"
            break
        fi

        PEAK_CPU=$(awk -v a="$PEAK_CPU" -v b="$CPU_SAMPLE" \
            'BEGIN { print (b + 0 > a + 0) ? b : a }')

        if ((sample < IDLE_SAMPLES)); then
            sleep "$IDLE_INTERVAL_SECONDS"
        fi
    done

    if [[ "$SHOULD_RESTART" == "True" ]]; then
        CPU="idle (peak ${PEAK_CPU}% over ${IDLE_SAMPLES} samples)"
    else
        CPU="busy (${PEAK_CPU}% at sample ${sample})"
    fi
fi

# ------------------------------------------------------------
# Output
# ------------------------------------------------------------

echo "Container:   $CONTAINER"
echo "Status:      RUNNING"
echo "Memory:      $MEMORY ($MEMORY_PERCENT)"
echo "CPU:         $CPU"
echo "Connections: $CONNECTIONS"
echo "Restart?:    $SHOULD_RESTART"
