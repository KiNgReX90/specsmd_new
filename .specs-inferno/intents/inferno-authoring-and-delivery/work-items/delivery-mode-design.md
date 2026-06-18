---
id: delivery-mode-design
title: Design — merge-request delivery mode
intent: inferno-authoring-and-delivery
kind: architecture
complexity: high
mode: autopilot
status: pending
depends_on: [config-template]
created: 2026-06-17T00:00:00Z
---

# Work Item: Design — merge-request delivery mode

## Description

Author the design doc for the `merge-request` delivery mode and save it to
`.specs-inferno/intents/inferno-authoring-and-delivery/work-items/delivery-mode-design-doc.md`
using the design template. It must resolve, with rationale:

1. **Per-item MRs are NON-BLOCKING** (opened for record / auto-merge on green);
   the single human review gate is the **intent -> base MR**. This is a locked
   decision (per-item review gates would stall the dependency frontier).
2. **Forge abstraction** — detect `gh` (GitHub) vs `glab` (GitLab) at runtime;
   stay host-neutral; degrade gracefully (clear report, fall back toward
   auto-close behavior) when neither is present.
3. **Base branch** — the orchestrator proposes it (from `state.base_branch` or the
   branch the intent was created from) and the user confirms/can alter it.
4. **Per-item branch mechanics under one shared intent worktree + parallel
   builders** — how items get isolated branches without abandoning the
   single-worktree model (e.g. branch-at-integration from the intent HEAD).
5. **Toggle semantics** — exactly how `auto-close` vs `merge-request` change the
   integrate and finalize steps.

## Acceptance Criteria

- [ ] Design doc saved at the path above, following `design.md.hbs`
- [ ] States the non-blocking per-item / intent->base-gate decision with rationale
- [ ] Specifies the forge-detection + graceful-degradation approach (gh/glab), host-neutral
- [ ] Specifies base-branch proposal + user confirmation
- [ ] Specifies per-item branch handling compatible with the single shared worktree and parallel builders
- [ ] Specifies how integrate + finalize differ between the two modes
- [ ] Markdown passes the flow lint in `validate:all`

## Execution Manifest

context:
  required:
    - path: src/flows/inferno/agents/orchestrator/agent.md
      reason: current claim/worktree/dispatch/integrate/finalize the design must extend
    - path: src/flows/inferno/agents/planner/skills/design-doc-generate/templates/design.md.hbs
      reason: the design-doc template to render
    - path: .specs-inferno/intents/inferno-authoring-and-delivery/brief.md
      reason: the locked delivery decisions to honor
  patterns:
    - path: src/flows/inferno/agents/orchestrator/agent.md
      reason: finalize/claim sections the design extends mode-awarely
  tests:
    - path: src/flows/inferno/agents/orchestrator/agent.md
      reason: correctness is realized + gated downstream when delivery-mode-impl applies this design and validate:all passes
ownership:
  editable:
    - .specs-inferno/intents/inferno-authoring-and-delivery/work-items/delivery-mode-design-doc.md

## Technical Notes

High-complexity, reasoning-bearing: must run on the strong (opus) tier despite
producing a document. `delivery-mode-impl` consumes this doc.

## Dependencies

- config-template
