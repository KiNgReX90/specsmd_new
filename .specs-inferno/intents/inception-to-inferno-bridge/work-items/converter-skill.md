---
id: converter-skill
title: Inception-import converter skill (memory-bank intent → INFERNO artifacts)
intent: inception-to-inferno-bridge
kind: architecture
complexity: high
mode: autopilot
status: completed
depends_on: []
created: 2026-06-23T00:00:00Z
---

# Work Item: Inception-import converter skill

## Description

Create the core converter: a planner skill at
`src/flows/inferno/agents/planner/skills/inception-import/` that reads a
completed AI-DLC memory-bank intent and emits an INFERNO intent brief plus one
contract-valid work item per user story into `.specs-inferno/`.

The skill has two layers:

1. **A deterministic extraction core** (a testable `scripts/*.cjs` parser):
   read a memory-bank intent dir (`requirements.md`, `system-context.md`,
   `units/*/unit-brief.md`, `units/*/stories/*.md`) and produce a structured
   model — intent metadata, the unit list, and the story list with each
   story's `id`, `unit`, prose, acceptance criteria, and Requires/Depends
   edges. This is the part the fixture test in `converter-extraction-test`
   exercises, so it MUST be a self-contained, importable function — not inline
   prose in SKILL.md.
2. **The mapping + resolution instructions** (SKILL.md): from the extracted
   model, render the INFERNO brief (from requirements + system-context) and one
   work item per story using the EXISTING work-item template. Apply the mapping
   rules below, resolve concrete paths against the codebase, enforce the
   INFERNO contract, and fan out the actual file WRITING via the existing
   `specsmd-inferno-writer` scribes (do not fork a new authoring path).

**Mapping rules (authoritative):**
- requirements.md + system-context.md → `brief.md` (goal/problem/criteria).
- each story → one `work-items/{story-id}.md`; the story file is LINKED in
  `context.required` with a reason — its prose is NEVER copied/re-summarized.
- story Requires/Depends edges → work-item `depends_on` (story ids).
- unit → an `ownership.editable` partition + a grouping label on its stories;
  the unit-brief doc is DISCARDED.
- bolts / bolt-plan → DISCARDED (INFERNO recomputes the build frontier).
- story AC scope → inferred `kind` (ui/api/behavior/architecture/…) and
  `complexity` (low/medium/high).

**Path resolution + contract:** resolve concrete `ownership.editable`,
`context.patterns`, and `context.tests` paths against the real codebase,
PREFERRING any paths already pinned in story frontmatter (by
`/resolve-inception-docs`). Every emitted item MUST pass the
`team-scheduler.cjs` validator. A story that cannot be resolved to a real
editable target is FLAGGED to the user and NOT emitted — never emit an invalid
work item.

## Acceptance Criteria

- [ ] `src/flows/inferno/agents/planner/skills/inception-import/SKILL.md` exists and documents the mapping rules, path-resolution policy, contract enforcement, and the scribe fan-out for writing.
- [ ] A deterministic extraction core under `inception-import/scripts/` parses a memory-bank intent dir into a structured {intent, units[], stories[]} model and is importable/testable in isolation.
- [ ] The skill renders the INFERNO brief + one work item per story using `work-item-decompose/templates/work-item.md.hbs` and `intent-capture/templates/brief.md.hbs` — it does not invent a new template.
- [ ] Story prose is referenced via `context.required`, never re-summarized into the work item body.
- [ ] Unit → `ownership.editable` partition + grouping label; bolts and unit-brief docs are not carried into INFERNO artifacts.
- [ ] Unresolvable stories are reported and skipped; emitted items always satisfy the `team-scheduler.cjs` contract (non-empty `context.required` + `ownership.editable`; `patterns` for behavior/architecture/api/ui; `tests` unless docs/config-only).
- [ ] No FIRE-namespace references anywhere in the new files.
- [ ] `cd src && npm run validate:all` passes.

## Execution Manifest

context:
  required:
    - path: docs/inception-to-inferno-eval-strategy.md
      reason: Part A defines the converter, the mapping table, and the contract-resolution policy this skill implements
    - path: src/flows/inferno/agents/planner/skills/work-item-decompose/templates/work-item.md.hbs
      reason: the exact output template each emitted work item must render from
    - path: src/flows/aidlc/memory-bank.yaml
      reason: the input artifact schema (where inception writes requirements/units/stories and their naming)
    - path: src/flows/aidlc/templates/inception/story-template.md
      reason: the story input format the extraction core must parse (frontmatter + AC + Requires/Enables)
    - path: src/flows/inferno/agents/orchestrator/skills/orchestrate/scripts/team-scheduler.cjs
      reason: the ground-truth validator every emitted work item must pass
  patterns:
    - path: src/flows/inferno/agents/planner/skills/work-item-decompose/SKILL.md
      reason: the planner-skill structure + scribe fan-out pattern to mirror
    - path: src/flows/inferno/agents/planner/skills/intent-capture/templates/brief.md.hbs
      reason: the brief output template to render from requirements + system-context
    - path: memory-bank/intents/011-vscode-extension/units/sidebar-provider/stories/002-intent-unit-story-tree.md
      reason: a real story example showing the frontmatter + Dependencies shape to map from
  tests:
    - path: src/__tests__/unit/inferno/inferno-flow.test.ts
      reason: the FIRE-namespace + flow guards the new skill files must satisfy under validate:all
ownership:
  editable:
    - src/flows/inferno/agents/planner/skills/inception-import/

## Technical Notes

Keep all reasoning (path resolution, kind/complexity, flagging) in the
planner-tier agent; keep the mechanical parse in the script so it is unit
testable. Reuse the writer scribe fan-out for the actual file writes — the
converter is the planner producing artifacts from inception input instead of
from a live conversation, so it should look like the existing decompose path.

## Dependencies

(none)
