---
id: delivery-mode-impl
title: Orchestrator — implement delivery.mode toggle
intent: inferno-authoring-and-delivery
kind: architecture
complexity: high
mode: autopilot
status: pending
depends_on: [delivery-mode-design]
created: 2026-06-17T00:00:00Z
---

# Work Item: Orchestrator — implement delivery.mode toggle

## Description

Implement the `delivery.mode` toggle in `agents/orchestrator/agent.md` per the
authored design. `auto-close` (default) keeps today's behavior exactly: serialized
direct commits on the intent branch, local merge into the default branch, process
teardown, push. `merge-request` instead: handles each item on its own branch with
a NON-BLOCKING MR into the intent branch (per the design), then at finalize pushes
the intent branch and opens the intent -> base MR (base from `state.base_branch`,
proposed-and-confirmed) and STOPS without local merge or teardown. MR creation is
forge-aware (gh/glab) and degrades gracefully when neither is available. Make the
`<finalize>` (and claim/worktree references where needed) mode-aware; keep
`auto-close` byte-for-behavior identical to today so the autonomous path is
unchanged.

## Acceptance Criteria

- [ ] Orchestrator reads `delivery.mode` from config (absent -> `auto-close`)
- [ ] `auto-close` path is behaviorally unchanged from current finalize (merge + teardown + push)
- [ ] `merge-request` path: per-item non-blocking MRs into intent; intent -> base MR at finalize; no local merge/teardown; stops for human review
- [ ] Base branch resolved from `state.base_branch`, proposed and confirmed when unset
- [ ] MR creation is forge-aware (gh/glab) and degrades gracefully when neither exists, reporting clearly
- [ ] No FIRE-namespace references; `cd src && npm run validate:all` passes

## Execution Manifest

context:
  required:
    - path: src/flows/inferno/agents/orchestrator/agent.md
      reason: the orchestrator procedure to make mode-aware
    - path: .specs-inferno/intents/inferno-authoring-and-delivery/work-items/delivery-mode-design-doc.md
      reason: the authored design this work item implements
  patterns:
    - path: src/flows/inferno/agents/orchestrator/config.example.yaml
      reason: the delivery.* keys this consumes
  tests:
    - path: src/__tests__/unit/inferno/inferno-flow.test.ts
      reason: FIRE-namespace + flow guards over the edited orchestrator; validate:all gate
ownership:
  editable:
    - src/flows/inferno/agents/orchestrator/agent.md

## Technical Notes

Owns `orchestrator/agent.md` exclusively (tiering/effort changes were kept out of
this file — effort rides builder frontmatter). Preserve all existing token-discipline
and safety constraints; the toggle adds branches, it does not relax them.

## Dependencies

- delivery-mode-design
