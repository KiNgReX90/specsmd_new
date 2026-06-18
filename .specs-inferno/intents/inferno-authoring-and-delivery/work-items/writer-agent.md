---
id: writer-agent
title: INFERNO pure-scribe writer agent + command
intent: inferno-authoring-and-delivery
kind: architecture
complexity: medium
mode: autopilot
status: pending
depends_on: []
created: 2026-06-17T00:00:00Z
---

# Work Item: INFERNO pure-scribe writer agent + command

## Description

Create the INFERNO writer agent — a pure scribe the planner dispatches (one per
work item) during decomposition fan-out. It receives a complete decision record,
the work-item template path, and one output file path; it renders the template
from the record and writes exactly that one file. It performs NO reasoning, NO
codebase reads/search, makes NO decisions, never edits `state.yaml`, and touches
no file other than its assigned output path. Mirror the structure of the builder
agent/command pair: `agents/writer/agent.md` is canonical; `commands/inferno-writer.md`
is what the installer materializes into `.claude/agents/specsmd-inferno-writer.md`,
so the command body must stay byte-identical to the agent body (frontmatter aside).

## Acceptance Criteria

- [ ] `src/flows/inferno/agents/writer/agent.md` exists with frontmatter `name: inferno-writer-agent` and `effort: low`
- [ ] The agent body defines: inputs (decision record, template path, output path), the render-and-write task, and a minimal result contract (e.g. `written: <path>` / `status: written | failed`)
- [ ] The agent explicitly forbids independent decisions, codebase reads/search, editing `state.yaml`, and writing any path other than the assigned output
- [ ] `src/flows/inferno/commands/inferno-writer.md` exists and its body (frontmatter stripped) is byte-identical to the writer agent body
- [ ] Neither new file references the FIRE namespace (`.specs-fire`, `.specsmd/fire`)
- [ ] `cd src && npm run validate:all` passes

## Execution Manifest

context:
  required:
    - path: src/flows/inferno/agents/builder/agent.md
      reason: canonical agent shape, constraints style, and result-contract pattern to mirror
    - path: src/flows/inferno/commands/inferno-builder.md
      reason: the command<->agent pairing the installer relies on
  patterns:
    - path: src/flows/inferno/agents/builder/agent.md
      reason: role / constraints / result-contract structure to follow for a dispatchable subagent
    - path: src/flows/inferno/agents/planner/skills/work-item-decompose/templates/work-item.md.hbs
      reason: the template the scribe renders into the output file
  tests:
    - path: src/__tests__/unit/inferno/inferno-flow.test.ts
      reason: the drift + FIRE-namespace guards the new files must satisfy
ownership:
  editable:
    - src/flows/inferno/agents/writer/agent.md
    - src/flows/inferno/commands/inferno-writer.md

## Technical Notes

The installer (`src/lib/installers/ClaudeInstaller.js`) materializes every
`commands/*.md` as `specsmd-<prefix>-<name>` under `.claude/agents/`, so placing
`inferno-writer.md` in `commands/` auto-registers the dispatchable subagent — no
installer change needed. The writer is dispatched by the planner, not the
orchestrator; keep it free of any orchestration/state logic.

## Dependencies

(none)
