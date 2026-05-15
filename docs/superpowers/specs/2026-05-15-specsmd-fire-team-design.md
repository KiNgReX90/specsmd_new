# specsmd-fire-team Design

## Goal

Create a separate `specsmd-fire-team` workflow for running FIRE work items with parallel builder subagents inside one intent worktree. The workflow must not overwrite or mutate existing specsmd FIRE command, agent, or skill files. It should add sibling functionality that can later be proposed in a PR.

## Non-Goals

- Do not replace the existing `specsmd-fire` flow.
- Do not modify existing `specsmd-fire` command, agent, or skill files as part of this design.
- Do not force every work item into its own sub-worktree.
- Do not prevent builders from searching when implementation evidence shows they need more context.

## Architecture

Add a new namespaced command, agent, and skill family for `specsmd-fire-team`.

Proposed file family:

```text
.codex/skills/specsmd-fire-team/SKILL.md
.codex/skills/specsmd-fire-team-builder/SKILL.md

.claude/commands/specsmd-fire-team.md
.claude/agents/specsmd-fire-team.md
.claude/agents/specsmd-fire-team-builder.md

.specsmd/fire/agents/team/agent.md
.specsmd/fire/agents/team/skills/orchestrate/SKILL.md
.specsmd/fire/agents/team-builder/agent.md
.specsmd/fire/agents/team-builder/skills/workitem-execute/SKILL.md
```

The team orchestrator owns intent selection, worktree setup, dependency scheduling, worker dispatch, state updates, commits, final verification, merge, and cleanup.

The team builder owns exactly one implementation task. It reads its assigned work item, follows the context manifest, edits only within its ownership scope unless evidence requires a scoped correction, runs relevant tests, and returns a compact result. It does not commit, edit FIRE state, spawn nested subagents, or choose additional work items.

## Planner Contract

A `specsmd-fire-team` work item must include a context manifest and ownership block. Items without these fields are invalid for team execution and must return to planning/spec repair.

Minimum shape:

```yaml
context:
  required:
    - path: src/app/foo.ts
      reason: "Primary implementation target"
  patterns:
    - path: src/app/bar.ts
      reason: "Existing pattern to follow"
  tests:
    - path: src/app/foo.spec.ts
      reason: "Relevant test coverage"
ownership:
  editable:
    - src/app/foo.ts
    - src/app/foo.spec.ts
```

Rules:

- `context.required` must not be empty.
- `ownership.editable` must not be empty.
- `context.patterns` is required for behavior, architecture, UI, or API work.
- `context.tests` is required unless the item is explicitly docs-only or config-only.
- File paths should be precise enough for a builder to start without broad repository discovery.
- Work items should include concise notes when a small summary can replace repeated rediscovery.

## Context Economy

Token savings come from better starting context, not from blocking builders from doing necessary research.

The orchestrator passes pointers and policy. It does not preload all referenced files into its own context, and it does not copy large file bodies into worker prompts.

Builder startup order:

1. Read the work item.
2. Read `context.required`.
3. Read `context.patterns` when implementing unless clearly irrelevant.
4. Read `context.tests` before adding or changing tests.
5. Search autonomously when the curated context is insufficient.

Autonomous search rules:

- Prefer `rg`, imports, compiler errors, tests, and symbol names over broad scans.
- Expand context because of implementation evidence, not curiosity.
- Stay within assigned ownership unless evidence shows the item scope is wrong.
- Return a one-line `context_expansion` summary instead of file contents or reasoning traces.

Example result:

```text
work_item: item-3
status: ready
changed_files:
  - src/app/foo.ts
  - src/app/foo.spec.ts
tests: npm test -- foo.spec.ts pass
context_expansion: read src/app/shared/foo-types.ts after import lookup
notes:
```

## Execution Flow

1. Validate the selected intent has team-compatible work items.
2. Ensure one intent worktree.
3. Build the dependency graph.
4. Dispatch every ready item whose `ownership.editable` does not overlap with another in-flight item.
5. Each builder works autonomously from its manifest and expands context only when needed.
6. Builders return compact results: status, changed files, tests, and context expansion summary.
7. The orchestrator serially validates changed files, commits, and updates FIRE state for each result.
8. After each completed item, recompute the graph and immediately dispatch newly unblocked items.
9. When all items complete, run final verification/review, merge the intent worktree, and clean up.

Parallelism is dependency-frontier based. If item 2, 3, and 4 depend on item 1, the orchestrator dispatches item 1 first. Once item 1 is complete and committed, it dispatches items 2, 3, and 4 in parallel when their editable ownership does not overlap.

## Git And State Discipline

Builders do not commit and do not edit `.specs-fire/state.yaml`.

The orchestrator serializes all bookkeeping:

- inspect each builder result;
- verify changed files stay inside ownership or have an evidence-backed reason;
- run or confirm relevant verification;
- commit the completed item;
- update state through existing FIRE scripts when compatible, or through new `specsmd-fire-team` wrapper scripts when team-specific behavior is needed;
- recompute the graph before further dispatch.

This avoids git lock races and state-file conflicts while still allowing implementation work to happen in parallel inside one intent worktree.

## Error Handling

Invalid team work item:

- Stop before dispatch.
- Report the missing manifest or ownership fields.
- Recommend returning to planning/spec repair.

Builder returns `blocked`:

- Stop dispatching dependent work.
- Preserve the intent worktree.
- Report the item, reason, changed files, and next concrete step.

Builder edits outside ownership:

- If the result explains an evidence-backed reason, the orchestrator may accept it.
- If the edit is unexplained or risky, halt and preserve the worktree for review.

Verification failure:

- The builder should fix failures it can diagnose.
- If unresolved, it returns `blocked` with the failing command and one-line reason.
- The orchestrator does not merge a blocked or failing intent.

## Testing

The implementation plan should include tests for:

- manifest validation rejects work items without `context.required` or `ownership.editable`;
- dependency scheduling dispatches newly unblocked items without waiting for unrelated in-flight work;
- ownership overlap prevents unsafe parallel dispatch;
- builder prompts include context policy but not full file bodies;
- orchestrator handles compact builder results and serializes commits/state updates;
- blocked worker results preserve the intent worktree and stop dependent dispatch.

Manual validation should run one sample intent with a dependency shape like `1 -> [2, 3, 4]` and confirm the observed dispatch order.
