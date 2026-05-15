---
name: workitem-execute
description: Execute one assigned FIRE team work item from a context manifest and editable ownership block.
version: 1.0.0
---

<objective>
Implement exactly one assigned work item and return a compact integration result to the team orchestrator.
</objective>

<triggers>
  - Team orchestrator dispatches one ready work item
  - Work item includes `context.required` and `ownership.editable`
  - Builder is running inside the orchestrator's intent worktree
</triggers>

<llm critical="true">
  <mandate>Do not commit</mandate>
  <mandate>Do not edit `.specs-fire/state.yaml`</mandate>
  <mandate>Do not spawn subagents</mandate>
  <mandate>Do not choose or execute additional work items</mandate>
  <mandate>Do not return diffs, logs, reasoning traces, or file bodies</mandate>
  <mandate>Search autonomously when blocked by missing local context</mandate>
</llm>

<flow>
  <step n="1" title="Validate Assignment">
    <action>Confirm work item id, intent id, `context.required`, and `ownership.editable` are present</action>
    <check if="assignment is incomplete">
      <output>
        work_item: {id or unknown}
        status: blocked
        changed_files: []
        tests: not run - incomplete assignment
        context_expansion: none
        notes: Missing {specific assignment field}; cannot execute safely.
      </output>
      <stop/>
    </check>
  </step>

  <step n="2" title="Load Minimal Context">
    <action>Read files listed in `context.required`</action>
    <action>Read files listed in `context.patterns` when the item changes behavior, architecture, UI, or API surfaces</action>
    <action>Read files listed in `context.tests` before changing tests</action>
    <action>Track extra files read because of implementation evidence for `context_expansion`</action>
  </step>

  <step n="3" title="Plan Locally">
    <action>Identify the smallest implementation path for this work item</action>
    <action>Confirm all intended edits are inside `ownership.editable`</action>
    <action>If ownership is wrong, search only enough to prove the correction and keep notes concise</action>
  </step>

  <step n="4" title="Implement">
    <action>Edit only files required for this work item</action>
    <action>Follow existing project patterns from the manifest and local context</action>
    <action>Keep unrelated cleanup out of the change</action>
  </step>

  <step n="5" title="Verify">
    <action>Run the narrowest relevant test command from `context.tests` or the repository's test conventions</action>
    <action>If tests fail and the cause is in scope, fix and rerun</action>
    <action>If tests fail for missing requirements or out-of-scope defects, return `blocked` with the exact command and reason</action>
  </step>

  <step n="6" title="Return Compact Result">
    <action>List changed files only</action>
    <action>Summarize tests in one line</action>
    <action>Summarize context expansion in one line; use `none` when no extra context was read</action>
    <action>Do not include full diffs, logs, reasoning traces, or file bodies</action>
  </step>
</flow>

<context_expansion_examples>
  <good>read src/app/shared/foo-types.ts after import lookup</good>
  <good>read package.json to confirm test command</good>
  <good>none</good>
  <bad>pasted file contents from src/app/foo.ts</bad>
  <bad>read the whole repository</bad>
</context_expansion_examples>

<blocked_rules>
  Return `blocked` when:

  - Required assignment fields are missing
  - A necessary edit is outside ownership and not a small evidence-backed correction
  - The spec is ambiguous enough that implementation would be guesswork
  - Verification fails for a reason outside this work item's scope
</blocked_rules>

<result_contract>
  ```yaml
  work_item: {assigned-id}
  status: ready | blocked
  changed_files:
    - {path}
  tests: {command} {pass|fail|not run - reason}
  context_expansion: {one-line summary or none}
  notes: {empty or concise integration note}
  ```
</result_contract>

<success_criteria>
  <criterion>The assigned work item is complete or clearly blocked</criterion>
  <criterion>Only relevant files are changed</criterion>
  <criterion>Verification command and result are included</criterion>
  <criterion>Final response is compact and integration-ready</criterion>
</success_criteria>
