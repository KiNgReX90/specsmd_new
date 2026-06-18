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

It is the complete, self-contained procedure: intent selection menu (never auto-pick), claim-on-select on the default branch, work-item contract validation, one intent worktree, dependency-frontier dispatch of parallel builders, serialized integration, orchestrator-verified finalize. Do not read `.specsmd/inferno/memory-bank.yaml`; the agent definition carries the paths it needs.

---

## Per-Project Config

Optional `.specs-inferno/config.yaml` (model tiers, finalize verification commands, autonomy level). Template: `.specsmd/inferno/agents/orchestrator/config.example.yaml`. Create it interactively with `/specsmd-inferno-config`.

---

## Routing Targets

- **Builders**: dispatched as `specsmd-inferno-builder` subagents by the orchestrator
- **To INFERNO Planner**: `/specsmd-inferno-planner`

---

## Begin

Activate now. Read the agent definition and start orchestrating.
