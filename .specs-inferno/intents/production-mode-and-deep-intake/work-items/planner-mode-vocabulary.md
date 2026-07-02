---
id: planner-mode-vocabulary
title: Planner and routing surfaces speak mode production/autonomous
intent: production-mode-and-deep-intake
kind: behavior
complexity: medium
mode: autopilot
status: pending
depends_on: []
created: 2026-07-02T00:00:00Z
---

# Work Item: Planner and routing surfaces speak mode production/autonomous

## Description

Sweep the planner agent and its routing/command surfaces from `autonomy.level: full|review` to the consolidated `mode: production | autonomous`: `src/flows/inferno/agents/planner/agent.md` (on_activation first-run config gate, cross-intent overlap actions, handoff_format pause rules), `src/flows/inferno/commands/inferno-planner.md`, and the two planner skills that reference autonomy for pause behavior — `agents/planner/skills/work-item-decompose/SKILL.md` and `agents/planner/skills/design-doc-generate/SKILL.md`. Semantics: production = pause exactly once after writing work items (old `review` behavior), autonomous = no pause (old `full`); legacy mapping documented ONCE in agent.md (`autonomy.level: review` → production, `full` → autonomous, both absent → production). agent.md's intent_capture_flow summary is updated to state that intent-capture runs the staged deep questionnaire under production and lean intake under autonomous — but the questionnaire CONTENT is delegated to the intent-capture skill, which a sibling item (planner-deep-intake) owns. Do not author questionnaire stages here and do not edit intent-capture/SKILL.md or decisions-capture/SKILL.md.

## Acceptance Criteria

- [ ] No autonomy.level reference remains in the four owned files except the single legacy-mapping note in agent.md
- [ ] handoff_format expresses the pause semantics keyed on mode (production pauses exactly once, autonomous does not) and still never routes into the build
- [ ] The first-run config gate (agent.md step 1b) survives as a fallback and names install-time scaffolding as the primary config-creation path
- [ ] intent_capture_flow in agent.md names the two intake paths per mode without duplicating questionnaire content
- [ ] "cd src && npm test" (notably __tests__/unit/inferno/inferno-flow.test.ts) and "cd src && npm run lint:md" stay green

## Caveats

Load-bearing facts from `decisions.md` that apply to THIS item — inlined here so the
builder acts on them without a second hop. Each states what to do or what NOT to assume.

- **C-1** — src/__tests__/unit/inferno/inferno-flow.test.ts asserts builder/writer command bodies are byte-identical to their agent bodies. Do NOT edit agents/builder/**, agents/writer/**, commands/inferno-builder.md, or commands/inferno-writer.md.
- **C-2** — The same test forbids any .specs-fire / .specsmd/fire reference in the inferno tree. Never write those strings, even in examples or migration notes.
- **C-3** — Mode semantics are EXACTLY: production = staged deep intake + one post-write review pause + delivery default merge-request; autonomous = lean intake + no pause + delivery default auto-close; explicit delivery.mode beats the mode-derived default. Do not invent additional mode effects.
- **C-4** — The planner NEVER starts the build in either mode — every file that states this invariant keeps stating it after the rename.
- **C-7** — Builders edit ONLY src/flows/**, src/lib/**, src/__tests__/**, evals/install-eval.sh. The installed .specsmd/ + .claude/ copies in this repo are refreshed by the dogfood reinstall AFTER merge — do NOT edit them directly.
- **C-9** — mode is read from .specs-inferno/config.yaml by flow markdown instructions (agents interpret it), not by runtime code; consistency across all files referencing autonomy/delivery is the actual deliverable.
- **C-10** — Ruben has not confirmed the four provisional decisions. Build to the provisional decisions; do NOT push to origin or publish; final sign-off happens when he tests the merged tree.

## Execution Manifest

context:
  required:
    - path: .specs-inferno/intents/production-mode-and-deep-intake/decisions.md
      reason: mode semantics (C-3), legacy mapping, and pause rules are pinned here
    - path: src/flows/inferno/agents/planner/agent.md
      reason: primary file — config gate, overlap actions, handoff_format all reference autonomy.level
    - path: src/flows/inferno/commands/inferno-planner.md
      reason: launcher command restates the pause rules; must match agent.md wording
  patterns:
    - path: src/flows/inferno/agents/orchestrator/config.example.yaml
      reason: the config key this vocabulary must match (schema pinned in decisions.md C-3; file reworked in parallel by config-mode-schema)
  tests:
    - path: src/__tests__/unit/inferno/inferno-flow.test.ts
      reason: parity + FIRE-namespace assertions that must stay green
ownership:
  editable:
    - src/flows/inferno/agents/planner/agent.md
    - src/flows/inferno/commands/inferno-planner.md
    - src/flows/inferno/agents/planner/skills/work-item-decompose/SKILL.md
    - src/flows/inferno/agents/planner/skills/design-doc-generate/SKILL.md

## Technical Notes

Boundary with sibling planner-deep-intake: this item owns agent.md + inferno-planner.md
+ decompose/design skills; the sibling owns intent-capture/SKILL.md +
decisions-capture/SKILL.md. The shared contract is decisions.md C-3 — do not reach into
the sibling's files even for consistency fixes; flag mismatches in your final report
instead.

## Dependencies

(none)
