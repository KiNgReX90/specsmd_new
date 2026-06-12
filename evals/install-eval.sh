#!/usr/bin/env bash
# Install eval: tarball-install the FIRE flow into a fresh sandbox for
# Claude Code + Codex, then assert the team-flow surfaces exist and the
# bundled flow script suites pass from the installed location.
set -uo pipefail

TARBALL="$(realpath "${1:?usage: install-eval.sh <path-to-specsmd-tarball>}")"
SANDBOX="$(mktemp -d /tmp/specsmd-install-eval.XXXXXX)"
FAIL=0

note() { printf '%s\n' "$*"; }
req()  { if [ -e "$SANDBOX/$1" ]; then note "OK   $1"; else note "MISS $1"; FAIL=1; fi; }
absent() { if [ -e "$SANDBOX/$1" ]; then note "UNEXPECTED $1"; FAIL=1; else note "OK   (absent) $1"; fi; }

note "sandbox: $SANDBOX"
cd "$SANDBOX"
git init -q
# Pre-create detect dirs so the tool multiselect pre-selects Claude Code + Codex
mkdir -p .claude .codex

# Drive the interactive installer in a PTY:
#   Enter -> confirm pre-selected (detected) tools
#   Enter -> select FIRE (first flow in the list)
{ sleep 12; printf '\r'; sleep 3; printf '\r'; sleep 45; } | \
  SPECSMD_TELEMETRY_DISABLED=1 script -qec "npx -y --package=\"$TARBALL\" specsmd install" /dev/null \
  > install.log 2>&1
note "--- installer tail ---"; tail -n 12 install.log; note "----------------------"

# Flow tree
req .specsmd/fire/agents/team/agent.md
req .specsmd/fire/agents/team/config.example.yaml
req .specsmd/fire/agents/team/skills/orchestrate/SKILL.md
req .specsmd/fire/agents/team/skills/orchestrate/scripts/team-scheduler.cjs
req .specsmd/fire/agents/team/skills/orchestrate/templates/intent-selection.md.hbs
req .specsmd/fire/agents/team-builder/agent.md
req .specsmd/fire/agents/team-builder/skills/workitem-execute/SKILL.md
req .specsmd/fire/agents/team-planner/agent.md
req .specsmd/fire/agents/team-planner/skills/work-item-decompose/SKILL.md
req .specsmd/fire/agents/team-planner/skills/work-item-decompose/templates/work-item.md.hbs
# Upstream baseline must coexist untouched
req .specsmd/fire/agents/orchestrator/agent.md
req .specsmd/fire/memory-bank.yaml
# Claude Code surfaces (commands + agents) for all four team commands
for n in fire-team fire-team-planner fire-team-builder fire-team-config; do
  req ".claude/commands/specsmd-$n.md"
  req ".claude/agents/specsmd-$n.md"
  req ".codex/skills/specsmd-$n/SKILL.md"
done
# The installed builder agent must be the full system prompt with subagent frontmatter
grep -q '^name: specsmd-fire-team-builder' "$SANDBOX/.claude/agents/specsmd-fire-team-builder.md" \
  && note "OK   builder agent frontmatter (name)" \
  || { note "FAIL builder agent frontmatter (name)"; FAIL=1; }
grep -q 'Team Builder Agent' "$SANDBOX/.claude/agents/specsmd-fire-team-builder.md" \
  && note "OK   builder agent carries full body" \
  || { note "FAIL builder agent body missing"; FAIL=1; }
# Nothing should reference the retired sync script
if grep -rqs 'sync-claude-agent' "$SANDBOX/.specsmd" "$SANDBOX/.claude"; then
  note "FAIL retired sync-claude-agent still referenced"; FAIL=1
else
  note "OK   no sync-claude-agent references"
fi
absent .specsmd/fire/agents/team-builder/scripts/sync-claude-agent.cjs

# Flow script suites run from the installed location
( cd "$SANDBOX" && node .specsmd/fire/agents/team/skills/orchestrate/scripts/team-scheduler.test.cjs ) \
  && note "OK   team-scheduler suite" || { note "FAIL team-scheduler suite"; FAIL=1; }
( cd "$SANDBOX" && node .specsmd/fire/agents/team-planner/skills/work-item-decompose/scripts/team-work-item-contract.test.cjs ) \
  && note "OK   work-item contract suite" || { note "FAIL work-item contract suite"; FAIL=1; }

if [ "$FAIL" -eq 0 ]; then
  note "INSTALL EVAL: PASS (sandbox kept at $SANDBOX)"
else
  note "INSTALL EVAL: FAIL (inspect $SANDBOX, install.log)"
fi
exit "$FAIL"
