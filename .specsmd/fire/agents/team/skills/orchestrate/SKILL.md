---
name: orchestrate
description: Validate and run team-compatible FIRE work items with dependency-aware parallel builder dispatch.
version: 1.0.0
---

<objective>
Run one FIRE intent through parallel builder subagents inside a single intent worktree while keeping git and FIRE state updates serialized.
</objective>

<triggers>
  - User invokes `/specsmd-fire-team`
  - Active intent contains team-compatible pending work items
  - User wants dependency-ready work items handled by multiple builders in parallel
</triggers>

<llm critical="true">
  <mandate>Validate every pending work item before dispatching any builder</mandate>
  <mandate>Pass context pointers, not full file bodies, to builders</mandate>
  <mandate>Allow builders to search autonomously when the manifest is insufficient</mandate>
  <mandate>Do not enforce hard search/token limits that can jam autonomous execution</mandate>
  <mandate>Serialize commits and `.specs-fire/state.yaml` updates in the orchestrator</mandate>
</llm>

<prerequisites>
  <step n="1" title="Load State">
    <action>Read `.specs-fire/state.yaml`</action>
    <action>Scan `.specs-fire/intents/*/work-items/*.md`</action>
    <action>Select the active or requested intent</action>
  </step>

  <step n="2" title="Validate Team Contract">
    <action>For each pending work item, parse the context manifest and ownership block</action>
    <action>Optionally use `scripts/team-scheduler.cjs` helpers when running in a Node-capable environment</action>
    <check if="any item is invalid">
      <output>
        Team execution cannot start.
        Invalid work item: {id}
        Missing fields: {specific fields}
        Return to planning/spec repair and add precise context + ownership.
      </output>
      <stop/>
    </check>
  </step>

  <step n="3" title="Ensure Intent Worktree">
    <action>Create or enter one worktree for the selected intent</action>
    <action>Do not create per-item sub-worktrees</action>
    <action>Confirm the worktree has a clean git status before dispatch</action>
  </step>
</prerequisites>

<dispatch_algorithm>
  <step n="1" title="Build Dependency Graph">
    <action>Read each work item's `depends_on` list</action>
    <action>Treat missing `depends_on` as an empty list</action>
    <action>Classify items as completed, pending, in-flight, or blocked from state and current session facts</action>
  </step>

  <step n="2" title="Find Ready Frontier">
    <action>Select pending items whose dependencies are all completed</action>
    <action>Exclude items already in flight</action>
    <action>Exclude an item when any `ownership.editable` path overlaps an in-flight or already selected item</action>
  </step>

  <step n="3" title="Dispatch Builders">
    <action>Spawn one team builder subagent per selected item</action>
    <action>Use `.claude/agents/specsmd-fire-team-builder.md` or `.codex/skills/specsmd-fire-team-builder/SKILL.md` depending on host</action>
    <action>Pass work item id, intent id, context manifest, editable ownership, and policy only</action>
  </step>

  <step n="4" title="Integrate Results">
    <action>Process builder results one at a time as they complete</action>
    <action>Reject noisy results that include diffs, logs, reasoning traces, or file bodies</action>
    <action>Check `changed_files` against `ownership.editable`; require evidence for any scoped correction outside ownership</action>
    <action>Run or confirm the reported verification command</action>
    <action>Commit the item and update FIRE state through existing scripts or team-compatible wrappers</action>
    <action>Recompute the graph and dispatch newly unblocked items immediately</action>
  </step>
</dispatch_algorithm>

<builder_prompt_policy>
  Builder prompts must include:

  ```yaml
  work_item: item-3
  intent: user-auth
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

  <rule>Do not paste file bodies</rule>
  <rule>Do not ask the builder to read all repository context up front</rule>
  <rule>Tell the builder to search when blocked by missing implementation evidence</rule>
  <rule>Tell the builder to return compact result fields only</rule>
</builder_prompt_policy>

<result_contract>
  Builders return:

  ```yaml
  work_item: item-3
  status: ready
  changed_files:
    - src/app/foo.ts
    - src/app/foo.spec.ts
  tests: npm test -- foo.spec.ts pass
  context_expansion: read src/app/shared/foo-types.ts after import lookup
  notes:
  ```

  <status name="ready">
    <action>Validate ownership, run verification, commit, update state, and recompute frontier</action>
  </status>

  <status name="blocked">
    <action>Stop dispatching dependent work</action>
    <action>Preserve the intent worktree</action>
    <action>Report item, reason, changed files, failing command, and next concrete step</action>
  </status>
</result_contract>

<error_handling>
  <case name="Invalid team work item">
    <action>Stop before dispatch and report exact missing fields</action>
  </case>

  <case name="Builder edits outside ownership">
    <action>Accept only if the result explains evidence-backed necessity; otherwise halt for review</action>
  </case>

  <case name="Verification failure">
    <action>Return the item to the builder if diagnosable; otherwise mark blocked and preserve worktree</action>
  </case>

  <case name="No ready items but pending work remains">
    <action>Report dependency cycle, blocked dependency, or ownership contention with exact item ids</action>
  </case>
</error_handling>

<manual_validation>
  Use a sample intent with dependencies `item-1 -> [item-2, item-3, item-4]`.

  Expected order:
  1. Dispatch `item-1`.
  2. Commit and mark `item-1` completed.
  3. Dispatch `item-2`, `item-3`, and `item-4` together when ownership is disjoint.
</manual_validation>

<success_criteria>
  <criterion>No builder receives full file bodies in its prompt</criterion>
  <criterion>Invalid manifest or ownership stops before dispatch</criterion>
  <criterion>Dependency-frontier scheduling is used throughout the run</criterion>
  <criterion>Ownership overlap blocks unsafe parallelism</criterion>
  <criterion>Final verification passes before merge and cleanup</criterion>
</success_criteria>
