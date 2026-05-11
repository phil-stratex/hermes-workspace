#!/usr/bin/env bash
# start-dev-team.sh — Bootstrap + Start aller 10 Dev-Team-Worker
# Stratex-AI Swarm Phase 1 (v4)
#
# Usage (auf VPS, im Workspace-Container ODER von außen mit erreichbarem Workspace):
#   bash scripts/start-dev-team.sh
#
# Was es macht:
# 1. Iteriert über alle 10 Worker (swarm1..swarm10)
# 2. POST /api/swarm-tmux-start für jeden — triggert ensureWorkerProfile() falls Profile fehlt
# 3. 3s Sleep zwischen Calls (verhindert Race-Conditions bei Bootstrap)
# 4. Loggt Status pro Worker (already_running / started / failed)
#
# Idempotent: kann mehrfach laufen, bestehende tmux sessions werden nicht angefasst.

set -euo pipefail

API_BASE="${API_BASE:-http://localhost:3000}"
API_TOKEN="${HERMES_API_TOKEN:-${API_SERVER_KEY:-}}"

if [ -z "$API_TOKEN" ]; then
  echo "ERROR: HERMES_API_TOKEN (oder API_SERVER_KEY) muss gesetzt sein" >&2
  echo "       Liegt im VPS unter /docker/hermes-agent-zjya/.env als API_SERVER_KEY" >&2
  exit 1
fi

WORKERS=(swarm1 swarm2 swarm3 swarm4 swarm5 swarm6 swarm7 swarm8 swarm9 swarm10)

echo "Stratex-AI Dev-Team Bootstrap"
echo "API: $API_BASE"
echo "Workers: ${WORKERS[*]}"
echo ""

success=0
already=0
failed=0

for ID in "${WORKERS[@]}"; do
  printf "%-10s ... " "$ID"
  response=$(curl -s -X POST "$API_BASE/api/swarm-tmux-start" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $API_TOKEN" \
    -d "{\"workerId\":\"$ID\"}" 2>&1 || echo '{"error":"curl_failed"}')

  if echo "$response" | grep -q '"alreadyRunning":true'; then
    echo "already running"
    already=$((already + 1))
  elif echo "$response" | grep -q '"started":true'; then
    echo "started"
    success=$((success + 1))
  elif echo "$response" | grep -q '"error"'; then
    echo "FAILED: $(echo "$response" | head -c 200)"
    failed=$((failed + 1))
  else
    echo "unknown response: $(echo "$response" | head -c 200)"
    failed=$((failed + 1))
  fi

  sleep 3
done

echo ""
echo "Summary: started=$success, already_running=$already, failed=$failed"

if [ $failed -gt 0 ]; then
  exit 2
fi
