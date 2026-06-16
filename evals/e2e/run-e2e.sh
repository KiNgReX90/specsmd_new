#!/usr/bin/env bash
# Drives the INFERNO orchestrator headlessly over the seeded intent.
# COSTS REAL TOKENS. Sandbox path comes from setup-sandbox.sh stdout.
set -uo pipefail
WORK="${1:?usage: run-e2e.sh <sandbox-work-dir>}"
cd "$WORK"
claude -p "/specsmd-inferno toy-math" \
  --dangerously-skip-permissions \
  --model sonnet \
  > e2e-transcript.log 2>&1
status=$?
echo "exit=$status (transcript: $WORK/e2e-transcript.log)"
exit "$status"
