---
id: config-mode-schema
title: Config schema — top-level mode replaces autonomy.level
intent: production-mode-and-deep-intake
kind: config-only
complexity: medium
mode: autopilot
status: pending
depends_on: []
created: 2026-07-02T00:00:00Z
---

# Work Item: Config schema — top-level mode replaces autonomy.level

## Description

Rework the INFERNO per-project config surface to the consolidated mode vocabulary. `src/flows/inferno/agents/orchestrator/config.example.yaml` gains a top-level `mode: production | autonomous` key REPLACING the `autonomy:` block; its comments state the exact three effects (planner intake depth, the single post-write review pause, the delivery default: production → merge-request, autonomous → auto-close), document `delivery.mode` as an explicit override that beats the mode-derived default, and describe the legacy mapping in one comment (`autonomy.level: review` → production, `full` → autonomous; both keys absent → production). `src/flows/inferno/commands/inferno-config.md` (the `/specsmd-inferno-config` wizard) is rewritten to speak the new schema and repositioned as the create-or-EDIT tool, since `npx specsmd install` now scaffolds the config at install time (that installer work is a sibling item; this item only words the command accordingly).

## Acceptance Criteria

- [ ] config.example.yaml documents a top-level `mode:` key with production/autonomous semantics exactly as pinned in decisions.md C-3; no `autonomy:` block remains except the one legacy-mapping comment
- [ ] The delivery section documents the precedence order — explicit delivery.mode override, then mode-derived default, then production default when everything is absent
- [ ] inferno-config.md walks the new keys (mode, models, verification, delivery override, halt, knowledge) and presents itself as the post-install create-or-edit path
- [ ] Comments still state the planner never starts the build
- [ ] Every key remains optional — an absent config file still yields a working flow (behaves as production)
- [ ] "cd src && npm run lint:md" stays clean

## Caveats

Load-bearing facts from `decisions.md` that apply to THIS item — inlined here so the
builder acts on them without a second hop. Each states what to do or what NOT to assume.

- **C-2** — The inferno flow test forbids any .specs-fire / .specsmd/fire reference in the inferno tree. Never write those strings, even in examples or migration notes.
- **C-3** — Mode semantics are EXACTLY: production = staged deep intake + one post-write review pause + delivery default merge-request; autonomous = lean intake + no pause + delivery default auto-close; explicit delivery.mode beats the mode-derived default. Do not invent additional mode effects (model tiers, halt, verification are mode-independent).
- **C-4** — The planner NEVER starts the build in either mode — every file that states this invariant keeps stating it after the rename (agent.md handoff_format, commands/inferno-planner.md, config.example.yaml comments, README, PRD).
- **C-7** — Builders edit ONLY src/flows/**, src/lib/**, src/__tests__/**, evals/install-eval.sh. The installed .specsmd/ + .claude/ copies in this repo are refreshed by the dogfood reinstall AFTER merge — do NOT edit them directly.
- **C-9** — mode is read from .specs-inferno/config.yaml by flow markdown instructions (agents interpret it), not by runtime code — there is no YAML parser to update; consistency across all files referencing autonomy/delivery is the actual deliverable.
- **C-10** — Ruben has not confirmed the four provisional decisions (mode shape, production-only depth, turbo approach, keep-editor-command). Build to the provisional decisions; do NOT push to origin or publish; final sign-off happens when he tests the merged tree.

## Execution Manifest

context:
  required:
    - path: .specs-inferno/intents/production-mode-and-deep-intake/decisions.md
      reason: schema semantics (C-3), legacy mapping, and release gates are pinned here
    - path: src/flows/inferno/agents/orchestrator/config.example.yaml
      reason: the file being reworked — current autonomy/delivery wording to replace
    - path: src/flows/inferno/commands/inferno-config.md
      reason: the wizard command being rewritten to the new schema and editor role
  patterns:
    - path: src/flows/inferno/README.md
      reason: current mode vocabulary in shipped docs — the wording being superseded (do not edit; owned by inferno-docs-mode)
  tests:
ownership:
  editable:
    - src/flows/inferno/agents/orchestrator/config.example.yaml
    - src/flows/inferno/commands/inferno-config.md

# One-line shell invariant the ORCHESTRATOR runs at finalize (not a subagent).
# Non-zero exit blocks close. Use for cheap mechanical checks (dangling-ref
# sweep, key parity) instead of a standalone verify item.
finalize_check: bash -c '! git grep -n "autonomy\.level" -- src/flows/inferno | grep -vi legacy'

## Technical Notes

Keep the file's existing structure and comment density — this is the template users copy.
The models/verification/halt/knowledge sections change only where they referenced
autonomy; their semantics are mode-independent (C-3). The command file must keep its
/specsmd-inferno-config name and display-and-confirm shape so the planner first-run
fallback gate still works.

## Dependencies

(none)
