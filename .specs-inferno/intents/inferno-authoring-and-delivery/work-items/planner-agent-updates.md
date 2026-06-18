---
id: planner-agent-updates
title: Planner agent — document fan-out + first-run config gate
intent: inferno-authoring-and-delivery
kind: behavior
complexity: medium
mode: autopilot
status: pending
depends_on: [writer-agent, config-wizard-ux]
created: 2026-06-17T00:00:00Z
---

# Work Item: Planner agent — document fan-out + first-run config gate

## Description

Update `agents/planner/agent.md` for two things. (1) Document the scribe fan-out:
in `<work_item_decomposition_flow>` note that writing is delegated to parallel
`specsmd-inferno-writer` scribes after approval; add the writer dispatch to
`<output_artifacts>`; extend `<success_criteria>`. (2) Add a first-run config
gate to `<on_activation>`: when `.specs-inferno/config.yaml` is absent, run the
display-and-confirm config procedure (`/specsmd-inferno-config`) BEFORE intent
capture / decomposition, so a new project is shown its defaults (tiers, review,
delivery mode) and can confirm or adjust. Skipping still yields the documented
defaults (the "every key optional" invariant holds).

## Acceptance Criteria

- [ ] `<on_activation>` runs the config display-and-confirm when `.specs-inferno/config.yaml` is missing, before capture/decompose, and never re-prompts when config exists
- [ ] The gate routes to the `/specsmd-inferno-config` procedure rather than restating it
- [ ] `<work_item_decomposition_flow>` describes the post-approval parallel scribe fan-out (reasoning stays in the planner)
- [ ] `<output_artifacts>` and `<success_criteria>` mention the writer/scribe step
- [ ] No FIRE-namespace references introduced; `cd src && npm run validate:all` passes

## Execution Manifest

context:
  required:
    - path: src/flows/inferno/agents/planner/agent.md
      reason: the agent definition to update
  patterns:
    - path: src/flows/inferno/commands/inferno-config.md
      reason: the display-and-confirm procedure the first-run gate invokes
  tests:
    - path: src/__tests__/unit/inferno/inferno-flow.test.ts
      reason: FIRE-namespace + flow guards over the edited agent; validate:all gate
ownership:
  editable:
    - src/flows/inferno/agents/planner/agent.md

## Technical Notes

Depends on `config-wizard-ux` so the gate references the final display-and-confirm
flow, and on `writer-agent` so the fan-out documentation names a real agent. This
WI owns only `planner/agent.md`; the step-8 procedure itself is rewritten in
`decompose-fanout` (different file, no overlap).

## Dependencies

- writer-agent
- config-wizard-ux
