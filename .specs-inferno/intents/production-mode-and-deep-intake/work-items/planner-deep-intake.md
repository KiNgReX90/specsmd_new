---
id: planner-deep-intake
title: Production-mode staged deep questionnaire in intent-capture and decisions-capture
intent: production-mode-and-deep-intake
kind: behavior
complexity: high
mode: autopilot
status: pending
depends_on: []
created: 2026-07-02T00:00:00Z
---

# Work Item: Production-mode staged deep questionnaire in intent-capture and decisions-capture

## Description

Implement the production-mode deep intake (FR-6) in the two planner intake skills. `src/flows/inferno/agents/planner/skills/intent-capture/SKILL.md` gains mode-conditional intake: under `mode: production` it runs a staged, checkpointed questionnaire — stage 1 core questions (who are the users, what outcomes matter, constraints, how success is measured, top concern); stage 2 a MANDATORY deep-dive round probing edge cases, error handling, data shape/storage, integrations, and NFR territory (performance, security, reliability); stage 3 full summary approval — before chaining into decisions-capture. The staging is modeled on the classic AI-DLC inception requirements skill. Under `mode: autonomous` the current open-ended lean intake is kept verbatim. `agents/planner/skills/decisions-capture/SKILL.md` consumes the stage-2 answers as ledger inputs (decisions, caveats, gates) and keys its single confirm pause on mode (pause under production, decide-and-note under autonomous) instead of autonomy.level.

## Acceptance Criteria

- [ ] intent-capture/SKILL.md documents both intake paths keyed on `mode`, honoring the legacy mapping (autonomy.level review → production, full → autonomous, both absent → production)
- [ ] Stage 2 is mandatory in production — the skill explicitly forbids skipping to the summary while deep-dive territory (edge cases, error handling, data, integrations, NFRs) is unanswered
- [ ] Stage answers flow into decisions-capture as ledger inputs rather than being restated in the brief
- [ ] decisions-capture/SKILL.md pause behavior and wording are keyed on mode; no autonomy.level reference remains in either owned file
- [ ] The never-start-the-build invariant and the capture → decisions → decompose auto-chain are untouched
- [ ] "cd src && npm test" and "cd src && npm run lint:md" stay green

## Caveats

Load-bearing facts from `decisions.md` that apply to THIS item — inlined here so the
builder acts on them without a second hop. Each states what to do or what NOT to assume.

- **C-1** — src/__tests__/unit/inferno/inferno-flow.test.ts asserts builder/writer command bodies are byte-identical to their agent bodies. Do NOT edit agents/builder/**, agents/writer/**, commands/inferno-builder.md, or commands/inferno-writer.md.
- **C-2** — The same test forbids any .specs-fire / .specsmd/fire reference in the inferno tree. Never write those strings, even in examples or migration notes.
- **C-3** — Mode semantics are EXACTLY: production = staged deep intake + one post-write review pause + delivery default merge-request; autonomous = lean intake + no pause + delivery default auto-close; explicit delivery.mode beats the mode-derived default. Do not invent additional mode effects.
- **C-4** — The planner NEVER starts the build in either mode.
- **C-7** — Builders edit ONLY src/flows/**, src/lib/**, src/__tests__/**, evals/install-eval.sh. The installed .specsmd/ + .claude/ copies in this repo are refreshed by the dogfood reinstall AFTER merge — do NOT edit them directly.
- **C-10** — Ruben has not confirmed the four provisional decisions. Build to the provisional decisions; do NOT push to origin or publish; final sign-off happens when he tests the merged tree.
- **C-11** — The mode questionnaire depth applies at INTAKE time (intent-capture/decisions-capture); decomposition and design-doc behavior stay unchanged apart from vocabulary — those files belong to a sibling item.

## Execution Manifest

context:
  required:
    - path: .specs-inferno/intents/production-mode-and-deep-intake/decisions.md
      reason: mode semantics (C-3) and questionnaire scope (FR-6) are pinned here
    - path: src/flows/inferno/agents/planner/skills/intent-capture/SKILL.md
      reason: primary file — current lean intake flow to make mode-conditional
    - path: src/flows/inferno/agents/planner/skills/decisions-capture/SKILL.md
      reason: consumes deep-dive answers; its pause keys on mode
  patterns:
    - path: src/flows/aidlc/skills/inception/requirements.md
      reason: the classic staged-questionnaire shape (clarifying questions checkpoint, FR/NFR probing, full review) to adopt for production intake
  tests:
    - path: src/__tests__/unit/inferno/inferno-flow.test.ts
      reason: parity + FIRE-namespace assertions that must stay green
ownership:
  editable:
    - src/flows/inferno/agents/planner/skills/intent-capture/SKILL.md
    - src/flows/inferno/agents/planner/skills/decisions-capture/SKILL.md

## Technical Notes

Boundary with sibling planner-mode-vocabulary: that item owns agent.md,
commands/inferno-planner.md, and the decompose/design skills. Do not edit those files;
the shared contract is decisions.md C-3. Keep the skills' existing XML-ish structure
(flow/step/output blocks) and the cross-intent overlap check in intent-capture intact —
only the intake stages and pause keys change.

## Dependencies

(none)
