#!/usr/bin/env bash
# Asserts the post-run state of the E2E sandbox.
set -uo pipefail
WORK="${1:?usage: assert-e2e.sh <sandbox-work-dir>}"
cd "$WORK"
FAIL=0
ok()   { echo "OK   $*"; }
fail() { echo "FAIL $*"; FAIL=1; }

git checkout -q main
# 1. Deliverables merged to main
for f in lib/add.js lib/mul.js lib/calc.js tests/add.test.js tests/mul.test.js tests/calc.test.js; do
  [ -f "$f" ] && ok "$f on main" || fail "$f missing on main"
done
# 2. Tests pass on the integrated tree
npm test >/dev/null 2>&1 && ok "npm test passes" || fail "npm test fails"
# 3. Intent closed in state.yaml
grep -A3 'id: toy-math' .specs-fire/state.yaml | grep -q 'status: completed' \
  && ok "intent completed" || fail "intent not completed in state.yaml"
grep -q 'claimed_by' .specs-fire/state.yaml && fail "claimed_by not cleared" || ok "claim cleared"
# 4. Worktree torn down, branch deleted
[ "$(git worktree list | wc -l)" -eq 1 ] && ok "no leftover worktree" || fail "worktree left behind"
git branch --list 'fire-intent/*' | grep -q . && fail "fire-intent branch left behind" || ok "intent branch deleted"
# 5. Pushed: main == origin/main
git fetch -q origin
[ "$(git rev-parse main)" = "$(git rev-parse origin/main)" ] \
  && ok "pushed to origin" || fail "main not pushed to origin"
# 6. Work-item statuses
for wi in add-add add-mul add-calc; do
  grep -A6 "id: $wi" .specs-fire/state.yaml | grep -q 'status: completed' \
    && ok "$wi completed" || fail "$wi not completed"
done

[ "$FAIL" -eq 0 ] && echo "E2E SMOKE: PASS" || echo "E2E SMOKE: FAIL"
exit "$FAIL"
