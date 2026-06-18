---
id: builder-effort
title: Builder runs at xhigh effort
intent: inferno-authoring-and-delivery
kind: behavior
complexity: low
mode: autopilot
status: completed
depends_on: []
created: 2026-06-17T00:00:00Z
---

# Work Item: Builder runs at xhigh effort

## Description

Set `effort: xhigh` in the builder agent frontmatter so the Opus strong tier
reasons at maximum effort by default. Per-dispatch overrides are model-only, so
effort rides the agent definition's frontmatter (the mechanism the orchestrator
already documents). Keep the builder command/agent BODIES byte-identical so the
drift guard holds — frontmatter is stripped by the guard, so adding the key is
safe, but apply it consistently to `commands/inferno-builder.md` frontmatter too.

## Acceptance Criteria

- [ ] `src/flows/inferno/agents/builder/agent.md` frontmatter includes `effort: xhigh`
- [ ] `src/flows/inferno/commands/inferno-builder.md` frontmatter is consistent and its BODY remains byte-identical to the agent body
- [ ] The existing builder drift test still passes (bodies unchanged)
- [ ] `cd src && npm run validate:all` passes

## Execution Manifest

context:
  required:
    - path: src/flows/inferno/agents/builder/agent.md
      reason: canonical builder definition whose frontmatter gains effort
    - path: src/flows/inferno/commands/inferno-builder.md
      reason: installed command; body must stay byte-identical to the agent body
  patterns:
    - path: src/flows/inferno/agents/orchestrator/agent.md
      reason: documents that effort/reasoning settings live in agent frontmatter (not per-dispatch)
  tests:
    - path: src/__tests__/unit/inferno/inferno-flow.test.ts
      reason: the builder command<->agent drift guard that must keep passing
ownership:
  editable:
    - src/flows/inferno/agents/builder/agent.md
    - src/flows/inferno/commands/inferno-builder.md

## Technical Notes

Frontmatter effort applies to both the strong (opus) and cheap (sonnet) dispatches
of the builder, since both use this one agent definition. That is acceptable:
the requirement is opus@xhigh; sonnet@xhigh on mechanical work is slightly more
thinking, not a correctness risk. A per-tier effort override is out of scope here.

## Dependencies

(none)
