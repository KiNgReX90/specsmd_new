---
id: turbo-deep-inception
title: AI-DLC Turbo inception gains a mandatory deep-dive interrogation round
intent: production-mode-and-deep-intake
kind: behavior
complexity: medium
mode: autopilot
status: pending
depends_on: []
created: 2026-07-02T00:00:00Z
---

# Work Item: AI-DLC Turbo inception gains a mandatory deep-dive interrogation round

## Description

Deepen AI-DLC Turbo's inception questioning without reintroducing ceremony (FR-7, FR-8). In `src/flows/aidlc-turbo/skills/inception/requirements.md`: after the existing 5 core clarifying questions (Checkpoint 1), add a MANDATORY second interrogation round — edge cases, error handling, data shape/storage, integrations, and NFR probing (performance, security, reliability) — that must be answered before Step 2 requirements generation; update the Progress Display, checkpoint table, and the closing Test Contract YAML to reflect the extra round. In `src/flows/aidlc-turbo/skills/inception/decisions-and-gates.md`: absorb the system-boundary/integration questions the full-mode context stage used to ask (what is inside/outside the system, external dependencies, integration contracts) as explicit ledger-input questions whose answers land as decisions/caveats/gates entries — WITHOUT creating any new document type. In `src/flows/aidlc-turbo/agents/inception-agent.md`: reflect the deepened round in the flow diagram and checkpoint descriptions so the agent enforces it.

## Acceptance Criteria

- [ ] requirements.md has the mandatory deep-dive round with an explicit wait-for-user checkpoint before requirements generation, and forbids skipping it; Test Contract block updated to match
- [ ] decisions-and-gates.md asks the boundary/integration questions and records answers as ledger entries; no system-context.md or other document type is reintroduced
- [ ] inception-agent.md's flow diagram and checkpoint table reflect the new round; the lean pipeline order (requirements → decisions-and-gates → units → stories → review) is otherwise unchanged
- [ ] "cd src && npm test" (notably __tests__/unit/aidlc-turbo/ and __tests__/unit/flow-consistency/) and "cd src && npm run lint:md" stay green

## Caveats

Load-bearing facts from `decisions.md` that apply to THIS item — inlined here so the
builder acts on them without a second hop. Each states what to do or what NOT to assume.

- **C-7** — Builders edit ONLY src/flows/**, src/lib/**, src/__tests__/**, evals/install-eval.sh. The installed .specsmd/ + .claude/ copies in this repo are refreshed by the dogfood reinstall AFTER merge — do NOT edit them directly.
- **C-8** — Turbo stays lean: FR-8 adds QUESTIONS feeding the decisions-and-gates ledger; do NOT reintroduce system-context.md, impact-analysis, inception-log, or any new document type.
- **C-10** — Ruben has not confirmed the four provisional decisions. Build to the provisional decisions; do NOT push to origin or publish; final sign-off happens when he tests the merged tree.

## Execution Manifest

context:
  required:
    - path: .specs-inferno/intents/production-mode-and-deep-intake/decisions.md
      reason: the turbo-depth decision (deep-dive round, context stage stays dead) is pinned here
    - path: src/flows/aidlc-turbo/skills/inception/requirements.md
      reason: primary file — the 5-question checkpoint the deep-dive round extends
    - path: src/flows/aidlc-turbo/skills/inception/decisions-and-gates.md
      reason: receives the boundary/integration questions as ledger inputs
    - path: src/flows/aidlc-turbo/agents/inception-agent.md
      reason: flow diagram + checkpoint table must enforce the new round
  patterns:
    - path: src/flows/aidlc/skills/inception/requirements.md
      reason: classic requirements skill — the questioning shape being deepened (turbo's copy is textually identical today)
    - path: src/flows/aidlc/skills/inception/context.md
      reason: source of the boundary/integration questions being folded into the ledger
  tests:
    - path: src/__tests__/unit/aidlc-turbo/aidlc-turbo-flow.test.ts
      reason: turbo packaging/consistency assertions
    - path: src/__tests__/unit/flow-consistency/
      reason: terminology/reference-integrity suites scan these flow files
ownership:
  editable:
    - src/flows/aidlc-turbo/skills/inception/requirements.md
    - src/flows/aidlc-turbo/skills/inception/decisions-and-gates.md
    - src/flows/aidlc-turbo/agents/inception-agent.md

## Technical Notes

Classic AI-DLC (src/flows/aidlc/) is OUT of scope — do not touch it. Match turbo's
existing document tone: progress displays, checkpoint tables, numbered action menus.
Keep checkpoint numbering coherent across the three files after inserting the round.

## Dependencies

(none)
