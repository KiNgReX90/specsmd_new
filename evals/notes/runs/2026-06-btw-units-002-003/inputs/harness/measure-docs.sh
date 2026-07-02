#!/usr/bin/env bash
# measure-docs.sh - objective doc-economy metrics per arm (TP-2).
# Usage: measure-docs.sh [ARMS_ROOT]   default: <this-dir>/../arms
# bytes/4 is a rough output-token proxy when real gen-token counts are unavailable.
set -euo pipefail
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)/arms}"
printf "%-14s %7s %8s %10s %9s\n" "arm" "files" "lines" "bytes" "~tokens"
printf "%-14s %7s %8s %10s %9s\n" "---" "-----" "-----" "-----" "-------"
for d in "$ROOT"/*/; do
  [ -d "$d" ] || continue
  arm=$(basename "$d")
  files=$(find "$d" -type f -name '*.md' | wc -l | tr -d ' ')
  lines=$(find "$d" -type f -name '*.md' -exec cat {} + 2>/dev/null | wc -l | tr -d ' ')
  bytes=$(find "$d" -type f -name '*.md' -exec cat {} + 2>/dev/null | wc -c | tr -d ' ')
  toks=$(( bytes / 4 ))
  printf "%-14s %7s %8s %10s %9s\n" "$arm" "$files" "$lines" "$bytes" "$toks"
done
