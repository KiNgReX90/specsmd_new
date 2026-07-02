# INFERNO Flow

**Autonomous parallel execution.** INFERNO decomposes an intent into work items and runs parallel autopilot builder subagents inside one intent worktree, with dependency-frontier scheduling, file-ownership mutual-exclusion, claim-on-select intent locking, and an orchestrator-verified merge gate.

**Cross-intent reconciliation.** When the planner captures a new intent it reconciles it against the other open (non-completed) intents: it folds the new scope into an existing pending intent (*integrate*), records an intent-level `depends_on` so the orchestrator only offers it once its prerequisite intent has completed (*depend*), or confirms it is *independent*. A new intent is never queued blind to work already planned.

INFERNO is a standalone specsmd flow — chosen at install time *instead of* FIRE. It has its own `.specs-inferno/` artifact namespace and does not share state with any other flow.

## Getting started

`npx specsmd install` installs the flow files and scaffolds `.specs-inferno/config.yaml` with a short interactive prompt (mode, model tiers, finalize verification — every value defaults sanely on Enter). Start with `/specsmd-inferno-planner` to capture your first intent; the build is always the separate, explicit `/specsmd-inferno` step you run later.

## Surfaces

| Command | Role |
|---|---|
| `/specsmd-inferno` | Orchestrator: selects an intent, runs the parallel build to a verified merge |
| `/specsmd-inferno-planner` | Captures an intent and decomposes it into work items |
| `/specsmd-inferno-builder` | Subagent dispatched by the orchestrator for exactly one work item |
| `/specsmd-inferno-writer` | Pure-scribe subagent dispatched by the planner to render exactly one work-item file |
| `/specsmd-inferno-config` | Wizard for the optional `.specs-inferno/config.yaml` |

## What's different from FIRE

- **No friction gates during planning.** Intent capture flows straight into work-item decomposition with no confirmation prompt. The planner writes the work items and STOPS — it never starts the build; the build is always a separate, explicit step you run later with `/specsmd-inferno` (or `/schedule-inferno`). The top-level `mode: production | autonomous` in `.specs-inferno/config.yaml` controls intake depth, the post-write review pause, and the delivery default: `production` (default) runs a staged deep-intake questionnaire during intent capture — core questions, then a mandatory deep-dive across functional edge cases, error handling, data/storage, integrations, and NFRs, then a full summary approval — and pauses EXACTLY ONCE right after planning to surface only the urgent or questionable points (open design questions, risky assumptions, ambiguities, deferred items) and let you weigh in / inspect the work items, then stops. `autonomous` runs one lean, open-ended intake pass and writes the items with no review pause. Neither mode adds per-item checkpoints. *(Migration: a legacy `autonomy.level` key still works — `review` maps to `production`, `full` maps to `autonomous`; both absent also means `production`.)*
- **Every work item runs in autopilot.** Oversight under `production` is the single urgent-only review point right after planning; otherwise it's the orchestrator's verified finalize. No per-item checkpoints, and the design-doc step is never a mandatory gate.
- **Parallel scribe authoring.** The planner (a strong model) does ALL decomposition reasoning, then fans the *writing* out to parallel `specsmd-inferno-writer` scribes — one file per work item — so authoring many work items doesn't serialize. Scribes make no decisions and never touch state; the planner alone updates `state.yaml`.

## Model tiers & effort

The orchestrator dispatches builders by complexity: medium/high → the strong tier at `xhigh` effort, low (and kind config-only/docs-only/test) → the cheap tier. The planner's scribes run on a `writer` tier (defaults to the cheap tier). Defaults: strong `opus`, cheap `sonnet`. Effort rides the builder agent frontmatter, not a per-dispatch override.

## Delivery modes

Delivery resolves top to bottom: an explicit `delivery.mode` always wins; otherwise it derives from the top-level `mode` (`production` -> `merge-request`, `autonomous` -> `auto-close`); with both `mode` and `delivery.mode` absent it defaults to `production`, i.e. `merge-request`.

- **`auto-close`** (autonomous mode's default) — items commit onto the intent branch; at finalize the orchestrator merges locally into the base branch, tears down the worktree, and pushes.
- **`merge-request`** (production mode's default, and the overall default when `mode`/`delivery.mode` are both unset) — each item lands on the intent branch via a non-blocking per-item MR, and at finalize the orchestrator pushes the intent branch and opens one MR into a confirmed base branch as the single human review gate, then stops. Forge-aware (gh / glab), degrading gracefully when neither is present.

## Per-project config

`npx specsmd install` scaffolds `.specs-inferno/config.yaml` at install time — the primary creation path. A pre-existing `config.yaml` is never overwritten (and no config questions are asked): re-running the installer refreshes the flow surfaces but keeps your tuned config. It carries the top-level `mode` (`production` | `autonomous`), worker model tiers (`strong` / `cheap` / `writer`), the finalize verification gate, an optional `delivery.mode` override, and optional budget-halt / knowledge-base settings. `/specsmd-inferno-config` is the create-or-edit command: run it to review or change the config afterward (e.g. switching mode mid-project), or as a fallback display-and-confirm gate on the planner's first run if the file is somehow still absent. See `agents/orchestrator/config.example.yaml` for the full annotated schema. Every key is optional; without the file the flow runs on host/project defaults (behaves as `production`).
