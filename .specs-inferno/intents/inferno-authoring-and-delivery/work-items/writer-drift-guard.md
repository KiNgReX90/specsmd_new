---
id: writer-drift-guard
title: Drift guard for writer command vs agent body
intent: inferno-authoring-and-delivery
kind: test
complexity: low
mode: autopilot
status: completed
depends_on: [writer-agent]
created: 2026-06-17T00:00:00Z
---

# Work Item: Drift guard for writer command vs agent body

## Description

Add a packaging-invariant test, alongside the existing builder drift case, that
asserts the `inferno-writer` command body stays byte-identical to the canonical
writer agent body (frontmatter stripped) — the same guarantee that protects the
builder. No installer/lib change is required: the writer auto-installs from the
`commands/` folder. This work item only adds the guard so future drift fails CI.

## Acceptance Criteria

- [ ] `src/__tests__/unit/inferno/inferno-flow.test.ts` gains a case: `stripFrontmatter(commands/inferno-writer.md) === stripFrontmatter(agents/writer/agent.md)`
- [ ] The new case mirrors the existing builder drift case in style and helper use
- [ ] `cd src && npm run validate:all` passes with the new case included

## Execution Manifest

context:
  required:
    - path: src/__tests__/unit/inferno/inferno-flow.test.ts
      reason: file to extend; holds the existing builder drift case to mirror
  patterns:
    - path: src/__tests__/unit/inferno/inferno-flow.test.ts
      reason: the existing 'inferno-builder command body is identical' it() block
  tests:
    - path: src/__tests__/unit/inferno/inferno-flow.test.ts
      reason: the suite this case runs in
ownership:
  editable:
    - src/__tests__/unit/inferno/inferno-flow.test.ts

## Technical Notes

The writer files are produced by `writer-agent`; this guard must run after they
exist or it will fail. Keep using the file's `stripFrontmatter` helper.

## Dependencies

- writer-agent
