#!/usr/bin/env bash
# Builds the E2E sandbox: bare origin + work clone with the INFERNO flow
# installed from the tarball and the toy-math intent pre-seeded.
set -euo pipefail
TARBALL="$(realpath "${1:?usage: setup-sandbox.sh <tarball>}")"
HERE="$(cd "$(dirname "$0")" && pwd)"
BASE="$(mktemp -d /tmp/specsmd-e2e.XXXXXX)"
ORIGIN="$BASE/origin.git"; WORK="$BASE/work"

git init -q --bare "$ORIGIN"
git init -q -b main "$WORK"
cd "$WORK"
git remote add origin "$ORIGIN"
cat > package.json <<'EOF'
{
  "name": "toy-math",
  "version": "1.0.0",
  "private": true,
  "scripts": { "test": "node --test tests/" }
}
EOF
mkdir -p lib tests .claude
git add -A && git commit -qm "chore: scaffold toy project"

# Install the flow from the tarball (Claude Code only; same PTY trick as install-eval)
{ sleep 12; printf '\r'; sleep 3; printf '\033[B\033[B\033[B\033[B'; sleep 1; printf '\r'; sleep 45; } | \
  SPECSMD_TELEMETRY_DISABLED=1 script -qec "npx -y --package=\"$TARBALL\" specsmd install" /dev/null \
  > install.log 2>&1
test -f .claude/commands/specsmd-inferno.md || { echo "install failed; see $WORK/install.log"; exit 1; }

# Seed INFERNO state + intent + work items + per-project config
mkdir -p .specs-inferno/intents/toy-math/work-items
cp "$HERE/fixtures/state.yaml" .specs-inferno/state.yaml
cp "$HERE/fixtures/brief.md"   .specs-inferno/intents/toy-math/brief.md
cp "$HERE/fixtures/add-add.md"  .specs-inferno/intents/toy-math/work-items/add-add.md
cp "$HERE/fixtures/add-mul.md"  .specs-inferno/intents/toy-math/work-items/add-mul.md
cp "$HERE/fixtures/add-calc.md" .specs-inferno/intents/toy-math/work-items/add-calc.md
cat > .specs-inferno/config.yaml <<'EOF'
models:
  strong: sonnet
  cheap: haiku
verification:
  finalize:
    - npm test
EOF
git add -A && git commit -qm "chore: install INFERNO flow and seed toy-math intent"
git push -q -u origin main
echo "$WORK"
