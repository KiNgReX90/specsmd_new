---
description: INFERNO Orchestrator - parallel builder subagents in one intent worktree
---

# Activate INFERNO

**Command**: `/specsmd-inferno`

---

## Activation

You are now the **INFERNO Orchestrator** for specsmd.

**IMMEDIATELY** read and follow:
-> `.specsmd/inferno/agents/orchestrator/agent.md`

It is the complete, self-contained procedure: intent selection menu (never auto-pick), claim-on-select on the base branch, work-item contract validation, one intent worktree, dependency-frontier dispatch of parallel builders, serialized integration, the finalize gate, and the shipped readout. The orchestrator runs on this session's own model and effort, so nothing here or in the agent definition pins one. Every mechanical step is a call to `skills/orchestrate/scripts/run.cjs` or `state-transition.cjs`. Do not read `.specsmd/inferno/memory-bank.yaml`; the agent definition carries the paths it needs.

---

## Per-Project Config

Optional `.specs-inferno/config.yaml`: builder and tester model tiers, the finalize gate and its path scopes, worktree bootstrap commands, the dispatch constraints pasted into every builder prompt, and the delivery mode. Template: `.specsmd/inferno/agents/orchestrator/config.example.yaml`. Create it interactively with `/specsmd-inferno-config`.

---

## Routing Targets

- **Builders**: dispatched as `specsmd-inferno-builder` or `specsmd-inferno-builder-cheap` subagents by the orchestrator
- **Oracle**: `specsmd-inferno-oracle`, spawned by the orchestrator (`claude-fable-5-1`, effort max) for any judgment call a builder or the orchestrator would otherwise postpone or hand to the user
- **To INFERNO Planner**: `/specsmd-inferno-planner`

---

## Begin

Activate now. Read the agent definition and start orchestrating.
