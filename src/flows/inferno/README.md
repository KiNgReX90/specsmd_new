# INFERNO Flow

**Autonomous parallel execution.** INFERNO decomposes an intent into work items and runs parallel autopilot builder subagents inside one intent worktree, with dependency-frontier scheduling, file-ownership mutual-exclusion, claim-on-select intent locking, and an orchestrator-verified merge gate.

INFERNO is a standalone specsmd flow — chosen at install time *instead of* FIRE. It has its own `.specs-inferno/` artifact namespace and does not share state with any other flow.

## Surfaces

| Command | Role |
|---|---|
| `/specsmd-inferno` | Orchestrator: selects an intent, runs the parallel build to a verified merge |
| `/specsmd-inferno-planner` | Captures an intent and decomposes it into work items |
| `/specsmd-inferno-builder` | Subagent dispatched by the orchestrator for exactly one work item |
| `/specsmd-inferno-writer` | Pure-scribe subagent dispatched by the planner to render exactly one work-item file |
| `/specsmd-inferno-config` | Wizard for the optional `.specs-inferno/config.yaml` |

## What's different from FIRE

- **No friction gates during planning.** Intent capture flows straight into work-item decomposition with no confirmation prompt. Whether decomposition then flows straight into the build is governed by `autonomy.level` in `.specs-inferno/config.yaml` (`full` = auto-build; `review`/unset = stop so you can read the plans).
- **Every work item runs in autopilot.** Review happens at planning time and at the orchestrator's verified finalize, not via per-item checkpoints.
- **Parallel scribe authoring.** The planner (a strong model) does ALL decomposition reasoning, then fans the *writing* out to parallel `specsmd-inferno-writer` scribes — one file per work item — so authoring many work items doesn't serialize. Scribes make no decisions and never touch state; the planner alone updates `state.yaml`.

## Model tiers & effort

The orchestrator dispatches builders by complexity: medium/high → the strong tier at `xhigh` effort, low (and kind config-only/docs-only/test) → the cheap tier. The planner's scribes run on a `writer` tier (defaults to the cheap tier). Defaults: strong `opus`, cheap `sonnet`. Effort rides the builder agent frontmatter, not a per-dispatch override.

## Delivery modes

`delivery.mode` selects how an intent closes:

- **`auto-close`** (default, autonomous) — items commit onto the intent branch; at finalize the orchestrator merges locally into the base branch, tears down the worktree, and pushes.
- **`merge-request`** (production) — each item lands on the intent branch via a non-blocking per-item MR, and at finalize the orchestrator pushes the intent branch and opens one MR into a confirmed base branch as the single human review gate, then stops. Forge-aware (gh / glab), degrading gracefully when neither is present.

## Per-project config

Optional `.specs-inferno/config.yaml` carries worker model tiers (`strong` / `cheap` / `writer`), the finalize verification gate, the autonomy level, the delivery mode, and optional budget-halt / knowledge-base settings. First run shows the defaults in plain language and lets you confirm or adjust. See `agents/orchestrator/config.example.yaml` or run `/specsmd-inferno-config`. Every key is optional; without the file the flow runs on host/project defaults.
