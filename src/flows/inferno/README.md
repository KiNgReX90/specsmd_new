# INFERNO Flow

**Autonomous parallel execution.** INFERNO decomposes an intent into work items and runs parallel autopilot builder subagents inside one intent worktree, with dependency-frontier scheduling, file-ownership mutual-exclusion, claim-on-select intent locking, and an orchestrator-verified merge gate.

INFERNO is a standalone specsmd flow — chosen at install time *instead of* FIRE. It has its own `.specs-inferno/` artifact namespace and does not share state with any other flow.

## Surfaces

| Command | Role |
|---|---|
| `/specsmd-inferno` | Orchestrator: selects an intent, runs the parallel build to a verified merge |
| `/specsmd-inferno-planner` | Captures an intent and decomposes it into work items |
| `/specsmd-inferno-builder` | Subagent dispatched by the orchestrator for exactly one work item |
| `/specsmd-inferno-config` | Wizard for the optional `.specs-inferno/config.yaml` |

## What's different from FIRE

- **No friction gates during planning.** Intent capture flows straight into work-item decomposition with no confirmation prompt. Whether decomposition then flows straight into the build is governed by `autonomy.level` in `.specs-inferno/config.yaml` (`full` = auto-build; `review`/unset = stop so you can read the plans).
- **Every work item runs in autopilot.** Review happens at planning time and at the orchestrator's verified finalize, not via per-item checkpoints.

## Per-project config

Optional `.specs-inferno/config.yaml` carries worker model tiers, the finalize verification gate, the autonomy level, and optional budget-halt / knowledge-base settings. See `agents/orchestrator/config.example.yaml` or run `/specsmd-inferno-config`. Every key is optional; without the file the flow runs on host/project defaults.
