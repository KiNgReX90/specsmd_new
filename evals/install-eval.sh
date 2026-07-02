#!/usr/bin/env bash
# Install eval: tarball-install the INFERNO flow into a fresh sandbox for
# Claude Code + Codex, then assert the inferno-flow surfaces exist and the
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
#   Enter      -> confirm pre-selected (detected) tools
#   Down x5    -> move from FIRE (1st) to INFERNO (6th)
#                 menu order: fire, aidlc, aidlc-turbo, simple, ideation, inferno
#   Enter      -> select INFERNO
#   Enter x5   -> accept the five INFERNO config defaults, in order:
#                 mode (select, default production), strong/cheap/writer model
#                 tiers (text), finalize verification commands (text). Each
#                 prompt defaults on Enter, so plain \r accepts it.
{ sleep 12; printf '\r'; sleep 3; printf '\033[B\033[B\033[B\033[B\033[B'; sleep 1; printf '\r'; \
  sleep 3; printf '\r'; sleep 1; printf '\r'; sleep 1; printf '\r'; sleep 1; printf '\r'; sleep 1; printf '\r'; \
  sleep 45; } | \
  SPECSMD_TELEMETRY_DISABLED=1 script -qec "npx -y --package=\"$TARBALL\" specsmd install" /dev/null \
  > install.log 2>&1
note "--- installer tail ---"; tail -n 12 install.log; note "----------------------"

# Flow tree
req .specsmd/inferno/agents/orchestrator/agent.md
req .specsmd/inferno/agents/orchestrator/config.example.yaml
req .specsmd/inferno/agents/orchestrator/skills/orchestrate/SKILL.md
req .specsmd/inferno/agents/orchestrator/skills/orchestrate/scripts/team-scheduler.cjs
req .specsmd/inferno/agents/orchestrator/skills/orchestrate/templates/intent-selection.md.hbs
req .specsmd/inferno/agents/builder/agent.md
req .specsmd/inferno/agents/builder/skills/workitem-execute/SKILL.md
req .specsmd/inferno/agents/planner/agent.md
req .specsmd/inferno/agents/planner/skills/work-item-decompose/SKILL.md
req .specsmd/inferno/agents/planner/skills/work-item-decompose/templates/work-item.md.hbs
req .specsmd/inferno/README.md
# Install wizard scaffolds the per-project INFERNO config in the target repo
req .specs-inferno/config.yaml
# ...and the plain-Enter path yields the production-mode default
grep -q '^mode: production' "$SANDBOX/.specs-inferno/config.yaml" \
  && note "OK   config.yaml default mode: production" \
  || { note "FAIL config.yaml missing default mode: production"; FAIL=1; }
# Claude Code + Codex surfaces for all four inferno commands
for n in inferno inferno-planner inferno-builder inferno-config; do
  req ".claude/commands/specsmd-$n.md"
  req ".claude/agents/specsmd-$n.md"
  req ".codex/skills/specsmd-$n/SKILL.md"
done
# The installed builder agent must be the full system prompt with subagent frontmatter
grep -q '^name: specsmd-inferno-builder' "$SANDBOX/.claude/agents/specsmd-inferno-builder.md" \
  && note "OK   builder agent frontmatter (name)" \
  || { note "FAIL builder agent frontmatter (name)"; FAIL=1; }
grep -q 'INFERNO Builder' "$SANDBOX/.claude/agents/specsmd-inferno-builder.md" \
  && note "OK   builder agent carries full body" \
  || { note "FAIL builder agent body missing"; FAIL=1; }
# manifest records the flow
grep -q 'flow: inferno' "$SANDBOX/.specsmd/manifest.yaml" \
  && note "OK   manifest flow: inferno" \
  || { note "FAIL manifest missing flow: inferno"; FAIL=1; }
# Nothing should reference the retired sync script, FIRE-team surfaces, or .specs-fire
if grep -rqs 'sync-claude-agent' "$SANDBOX/.specsmd" "$SANDBOX/.claude"; then
  note "FAIL retired sync-claude-agent still referenced"; FAIL=1
else
  note "OK   no sync-claude-agent references"
fi
if grep -rqs '\.specs-fire' "$SANDBOX/.specsmd"; then
  note "FAIL .specs-fire namespace leaked into installed flow"; FAIL=1
else
  note "OK   no .specs-fire references"
fi
absent .claude/commands/specsmd-fire-team.md
absent .claude/commands/specsmd-fire-team-planner.md
absent .specsmd/fire

# Flow script suites run from the installed location
( cd "$SANDBOX" && node .specsmd/inferno/agents/orchestrator/skills/orchestrate/scripts/team-scheduler.test.cjs ) \
  && note "OK   team-scheduler suite" || { note "FAIL team-scheduler suite"; FAIL=1; }
( cd "$SANDBOX" && node .specsmd/inferno/agents/planner/skills/work-item-decompose/scripts/team-work-item-contract.test.cjs ) \
  && note "OK   work-item contract suite" || { note "FAIL work-item contract suite"; FAIL=1; }

if [ "$FAIL" -eq 0 ]; then
  note "INSTALL EVAL: PASS (sandbox kept at $SANDBOX)"
else
  note "INSTALL EVAL: FAIL (inspect $SANDBOX, install.log)"
fi
exit "$FAIL"
