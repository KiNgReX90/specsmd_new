---
description: INFERNO Intents - list the open intents from state.yaml without activating the orchestrator
allowed-tools: Bash(node .specsmd/inferno/agents/orchestrator/skills/orchestrate/scripts/run.cjs select)
---

# INFERNO Intents

**Command**: `/specsmd-inferno-intents`

The selector already ran. Its output is below, injected at expansion, so the list costs no tool call:

!`node .specsmd/inferno/agents/orchestrator/skills/orchestrate/scripts/run.cjs select`

---

## Report it

Present that output as the list of intents, grouped the way it is printed:

- `claimable`, with their item grades and tester cases
- `blocked`, with what each one waits on
- `parked`, with the reason it is parked
- `running`, with the step it is on, never offered
- `recover` candidates, with the reason each is a candidate
- `leftover`, with the worktree a finished run left standing

Keep every intent id verbatim. Name an empty group instead of dropping it, for example when the output opens with `no claimable intent`.

## Then stop

- Read nothing else. Not the orchestrator definition, not its skill files, not `.specs-inferno/state.yaml`, not a brief, not a work item. The output above is the whole answer.
- Claim nothing, unblock nothing, tear down nothing, dispatch nothing.
- Offer no numbered menu and ask no follow-up question.

To run one: `/specsmd-inferno <intent-id>`.
