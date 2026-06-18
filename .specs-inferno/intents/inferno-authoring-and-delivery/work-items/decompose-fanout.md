---
id: decompose-fanout
title: Fan out work-item writing to parallel scribe subagents
intent: inferno-authoring-and-delivery
kind: behavior
complexity: medium
mode: autopilot
status: completed
depends_on: [writer-agent]
created: 2026-06-17T00:00:00Z
---

# Work Item: Fan out work-item writing to parallel scribe subagents

## Description

Rewrite step 8 ("Save Work Items") of `work-item-decompose/SKILL.md` so the
writing is parallel while all reasoning stays in the planner. After the user
approves the plan (step 7), the planner emits a COMPLETE decision record per work
item (every template field decided: title, kind, complexity, depends_on,
acceptance criteria, full context manifest with real paths+reasons, ownership,
optional finalize_check / technical notes). It then dispatches one
`specsmd-inferno-writer` subagent per item IN PARALLEL — each given only its
decision record, the template path, and its output path — to render
`work-items/{id}.md`. After all writers return, the PLANNER alone performs the
single `state.yaml` work-items-list update. Writers never edit `state.yaml`.
Dispatch writers on `models.writer` (falling back to `models.cheap`, then host
default). Provide a fallback: on hosts without subagents, the planner writes the
files itself sequentially.

## Acceptance Criteria

- [ ] Step 8 keeps the step-7 approval gate BEFORE any writing
- [ ] Step 8 specifies the planner produces a complete per-item decision record (no field left to the scribe to decide)
- [ ] Step 8 dispatches one `specsmd-inferno-writer` per item in parallel; each prompt carries only {decision record, template path, output path}
- [ ] Writers are dispatched with model = `models.writer` (default `models.cheap`; no config -> host default)
- [ ] The planner — not the writers — updates `state.yaml` once, after all writers return
- [ ] A documented sequential fallback exists for hosts without subagents
- [ ] `cd src && npm run validate:all` passes

## Execution Manifest

context:
  required:
    - path: src/flows/inferno/agents/planner/skills/work-item-decompose/SKILL.md
      reason: the skill whose step 8 is rewritten
  patterns:
    - path: src/flows/inferno/agents/orchestrator/agent.md
      reason: the parallel-dispatch + per-dispatch model-override pattern (dispatch_loop) to mirror
    - path: src/flows/inferno/agents/writer/agent.md
      reason: the scribe input/result contract this fan-out must feed
  tests:
    - path: src/__tests__/unit/inferno/inferno-flow.test.ts
      reason: FIRE-namespace + flow guards over the edited skill; validate:all gate
ownership:
  editable:
    - src/flows/inferno/agents/planner/skills/work-item-decompose/SKILL.md

## Technical Notes

Keep the planner as the sole writer of `state.yaml` and the sole holder of
cross-item reasoning (dependency/ownership validation in step 6 is unchanged).
The fan-out is purely the file-rendering stage.

## Dependencies

- writer-agent
