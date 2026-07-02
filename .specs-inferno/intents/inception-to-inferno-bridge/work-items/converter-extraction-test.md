---
id: converter-extraction-test
title: Fixture test — extraction core emits contract-valid INFERNO work items
intent: inception-to-inferno-bridge
kind: test
complexity: medium
mode: autopilot
status: completed
depends_on: [converter-skill]
created: 2026-06-23T00:00:00Z
---

# Work Item: Converter extraction + contract fixture test

## Description

Add a Vitest fixture test that locks the converter's mechanical core: feed a
small hand-authored sample memory-bank intent (a couple of units, a handful of
stories with Requires/Depends edges) through the `inception-import` extraction
core, and assert:

1. The structured model is correct — every story is extracted with its id,
   unit, AC, and dependency edges; units map to ownership partitions; bolts are
   absent from the output.
2. The emitted work-item skeletons PASS the real `team-scheduler.cjs`
   validator (reuse the actual validator, do not reimplement it): non-empty
   `context.required` + `ownership.editable`, `context.patterns` present for
   behavior/architecture/api/ui items, `context.tests` present unless
   docs/config-only.
3. Story prose is referenced (a `context.required` link to the story file),
   not copied into the work-item body.
4. A deliberately unresolvable story in the fixture is reported/skipped, not
   emitted as an invalid item.

The fixture lives under `src/__tests__/fixtures/inception-import/` and the spec
under `src/__tests__/unit/inferno/inception-import.test.ts`.

## Acceptance Criteria

- [ ] `src/__tests__/unit/inferno/inception-import.test.ts` exists and runs under the existing Vitest config (`cd src && npm run validate:all`).
- [ ] A minimal fixture memory-bank intent exists under `src/__tests__/fixtures/inception-import/`.
- [ ] The test imports and reuses the real `team-scheduler.cjs` validator to assert every emitted work item is contract-valid.
- [ ] The test asserts the story→work-item, unit→ownership, and bolt-discard mappings, and that story prose is linked (not re-summarized).
- [ ] The test covers the unresolvable-story → flagged-and-skipped path.
- [ ] No FIRE-namespace references; the test passes under `validate:all`.

## Execution Manifest

context:
  required:
    - path: src/flows/inferno/agents/planner/skills/inception-import/
      reason: the converter extraction core under test (its importable parser is the subject of this spec)
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/team-scheduler.cjs
      reason: the validator to import and assert against — the source of truth for contract validity
    - path: src/flows/aidlc/templates/inception/story-template.md
      reason: the story shape the fixture must follow so extraction is exercised realistically
  patterns: []
  tests:
    - path: src/__tests__/unit/inferno/inferno-flow.test.ts
      reason: the existing inferno Vitest spec to mirror for harness, imports, and conventions
ownership:
  editable:
    - src/__tests__/unit/inferno/inception-import.test.ts
    - src/__tests__/fixtures/inception-import/

## Technical Notes

This work item is the forcing function that keeps the converter's mechanical
extraction a clean, importable unit rather than prose buried in SKILL.md. It
reads the converter as context but owns only the test + fixtures, so it never
collides with `converter-skill`; it runs as soon as that item completes.

## Dependencies

- converter-skill
