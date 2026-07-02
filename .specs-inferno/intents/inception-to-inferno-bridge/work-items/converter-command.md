---
id: converter-command
title: /inception-to-inferno launcher command + planner registration
intent: inception-to-inferno-bridge
kind: architecture
complexity: low
mode: autopilot
status: completed
depends_on: [converter-skill]
created: 2026-06-23T00:00:00Z
---

# Work Item: /inception-to-inferno launcher command + registration

## Description

Add the user-facing entry point for the converter: a thin
`src/flows/inferno/commands/inception-to-inferno.md` command that launches the
planner agent into the `inception-import` skill, mirroring how
`commands/inferno-planner.md` launches the planner. The installer materializes
`commands/*.md` as `.claude/commands/specsmd-<name>.md` automatically — no
installer change needed.

Also register the import capability in the planner agent's skills table
(`agents/planner/agent.md`) so the skill is discoverable (e.g. an `import` /
`inception-to-inferno` row pointing at `skills/inception-import/SKILL.md`),
keeping the edit minimal and not disturbing the planner's existing routing.

## Acceptance Criteria

- [ ] `src/flows/inferno/commands/inception-to-inferno.md` exists, follows the `inferno-planner.md` command shape (frontmatter + body), and routes the user into the `inception-import` skill.
- [ ] `agents/planner/agent.md` lists the import skill in its skills table with a one-line description; no other planner routing is changed.
- [ ] The command takes a target memory-bank intent (id or path) as its argument and passes it to the skill.
- [ ] No FIRE-namespace references; the command body stays consistent with the skill per the drift guard.
- [ ] `cd src && npm run validate:all` passes (registration + namespace guards).

## Execution Manifest

context:
  required:
    - path: src/flows/inferno/commands/inferno-planner.md
      reason: the thin launcher-command pattern (frontmatter + body) to mirror
    - path: src/flows/inferno/agents/planner/skills/inception-import/SKILL.md
      reason: the skill this command launches (created by converter-skill); the command must point at it correctly
  patterns:
    - path: src/flows/inferno/commands/inferno-planner.md
      reason: command frontmatter/body conventions for an INFERNO launcher
    - path: src/flows/inferno/agents/planner/agent.md
      reason: the skills table to add the import row to, without altering existing routing
  tests:
    - path: src/__tests__/unit/inferno/inferno-flow.test.ts
      reason: FIRE-namespace + command/registration guards over the new command and edited planner agent
ownership:
  editable:
    - src/flows/inferno/commands/inception-to-inferno.md
    - src/flows/inferno/agents/planner/agent.md

## Technical Notes

This depends on `converter-skill` only so the command can reference the real
skill path; the edit to `agents/planner/agent.md` is a single skills-table row
plus, if needed, an `<on_activation>` route note — keep it surgical. The
planner agent file is not owned by any other item in this intent, so this is a
clean, non-overlapping edit.

## Dependencies

- converter-skill
