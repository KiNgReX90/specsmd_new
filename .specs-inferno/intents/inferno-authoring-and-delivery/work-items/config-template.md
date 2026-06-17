---
id: config-template
title: Config template — writer tier, effort, delivery mode
intent: inferno-authoring-and-delivery
kind: config-only
complexity: low
mode: autopilot
status: pending
depends_on: []
created: 2026-06-17T00:00:00Z
---

# Work Item: Config template — writer tier, effort, delivery mode

## Description

Extend the annotated config template `agents/orchestrator/config.example.yaml`
with the new keys, all optional and documented in plain language:
- `models.writer` — model for the planner's scribe subagents; default = `models.cheap`.
- An effort note: the strong tier reasons at `xhigh` (carried in builder agent
  frontmatter); document it so users understand the default.
- `delivery.mode` — `auto-close` (local merge + close, the default/autonomous mode)
  or `merge-request` (production: per-item MRs into the intent, intent MR into the
  base branch). Plus `delivery.base_branch` (optional; the orchestrator proposes
  and the user confirms when unset).
Keep `autonomy.level`, `models.strong: opus`, `models.cheap: sonnet`,
`verification.finalize`, and the existing optional extras intact.

## Acceptance Criteria

- [ ] `models.writer` documented with default = `models.cheap`
- [ ] `delivery.mode` documented with both values and a stated default (`auto-close`), plus `delivery.base_branch`
- [ ] The `xhigh` strong-tier effort default is documented (noting it lives in builder frontmatter, not a per-dispatch override)
- [ ] All new keys are optional with documented fallbacks; existing keys unchanged
- [ ] No hardcoded forge or branch name; `cd src && npm run validate:all` passes

## Execution Manifest

context:
  required:
    - path: src/flows/inferno/agents/orchestrator/config.example.yaml
      reason: the template to extend
  patterns: []
  tests: []
ownership:
  editable:
    - src/flows/inferno/agents/orchestrator/config.example.yaml

## Technical Notes

This is the schema/source-of-truth for keys that `config-wizard-ux` (the wizard),
`decompose-fanout` (reads `models.writer`), and `delivery-mode-impl` (reads
`delivery.*`) all depend on — hence several items depend on this one.

## Dependencies

(none)
