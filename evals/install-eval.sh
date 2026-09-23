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
#   Down x4    -> move from FIRE (1st) to INFERNO (5th)
#   Enter      -> select INFERNO
{ sleep 12; printf '\r'; sleep 3; printf '\033[B\033[B\033[B\033[B'; sleep 1; printf '\r'; sleep 45; } | \
  SPECSMD_TELEMETRY_DISABLED=1 script -qec "npx -y --package=\"$TARBALL\" specsmd install" /dev/null \
  > install.log 2>&1
note "--- installer tail ---"; tail -n 12 install.log; note "----------------------"

# Flow tree
req .specsmd/inferno/agents/orchestrator/agent.md
req .specsmd/inferno/agents/orchestrator/config.example.yaml
req .specsmd/inferno/agents/orchestrator/skills/orchestrate/SKILL.md
req .specsmd/inferno/agents/orchestrator/skills/orchestrate/scripts/team-scheduler.cjs
req .specsmd/inferno/agents/orchestrator/skills/orchestrate/scripts/run.cjs
req .specsmd/inferno/agents/orchestrator/skills/orchestrate/scripts/run.test.cjs
req .specsmd/inferno/agents/orchestrator/skills/orchestrate/templates/intent-selection.md.hbs
req .specsmd/inferno/agents/builder/agent.md
req .specsmd/inferno/agents/builder/skills/workitem-execute/SKILL.md
req .specsmd/inferno/agents/planner/agent.md
req .specsmd/inferno/agents/planner/templates/brief.md.hbs
req .specsmd/inferno/agents/planner/templates/work-item.md.hbs
req .specsmd/inferno/agents/oracle/agent.md
req .specsmd/inferno/README.md
req .specsmd/inferno/README.codex.md

# Claude Code keeps its six command/agent wrappers.
for n in inferno inferno-planner inferno-builder inferno-builder-cheap inferno-config inferno-oracle; do
  req ".claude/commands/specsmd-$n.md"
  req ".claude/agents/specsmd-$n.md"
done

# Codex installs its native project skills and custom agents, not converted
# Claude command bodies under .codex/skills.
for n in inferno inferno-planner inferno-builder inferno-config; do
  req ".agents/skills/specsmd-$n/SKILL.md"
  req ".agents/skills/specsmd-$n/references/procedure.md"
  req ".agents/skills/specsmd-$n/agents/openai.yaml"
done
# The intents skill lists the open intents and is one screen, so its whole body
# is the SKILL.md and it ships no procedure reference.
req ".agents/skills/specsmd-inferno-intents/SKILL.md"
req ".agents/skills/specsmd-inferno-intents/agents/openai.yaml"
absent .agents/skills/specsmd-inferno-intents/references
# The orchestrator is the session's main thread, so it has no custom agent file.
for n in planner builder_strong builder_cheap config oracle; do
  req ".codex/agents/specsmd_inferno_$n.toml"
done
absent .codex/agents/specsmd_inferno_orchestrator.toml
req AGENTS.md
absent .codex/skills/specsmd-inferno

# Exact host model matrices remain isolated. The orchestrator is the main thread
# and inherits the session's model and effort, so its command pins neither.
for n in inferno; do
  grep -q '^model:' ".claude/agents/specsmd-$n.md" \
    && { note "FAIL Claude orchestrator pins a model: $n"; FAIL=1; }
  grep -q '^effort:' ".claude/agents/specsmd-$n.md" \
    && { note "FAIL Claude orchestrator pins an effort: $n"; FAIL=1; }
done
for n in inferno-planner inferno-builder; do
  grep -q '^model: claude-opus-5$' ".claude/agents/specsmd-$n.md" \
    || { note "FAIL Claude strong model: $n"; FAIL=1; }
  grep -q '^effort: xhigh$' ".claude/agents/specsmd-$n.md" \
    || { note "FAIL Claude strong effort: $n"; FAIL=1; }
done
for n in inferno-builder-cheap inferno-config; do
  grep -q '^model: claude-sonnet-4-6$' ".claude/agents/specsmd-$n.md" \
    || { note "FAIL Claude support model: $n"; FAIL=1; }
  grep -q '^effort: high$' ".claude/agents/specsmd-$n.md" \
    || { note "FAIL Claude support effort: $n"; FAIL=1; }
done
# The oracle decides what a builder or the orchestrator would otherwise postpone,
# so it is pinned to the frontier tier and never tiered down.
grep -q '^model: claude-opus-5-5$' ".claude/agents/specsmd-inferno-oracle.md" \
  || { note "FAIL Claude oracle model"; FAIL=1; }
grep -q '^effort: max$' ".claude/agents/specsmd-inferno-oracle.md" \
  || { note "FAIL Claude oracle effort"; FAIL=1; }
for n in planner builder_strong; do
  grep -q '^model = "gpt-5.6-sol"$' ".codex/agents/specsmd_inferno_$n.toml" \
    || { note "FAIL Codex Sol model: $n"; FAIL=1; }
  grep -q '^model_reasoning_effort = "xhigh"$' ".codex/agents/specsmd_inferno_$n.toml" \
    || { note "FAIL Codex Sol effort: $n"; FAIL=1; }
done
# The Codex oracle answers the same judgment calls as the Claude one, so it sits
# on that fleet's frontier tier instead of the builder tier.
grep -q '^model = "gpt-6-astra"$' ".codex/agents/specsmd_inferno_oracle.toml" \
  || { note "FAIL Codex oracle model"; FAIL=1; }
grep -q '^model_reasoning_effort = "xhigh"$' ".codex/agents/specsmd_inferno_oracle.toml" \
  || { note "FAIL Codex oracle effort"; FAIL=1; }
for n in builder_cheap config; do
  grep -q '^model = "gpt-5.6-terra"$' ".codex/agents/specsmd_inferno_$n.toml" \
    || { note "FAIL Codex Terra model: $n"; FAIL=1; }
  grep -q '^model_reasoning_effort = "high"$' ".codex/agents/specsmd_inferno_$n.toml" \
    || { note "FAIL Codex Terra effort: $n"; FAIL=1; }
done
if grep -rqs '^sandbox_mode[[:space:]]*=' "$SANDBOX/.codex/agents"; then
  note "FAIL Codex agents pin sandbox_mode"; FAIL=1
else
  note "OK   Codex agents inherit parent sandbox"
fi
if grep -rEqs 'gpt[- ]?5([. ]?)5' "$SANDBOX/.specsmd" "$SANDBOX/.claude" "$SANDBOX/.agents" "$SANDBOX/.codex"; then
  note "FAIL obsolete GPT-5.5 setting installed"; FAIL=1
else
  note "OK   no obsolete GPT-5.5 setting"
fi
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

# Discover every installed suite, including newly added safety regressions.
shopt -s globstar nullglob
suites=("$SANDBOX"/.specsmd/inferno/agents/**/*.test.cjs)
if [ "${#suites[@]}" -eq 0 ]; then
  note "FAIL no installed flow script suites"; FAIL=1
fi
for suite in "${suites[@]}"; do
  relative="${suite#"$SANDBOX"/}"
  ( cd "$SANDBOX" && node "$relative" ) \
    && note "OK   $relative" || { note "FAIL $relative"; FAIL=1; }
done

if [ "$FAIL" -eq 0 ]; then
  note "INSTALL EVAL: PASS (sandbox kept at $SANDBOX)"
else
  note "INSTALL EVAL: FAIL (inspect $SANDBOX, install.log)"
fi
exit "$FAIL"
