---
name: orchestrate
description: Orchestration assets — intent-selection template and scheduler scripts. The procedure itself lives in the orchestrator agent definition.
version: 2.3.0
---

# Orchestrate

The complete orchestration procedure (intent selection, claim-on-select, contract validation, worktree, dispatch loop, error handling, halt/resume, finalize) lives in `../../agent.md`. Do not look for additional procedure here.

This skill owns the assets that procedure references:

- `./templates/intent-selection.md.hbs` — the runnable-intent menu rendered during intent selection (one numbered entry per runnable intent; single-entry [Y/n] variant).
- `./scripts/team-scheduler.cjs` (+ `team-scheduler.test.cjs`) — optional Node helpers for work-item contract validation and dependency-frontier computation.
- `./scripts/state-transition.cjs` (+ `state-transition.test.cjs`) — **mandatory, not optional**: the single writer for every `.specs-inferno/state.yaml` status transition. `complete-item` (dispatch loop step 6a), `close-intent` (finalize step 2), `check` (finalize step 1b, recovery). Zero dependencies — Node stdlib only, so it runs in any consumer project — and it edits surgically, line by line, so the comment blocks the planner writes into state.yaml survive and concurrent sessions do not conflict. Idempotent: re-running a transition is always safe. Hand-editing state.yaml instead of calling this is the flow's historical failure mode; see the <constraints/> in `../../agent.md`.
