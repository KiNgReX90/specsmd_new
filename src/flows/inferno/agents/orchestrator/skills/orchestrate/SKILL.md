---
name: orchestrate
description: Orchestration assets — intent-selection template and scheduler scripts. The procedure itself lives in the orchestrator agent definition.
version: 2.2.0
---

# Orchestrate

The complete orchestration procedure (intent selection, claim-on-select, contract validation, worktree, dispatch loop, error handling, halt/resume, finalize) lives in `../../agent.md`. Do not look for additional procedure here.

This skill owns the assets that procedure references:

- `./templates/intent-selection.md.hbs` — the runnable-intent menu rendered during intent selection (one numbered entry per runnable intent; single-entry [Y/n] variant).
- `./scripts/team-scheduler.cjs` (+ `team-scheduler.test.cjs`) — optional Node helpers for work-item contract validation and dependency-frontier computation.
