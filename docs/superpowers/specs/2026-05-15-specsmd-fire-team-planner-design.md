# specsmd-fire-team-planner Design

## Goal

Create a separate `specsmd-fire-team-planner` workflow that behaves like the existing FIRE planner but decomposes intents into work items that are immediately valid for `specsmd-fire-team` execution.

The workflow must not modify existing `specsmd-fire-planner` files. It should add sibling planner functionality that can later be proposed in a PR alongside the team orchestrator and team builder.

## Non-Goals

- Do not replace the existing `specsmd-fire-planner` flow.
- Do not modify existing planner command, agent, skill, or template files.
- Do not make the planner responsible for avoiding editable ownership overlap.
- Do not make the planner responsible for scheduling parallel execution.
- Do not make the team orchestrator invent missing planning context during execution.

## Architecture

Add a new namespaced planner family for `specsmd-fire-team-planner`.

Proposed file family:

```text
.codex/skills/specsmd-fire-team-planner/SKILL.md

.claude/commands/specsmd-fire-team-planner.md
.claude/agents/specsmd-fire-team-planner.md

.specsmd/fire/agents/team-planner/agent.md
.specsmd/fire/agents/team-planner/skills/intent-capture/SKILL.md
.specsmd/fire/agents/team-planner/skills/intent-capture/templates/brief.md.hbs
.specsmd/fire/agents/team-planner/skills/work-item-decompose/SKILL.md
.specsmd/fire/agents/team-planner/skills/work-item-decompose/templates/work-item.md.hbs
.specsmd/fire/agents/team-planner/skills/design-doc-generate/SKILL.md
.specsmd/fire/agents/team-planner/skills/design-doc-generate/templates/design.md.hbs
```

The team planner mirrors the existing planner lifecycle:

1. No active intent: capture a new intent.
2. Active intent without work items: decompose into work items.
3. High-complexity work item: generate a design doc.

The difference is limited to work item shape and routing. Team planner work items include the context manifest and ownership block required by `specsmd-fire-team`. When planning is complete, it routes to `/specsmd-fire-team`, not `/specsmd-fire-builder`.

## Team Work Item Contract

Every team planner work item must include the standard FIRE work item fields plus team execution fields.

Minimum shape:

```yaml
id: foo-endpoint
title: "Implement foo endpoint"
status: pending
complexity: medium
mode: confirm
depends_on:
  - foo-model
acceptance_criteria:
  - "Foo endpoint returns expected payload"
verification:
  - "npm test -- foo"
context:
  required:
    - path: src/app/foo.ts
      reason: "Primary implementation target"
  patterns:
    - path: src/app/bar.ts
      reason: "Existing endpoint pattern"
  tests:
    - path: src/app/foo.test.ts
      reason: "Relevant endpoint tests"
ownership:
  editable:
    - src/app/foo.ts
    - src/app/foo.test.ts
```

Rules:

- `context.required` must not be empty.
- `ownership.editable` must not be empty.
- `context.patterns` is required for behavior, architecture, UI, or API work.
- `context.tests` is required unless the item is explicitly docs-only or config-only.
- `depends_on` must be present; use an empty list when there are no dependencies.
- Ownership overlap is allowed. The team orchestrator decides whether overlapping items can run concurrently.
- File pointers should be precise enough for a builder to start without broad repository discovery.

## Planner Behavior

### Intent Capture

The team planner uses the same intent capture behavior as the normal planner:

- ask clarifying questions;
- capture goal, users, constraints, and success criteria;
- save `brief.md`;
- update `.specs-fire/state.yaml`.

The generated brief does not need team-specific fields. Team-specific data belongs in work items.

### Work Item Decomposition

The team planner decomposes the active intent into normal FIRE deliverables, then enriches each deliverable with team execution context.

For each work item, it must:

1. Assign id, title, description, complexity, mode, acceptance criteria, verification, and dependencies.
2. Identify `context.required` paths that are primary implementation targets.
3. Identify `context.patterns` paths when the item changes behavior, architecture, UI, or API surfaces.
4. Identify `context.tests` paths unless the item is docs-only or config-only.
5. Identify `ownership.editable` paths that the builder is expected to edit.
6. Present the plan for user approval.
7. Save work items using the team planner template.
8. Update state with the work item list.

The planner should prefer useful work boundaries, not artificial overlap avoidance. If two items naturally touch the same file, both may list that file in `ownership.editable`.

### Design Doc Generation

High-complexity items use the same design-doc lifecycle as the normal planner:

- read the work item;
- read relevant standards;
- identify technical decisions;
- draft and review the design doc;
- save the design doc;
- update state checkpoint status.

The design doc should mention any team-context assumptions when they affect implementation, but it should not duplicate the full work item manifest.

## Routing

Activation mirrors the normal planner:

```text
[1] state.yaml exists?
    -> No  -> route to /specsmd-fire for project initialization
    -> Yes -> [2]

[2] No active intent?
    -> run team intent-capture

[3] Active intent without work items?
    -> run team work-item-decompose

[4] High-complexity item needs design?
    -> run team design-doc-generate

[5] Team-compatible work items ready?
    -> route to /specsmd-fire-team
```

The team planner should not route to `/specsmd-fire-builder`.

## Validation

The team planner should validate work item shape before saving:

- reject missing `context.required`;
- reject missing `ownership.editable`;
- reject missing `context.patterns` for behavior, architecture, UI, and API work;
- reject missing `context.tests` unless docs-only or config-only;
- reject circular dependencies;
- allow overlapping ownership.

The implementation can reuse or mirror the existing team scheduler validation helper, but the planner should treat validation as a planning gate before state is updated.

## Error Handling

No active state:

- Route to `/specsmd-fire` project initialization.

Insufficient repository context for file pointers:

- Ask one focused clarifying question or perform targeted discovery with `rg`, file tree scans, and existing pattern lookup.
- Do not emit placeholder paths.

Invalid decomposition:

- Stop before saving.
- Present exact missing fields or dependency issues.
- Regenerate the affected work items.

User rejects proposed work item plan:

- Ask what to change.
- Revise the decomposition.
- Re-run validation before saving.

## Testing

The implementation plan should include tests for:

- team planner work item template includes `context`, `ownership`, and `depends_on`;
- validation rejects missing `context.required`;
- validation rejects missing `ownership.editable`;
- validation rejects missing `context.patterns` for behavior/API/UI/architecture work;
- validation rejects missing `context.tests` for non-docs/config work;
- validation allows overlapping `ownership.editable` paths;
- planner activation routes completed team-compatible work items to `/specsmd-fire-team`.

Manual validation should run the team planner against a sample intent and confirm generated work items pass the team orchestrator's manifest checks.
