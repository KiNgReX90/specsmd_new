---
id: inferno-docs-mode
title: README and PRD document the consolidated mode and install-time config
intent: production-mode-and-deep-intake
kind: docs-only
complexity: low
mode: autopilot
status: pending
depends_on: [config-mode-schema, planner-mode-vocabulary, planner-deep-intake, orchestrator-mode-delivery, installer-inferno-config]
created: 2026-07-02T00:00:00Z
---

# Work Item: README and PRD document the consolidated mode and install-time config

## Description

Bring the shipped INFERNO docs in line with the landed reality (FR-14): `src/flows/inferno/README.md` and `src/flows/inferno/PRD.md` describe the consolidated `mode: production | autonomous` vocabulary (with the legacy autonomy.level mapping as a migration note), production's staged deep intake, the delivery default derivation and explicit `delivery.mode` override, install-time config scaffolding as the primary creation path, and `/specsmd-inferno-config` as the create-or-edit command. Read the sibling items' landed changes first and document what actually shipped — do not restate the ledger from memory.

## Acceptance Criteria

- [ ] No autonomy.level reference remains in README.md or PRD.md except a single migration note
- [ ] README quick-start reflects that install scaffolds .specs-inferno/config.yaml and names /specsmd-inferno-planner as the entry point
- [ ] PRD's mode/delivery sections match the landed agent behavior exactly
- [ ] "cd src && npm run lint:md" stays clean

## Caveats

Load-bearing facts from `decisions.md` that apply to THIS item — inlined here so the
builder acts on them without a second hop. Each states what to do or what NOT to assume.

- **C-2** — The inferno flow test forbids any .specs-fire / .specsmd/fire reference in the inferno tree. Never write those strings.
- **C-4** — The planner NEVER starts the build in either mode — the docs keep stating this invariant after the rename.
- **C-7** — Builders edit ONLY src/flows/**, src/lib/**, src/__tests__/**, evals/install-eval.sh. The installed .specsmd/ + .claude/ copies in this repo are refreshed by the dogfood reinstall AFTER merge — do NOT edit them directly.
- **C-10** — Ruben has not confirmed the four provisional decisions. Build to the provisional decisions; do NOT push to origin or publish; final sign-off happens when he tests the merged tree.

## Execution Manifest

context:
  required:
    - path: .specs-inferno/intents/production-mode-and-deep-intake/decisions.md
      reason: decisions and mode semantics the docs must reflect
    - path: src/flows/inferno/README.md
      reason: primary doc being updated
    - path: src/flows/inferno/PRD.md
      reason: product doc being updated
    - path: src/flows/inferno/agents/orchestrator/config.example.yaml
      reason: landed schema (after config-mode-schema) — the source of documented keys
  patterns:
  tests:
ownership:
  editable:
    - src/flows/inferno/README.md
    - src/flows/inferno/PRD.md

## Technical Notes

Runs after all sibling items land (depends_on covers all five) — document the tree as
built, citing the landed files, not the plan.

## Dependencies

- config-mode-schema
- planner-mode-vocabulary
- planner-deep-intake
- orchestrator-mode-delivery
- installer-inferno-config
