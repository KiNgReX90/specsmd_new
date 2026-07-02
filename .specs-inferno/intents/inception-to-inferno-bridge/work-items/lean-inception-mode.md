---
id: lean-inception-mode
title: Lean inception mode — stop after stories, skip bolt-plan + verbose unit-briefs
intent: inception-to-inferno-bridge
kind: behavior
complexity: medium
mode: autopilot
status: completed
depends_on: []
created: 2026-06-23T00:00:00Z
---

# Work Item: Lean inception mode

## Description

Add a "lean" mode to the inception agent that produces exactly the artifacts
the converter consumes and nothing more. In lean mode the pipeline runs
requirements → system-context → (lean) units → stories, then STOPS:

- **bolt-plan is skipped entirely** — no bolts authored.
- **units are lean** — author only the minimal unit grouping the converter
  needs (id/label + the ownership/scope hint), NOT the verbose multi-section
  unit-brief docs (Domain Concepts tables, Story Summary, Success Criteria,
  Bolt Suggestions, etc.).
- **review/completion** accepts a story-complete-but-no-bolts state as a valid
  terminal state for the intent.

Mode is selectable (a flag/arg on the agent, or a config key) and is purely
additive: with lean mode OFF, the full pipeline (full unit-briefs + bolt-plan)
behaves exactly as today.

## Acceptance Criteria

- [ ] The inception agent supports a lean mode that stops after the stories step and never runs bolt-plan.
- [ ] In lean mode, units are authored as minimal grouping (label + scope/ownership hint) — the verbose unit-brief sections are not produced.
- [ ] The review/completion step treats "stories authored, no bolts" as a valid completed inception in lean mode.
- [ ] Full (non-lean) inception is unchanged: units + bolt-plan still run and produce the same artifacts as before when lean mode is off.
- [ ] Lean-mode output still parses as valid memory-bank artifacts (intent/units/stories) so the converter and the aidlc parser can read it.
- [ ] No FIRE-namespace references; `cd src && npm run validate:all` passes.

## Execution Manifest

context:
  required:
    - path: docs/inception-to-inferno-eval-strategy.md
      reason: arm A4 defines lean mode — what to skip (bolt-plan, verbose unit-briefs) and what to keep
    - path: src/flows/aidlc/agents/inception-agent.md
      reason: the agent whose workflow + skills table must become mode-aware and stop after stories
    - path: src/flows/aidlc/memory-bank.yaml
      reason: the artifact schema — what must still be produced for lean output to remain valid
  patterns:
    - path: src/flows/aidlc/skills/inception/units.md
      reason: the unit-authoring step to make lean (minimal grouping vs full unit-brief)
    - path: src/flows/aidlc/skills/inception/bolt-plan.md
      reason: the step to make skippable in lean mode
    - path: src/flows/aidlc/skills/inception/review.md
      reason: the completion step that must accept a story-complete/no-bolts terminal state
  tests:
    - path: src/__tests__/unit/dashboard/dashboard-aidlc-parser.test.ts
      reason: the aidlc artifact-shape guard — lean output must still parse as valid memory-bank artifacts
ownership:
  editable:
    - src/flows/aidlc/agents/inception-agent.md
    - src/flows/aidlc/skills/inception/units.md
    - src/flows/aidlc/skills/inception/bolt-plan.md
    - src/flows/aidlc/skills/inception/review.md

## Technical Notes

All ownership is in `src/flows/aidlc/`, disjoint from the converter's
`src/flows/inferno/` files, so this builds fully in parallel with
`converter-skill`. Keep the change additive and mode-gated — do not regress the
full construction pipeline, which other AI-DLC users still rely on.

## Dependencies

(none)
