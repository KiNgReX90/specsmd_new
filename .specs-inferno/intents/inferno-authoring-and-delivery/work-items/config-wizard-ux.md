---
id: config-wizard-ux
title: Config wizard — display defaults and confirm
intent: inferno-authoring-and-delivery
kind: behavior
complexity: medium
mode: autopilot
status: completed
depends_on: [config-template]
created: 2026-06-17T00:00:00Z
---

# Work Item: Config wizard — display defaults and confirm

## Description

Rewrite `commands/inferno-config.md` from key-by-key interrogation into a
display-defaults-and-confirm flow. On run it SHOWS the effective defaults in plain
language — "complex work items -> the strong model", "simple work items -> the
fast model", "build is reviewed before it starts", "delivery: autonomous
auto-close vs production merge-requests" — and asks the user to confirm or adjust,
rather than asking about each key in turn. Raw model IDs stay in the background
(the user sees tier descriptions, not `opus`/`sonnet`). When delivery is set to
merge-request, propose the base branch and let the user confirm or change it.
Preserve "skip -> documented defaults" and keep the written file minimal (only
keys the user actually chose).

## Acceptance Criteria

- [ ] The command displays the current/default values in plain language before asking anything
- [ ] The user confirms or adjusts as a whole; it does NOT interrogate each key one-by-one
- [ ] Tiers are described in plain language ("complex"/"simple" work items); raw model IDs are not shown as the primary prompt
- [ ] Delivery mode is surfaced (autonomous auto-close vs production merge-request); when merge-request, the base branch is proposed and confirmable
- [ ] Skipping leaves keys absent and the documented defaults apply; the written file stays minimal
- [ ] `cd src && npm run validate:all` passes

## Execution Manifest

context:
  required:
    - path: src/flows/inferno/commands/inferno-config.md
      reason: the wizard command to rewrite
  patterns:
    - path: src/flows/inferno/agents/orchestrator/config.example.yaml
      reason: the keys, defaults, and plain-language descriptions the wizard reflects
  tests:
    - path: src/__tests__/unit/inferno/inferno-flow.test.ts
      reason: FIRE-namespace + flow guards over the edited command; validate:all gate
ownership:
  editable:
    - src/flows/inferno/commands/inferno-config.md

## Technical Notes

The planner's first-run gate (`planner-agent-updates`) invokes this procedure, so
the UX defined here is what a new project sees on first run.

## Dependencies

- config-template
