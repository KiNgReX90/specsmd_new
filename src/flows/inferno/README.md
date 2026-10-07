# INFERNO Flow

**Autonomous parallel execution.** INFERNO decomposes an intent into work items and runs parallel autopilot builder subagents inside one intent worktree, with dependency-frontier scheduling, file-ownership mutual-exclusion, claim-on-select intent locking, and an orchestrator-verified merge gate.

**Cross-intent reconciliation.** When the planner captures a new intent it reconciles it against the other open (non-completed) intents: it folds the new scope into an existing pending intent (*integrate*), records an intent-level `depends_on` so the orchestrator only offers it once its prerequisite intent has completed (*depend*), or confirms it is *independent*. A new intent is never queued blind to work already planned.

INFERNO is a standalone specsmd flow, chosen at install time *instead of* FIRE. It has its own `.specs-inferno/` artifact namespace and does not share state with any other flow.

## Surfaces

| Command | Role |
|---|---|
| `/specsmd-inferno` | Orchestrator: selects an intent, runs the parallel build to a verified merge |
| `/specsmd-inferno-intents` | Lists the open intents from state.yaml without activating the orchestrator |
| `/specsmd-inferno-planner` | Captures an intent and decomposes it into work items |
| `/specsmd-inferno-builder` | Subagent dispatched by the orchestrator for exactly one work item |
| `/specsmd-inferno-oracle` | Decision subagent spawned by the orchestrator (or any session) for a judgment call a builder or orchestrator would otherwise postpone; decides from the artifact, on the frontier tier, and a builder builds it |
| `/specsmd-inferno-config` | Wizard for the optional `.specs-inferno/config.yaml` |

## What's different from FIRE

- **No friction gates during planning.** Intent capture flows straight into work-item decomposition with no confirmation prompt. The planner writes the work items and STOPS; it never starts the build, which is always a separate, explicit step you run later with `/specsmd-inferno` (or `/schedule-inferno`). There is no review pause in any mode: the planner settles every choice the specs settle, returns what they leave open as an `oracle:` block in its summary, and returns a direct build as a `direct:` block for the launching session's builder, since work is built directly and an intent is the exception. `autonomy.level` in `.specs-inferno/config.yaml` no longer changes what the Claude planner does.
- **Every work item runs in autopilot.** Oversight is the specs and the oracle at planning time, and the orchestrator's verified finalize. No per-item checkpoints.
- **One planner body.** The planner grounds every claim in the live code, writes every brief and work item itself, and alone updates `state.yaml`. A high-complexity item carries its decisions under Technical Notes, so no separate design document is produced.

## Model tiers & effort

The orchestrator dispatches builders by complexity: medium/high → the strong tier, low → the cheap tier. A cold review follows every item, and rejections with a blocker or major finding, or a surviving mutant, climb a ladder: cheap to strong after one, strong to the escalate builder (`claude-opus-5-5` at `xhigh`) after two, and every two after that to the oracle. Minor findings alone stay with the warm builder, and a finding that repeats an earlier round goes to the oracle at once. Claude pins the planner to `claude-opus-5-5` at `xhigh`, the strong builder to `claude-opus-5-5` at `high`, and the cheap builder and the config role to `claude-sonnet-5-5` at `high`; the orchestrator runs on the session's own model. A host changes a pin in `roles:` of `.specs-inferno/config.yaml`, which the installer renders into the installed files. The oracle is pinned to `claude-opus-5-5` at `xhigh` and never tiered down: a mediocre implementation is caught by a test, a mediocre decision ships. Codex uses its isolated `.specs-inferno/config.codex.yaml` and `.codex/agents/*.toml` matrix: Sol/xhigh for strong roles and Terra/high for supporting roles.

## Delivery modes

`delivery.mode` selects how an intent closes:

- **`auto-close`** (default, autonomous): items commit onto the intent branch; at finalize the orchestrator merges locally into the base branch, tears down the worktree, and pushes.
- **`merge-request`** (production): each item lands on the intent branch via a non-blocking per-item MR, and at finalize the orchestrator pushes the intent branch and opens one MR into a confirmed base branch as the single human review gate, then stops. Forge-aware (gh / glab), degrading gracefully when neither is present.

## Per-project config

Optional `.specs-inferno/config.yaml` carries worker model tiers (`strong` / `cheap`), the finalize verification gate, the delivery mode, and optional budget-halt / knowledge-base settings. First run shows the defaults in plain language and lets you confirm or adjust. See `agents/orchestrator/config.example.yaml` or run `/specsmd-inferno-config`. Every key is optional; without the file the flow runs on host/project defaults.
