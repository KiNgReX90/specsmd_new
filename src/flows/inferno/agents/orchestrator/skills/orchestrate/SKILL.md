---
name: orchestrate
description: Orchestration assets, the intent-selection template and the scheduler scripts. The procedure itself lives in the orchestrator agent definition.
version: 2.5.0
---

# Orchestrate

The complete orchestration procedure (intent selection, claim-on-select, contract validation, worktree, dispatch loop, error handling, halt and resume, finalize) lives in `../../agent.md`. Do not look for additional procedure here.

This skill owns the assets that procedure references:

- `./scripts/run.cjs`: the orchestrator's mechanical steps, one subcommand each. `select` (claimable and recoverable intents), `claim` and `unclaim`, `worktree` (branch, worktree, `worktree.bootstrap`), `frontier` (work-item contract validation, the ready set with tiers, overlaps and batch suggestions), `verify-item`, `gate` (the `verification.finalize` commands, scoped by `verification.finalize_scopes`, with a green marker per code tree; `--detach` starts it as its own process and `--wait` blocks on it in slices that fit a host's per-call cap), `green`, `ship` (fold, merge, push, verify, teardown), and `dispatch-log`. Every subcommand takes `--json` and prints at most 30 human lines otherwise. Exit codes: 0 ok, 1 usage, 2 failure with the reason printed, 3 gate needed, 4 gate still running. It never edits `.specs-inferno/state.yaml` itself; it calls the single writer below.
- `./templates/intent-selection.md.hbs`: the runnable-intent menu rendered during intent selection (one numbered entry per runnable intent; single-entry [Y/n] variant).
- `./scripts/team-scheduler.cjs` (+ `team-scheduler.test.cjs`): Node helpers for work-item contract validation and dependency-frontier computation, used by `run.cjs frontier`.
- `./scripts/state-transition.cjs` (+ `state-transition.test.cjs`), **mandatory, not optional**: the single writer for every `.specs-inferno/state.yaml` status transition. `claim-intent` (`run.cjs claim`), `complete-item` (integration), `close-intent` (finalize), `check` (reconciliation, recovery). Zero dependencies, Node stdlib only, so it runs in any consumer project, and it edits surgically, line by line, so the comment blocks the planner writes into state.yaml survive and concurrent sessions do not conflict. Idempotent: re-running a transition is always safe. Hand-editing state.yaml instead of calling this is the flow's historical failure mode; see the constraints in `../../agent.md`.
- `archive-intent` on that same writer is the finalize step after close: it moves a closed intent's block and directory into `.specs-inferno/archive/`, frees the id from every remaining intent's `depends_on_intents`, and with `--sweep` takes every other completed intent along. The live ledger holds open work only.
