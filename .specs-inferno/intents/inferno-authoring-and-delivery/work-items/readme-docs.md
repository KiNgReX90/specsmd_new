---
id: readme-docs
title: README — document authoring, tiers, and delivery modes
intent: inferno-authoring-and-delivery
kind: docs-only
complexity: low
mode: autopilot
status: pending
depends_on: [decompose-fanout, config-wizard-ux, delivery-mode-impl]
created: 2026-06-17T00:00:00Z
---

# Work Item: README — document authoring, tiers, and delivery modes

## Description

Update `src/flows/inferno/README.md` to reflect the final behavior: parallel
scribe authoring (the Opus planner reasons and decides every field; scribe
subagents render one file per work item in parallel), the `models.writer` tier,
the first-run display-and-confirm config UX, the default tiers (low -> Sonnet,
medium+high -> Opus @ xhigh, kind config/docs/test -> Sonnet) and effort, and the
two delivery modes (`auto-close` vs `merge-request` trickle-down). Keep it
host-neutral and concise.

## Acceptance Criteria

- [ ] README documents the parallel scribe authoring model (reasoning stays in the planner)
- [ ] README documents `models.writer`, the default tier map, and `xhigh` strong-tier effort
- [ ] README documents the first-run display-and-confirm config UX
- [ ] README documents `delivery.mode` (auto-close vs merge-request) and the base-branch confirm
- [ ] No FIRE-namespace references; `cd src && npm run validate:all` passes

## Execution Manifest

context:
  required:
    - path: src/flows/inferno/README.md
      reason: the document to update
  patterns: []
  tests: []
ownership:
  editable:
    - src/flows/inferno/README.md

## Technical Notes

Runs last (depends on the feature items) so the prose matches shipped behavior.

## Dependencies

- decompose-fanout
- config-wizard-ux
- delivery-mode-impl
