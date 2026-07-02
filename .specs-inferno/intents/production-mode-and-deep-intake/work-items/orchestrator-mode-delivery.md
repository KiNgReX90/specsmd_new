---
id: orchestrator-mode-delivery
title: Orchestrator derives delivery default from mode
intent: production-mode-and-deep-intake
kind: behavior
complexity: medium
mode: autopilot
status: pending
depends_on: []
created: 2026-07-02T00:00:00Z
---

# Work Item: Orchestrator derives delivery default from mode

## Description

Make delivery resolution mode-aware in `src/flows/inferno/agents/orchestrator/agent.md` and `src/flows/inferno/commands/inferno.md`. Resolution order: an explicit `delivery.mode` key always wins; otherwise the top-level `mode` derives the default (production → merge-request, autonomous → auto-close); when neither `mode` nor `delivery.mode` is set, honor the legacy mapping (autonomy.level review → production, full → autonomous) and fall back to production semantics when nothing is set — HOWEVER, preserve today's shipped behavior contract as pinned in decisions.md: absent config behaves as production for planning pauses, while delivery for a wholly absent delivery/mode config keeps the current documented default (auto-close) ONLY if changing it would contradict decisions.md — decisions.md pins: both absent → production, and production's delivery default is merge-request; state this clearly as a behavior change in the file's comments. Sweep the remaining autonomy.level references in the two owned files to the new vocabulary. The "autonomous"/"production" nicknames in prose become the real mode names. No changes to dispatch waves, halt/budget behavior, worktree mechanics, or finalize verification beyond the delivery-default lookup.

## Acceptance Criteria

- [ ] Delivery resolution order is documented exactly once in agent.md — explicit delivery.mode override, then mode-derived default (production → merge-request, autonomous → auto-close), then the absent-everything default per decisions.md (production semantics)
- [ ] Legacy autonomy.level mapping is honored where the orchestrator reads config
- [ ] No autonomy.level reference remains in the two owned files; nickname prose now uses the real mode names
- [ ] Dispatch, halt, worktree, and finalize sections are otherwise unchanged
- [ ] "cd src && npm test" and "cd src && npm run lint:md" stay green

## Caveats

Load-bearing facts from `decisions.md` that apply to THIS item — inlined here so the
builder acts on them without a second hop. Each states what to do or what NOT to assume.

- **C-2** — The inferno flow test forbids any .specs-fire / .specsmd/fire reference in the inferno tree. Never write those strings.
- **C-3** — Mode semantics are EXACTLY: production = staged deep intake + one post-write review pause + delivery default merge-request; autonomous = lean intake + no pause + delivery default auto-close; explicit delivery.mode beats the mode-derived default. Do not invent additional mode effects (model tiers, halt, verification are mode-independent).
- **C-7** — Builders edit ONLY src/flows/**, src/lib/**, src/__tests__/**, evals/install-eval.sh. The installed .specsmd/ + .claude/ copies in this repo are refreshed by the dogfood reinstall AFTER merge — do NOT edit them directly.
- **C-9** — mode is read from .specs-inferno/config.yaml by flow markdown instructions (agents interpret it), not by runtime code; consistency across all files referencing autonomy/delivery is the actual deliverable.
- **C-10** — Ruben has not confirmed the four provisional decisions. Build to the provisional decisions; do NOT push to origin or publish; final sign-off happens when he tests the merged tree.

## Execution Manifest

context:
  required:
    - path: .specs-inferno/intents/production-mode-and-deep-intake/decisions.md
      reason: delivery-default derivation and legacy mapping are pinned here (C-3)
    - path: src/flows/inferno/agents/orchestrator/agent.md
      reason: primary file — current delivery.mode reading and autonomy references
    - path: src/flows/inferno/commands/inferno.md
      reason: orchestrator launcher restates config semantics; must match agent.md
  patterns:
    - path: src/flows/inferno/agents/orchestrator/config.example.yaml
      reason: delivery section semantics being consolidated (schema pinned in C-3; file reworked in parallel by config-mode-schema)
  tests:
    - path: src/__tests__/unit/inferno/inferno-flow.test.ts
      reason: parity + FIRE-namespace assertions that must stay green
ownership:
  editable:
    - src/flows/inferno/agents/orchestrator/agent.md
    - src/flows/inferno/commands/inferno.md

## Technical Notes

Do not edit config.example.yaml (owned by config-mode-schema) even if wording feels
inconsistent mid-build — the shared contract is decisions.md C-3. Builder/writer
surfaces are off-limits (parity tests).

## Dependencies

(none)
