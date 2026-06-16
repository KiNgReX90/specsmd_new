---
name: work-item-decompose
description: Break an intent into discrete, executable, team-compatible work items with context pointers, ownership, complexity assessment, and dependency validation.
version: 1.0.0
---

<objective>
Break an intent into discrete, executable work items for `/specsmd-fire-team`.
</objective>

<triggers>
  - Intent exists without work items
  - User wants to plan execution for the team workflow
</triggers>

<degrees_of_freedom>
  **MEDIUM** - Follow decomposition patterns but adapt to the specific intent.
</degrees_of_freedom>

<llm critical="true">
  <mandate>Each work item MUST be completable in a single run</mandate>
  <mandate>Each work item MUST have clear acceptance criteria</mandate>
  <mandate>Dependencies MUST be explicit and validated</mandate>
  <mandate>Each work item MUST include depends_on, context.required, and ownership.editable</mandate>
  <mandate>Behavior, architecture, UI, and API work MUST include context.patterns</mandate>
  <mandate>All work except docs-only and config-only MUST include context.tests</mandate>
  <mandate>Record ownership and dependencies truthfully; never misreport them to manufacture parallelism</mandate>
  <mandate>Quality first, parallelism a close second: when slice boundaries are a free choice, prefer ones that give disjoint ownership and short depends_on chains so multiple team builders run at once</mandate>
</llm>

<team_manifest_contract>
  Every work item must include the standard FIRE metadata and this team execution manifest:

  ```yaml
  kind: behavior | architecture | api | ui | test | docs-only | config-only
  depends_on: []
  context:
    required:
      - path: path/to/file-or-directory
        reason: why the builder starts here
    patterns:
      - path: path/to/file-or-directory
        reason: pattern to follow
    tests:
      - path: path/to/test-or-command-reference
        reason: verification target
  ownership:
    editable:
      - path/to/file-or-directory
  ```

  <rule>`context.required` is the minimal starting context. Point to paths; do not paste file bodies.</rule>
  <rule>`context.patterns` is required for behavior, architecture, UI, and API changes.</rule>
  <rule>`context.tests` is required unless `kind` is `docs-only` or `config-only`.</rule>
  <rule>`ownership.editable` describes the expected edit surface. It may overlap with other work items.</rule>
  <rule>Use `depends_on: []` when a work item has no dependencies.</rule>
</team_manifest_contract>

<flow>
  <step n="1" title="Load Intent">
    <action>Read intent brief from .specs-fire/intents/{intent-id}/brief.md</action>
    <action>Understand goal, users, success criteria</action>
  </step>

  <step n="2" title="Identify Deliverables">
    <action>Break intent into discrete deliverables</action>
    <action>Each deliverable should be independently valuable</action>

    <guidelines>
      - Prefer vertical slices over horizontal layers
      - Start with foundation pieces when later work depends on them
      - End with integration pieces such as API, UI, or workflow wiring
      - Keep each item focused on ONE concern
      - Prefer slice boundaries that avoid shared editable files so items can run in parallel; allow overlap only when the work genuinely shares a file
    </guidelines>
  </step>

  <step n="3" title="Assess Complexity">
    <action>For each work item, assess RAW complexity:</action>

    <complexity level="low">
      - Single file or few files
      - Well-understood pattern
      - No external dependencies
      - Examples: bug fix, config change, simple utility
    </complexity>

    <complexity level="medium">
      - Multiple files
      - Standard patterns with some decisions
      - May touch existing code
      - Examples: new endpoint, new component, feature addition
    </complexity>

    <complexity level="high">
      - Architectural decisions required
      - Security or data implications
      - Core system changes
      - Examples: auth system, payment flow, database migration
    </complexity>
  </step>

  <step n="3b" title="Set Execution Mode">
    <action>Set mode: autopilot on every work item</action>
    <note>Team execution is always autopilot: builders run as parallel subagents inside the
    orchestrator's intent worktree and cannot pause for user checkpoints. Oversight happens
    at planning time (this skill's approval gates) and at the orchestrator's verified
    finalize. Complexity from step 3 still matters: the orchestrator uses it to pick the
    worker model tier.</note>
  </step>

  <step n="4" title="Define Acceptance Criteria">
    <action>For each work item, define:</action>
    <substep>What must be true when complete</substep>
    <substep>How to verify it works</substep>
    <substep>Any edge cases to handle</substep>
  </step>

  <step n="5" title="Define Team Manifest">
    <action>For each work item, assign kind, depends_on, context, and ownership</action>
    <substep>Use exact file or directory paths wherever the codebase reveals them</substep>
    <substep>Use narrow, factual reasons for each context pointer</substep>
    <substep>Keep context pointers compact so builders can read only what they need first</substep>
    <substep>Do not emit placeholder paths such as `path/to/file` in saved artifacts</substep>
    <substep>If a required file does not exist yet, point to the nearest directory and the pattern file that should guide creation</substep>
  </step>

  <step n="6" title="Validate Dependencies">
    <action>Check for circular dependencies</action>
    <action>Ensure dependencies exist or will be created first</action>
    <action>Order work items by dependency</action>
    <action>Confirm every item has depends_on, context.required, and ownership.editable</action>
    <action>Confirm behavior, architecture, UI, and API items have context.patterns</action>
    <action>Confirm non-docs and non-config items have context.tests</action>

    <check if="circular dependency detected">
      <output>
        Warning: Circular dependency detected between {item-a} and {item-b}.
        Suggest splitting into smaller items or reordering.
      </output>
    </check>
  </step>

  <step n="7" title="Present Plan">
    <output>
      ## Team Work Items for "{intent-title}"

      **Total**: {count} work items
      **Complexity**: {low} low / {medium} medium / {high} high — all autopilot (team execution)

      **Work Item Details**:

      {for each item}
      {n}. **{title}** ({mode}) - {description}
         - kind: {kind}
         - depends_on: {depends_on}
         - required context: {context.required paths}
         - editable ownership: {ownership.editable paths}
      {/for}

      ---

      Approve this team plan? [Y/n/edit]
    </output>
  </step>

  <step n="8" title="Save Work Items">
    <check if="approved">
      <action>Create .specs-fire/intents/{intent-id}/work-items/</action>
      <action>For each work item, generate using template: templates/work-item.md.hbs</action>
      <action>Save each to: .specs-fire/intents/{intent-id}/work-items/{work-item-id}.md</action>
      <action>Update state.yaml with work items list</action>
    </check>
  </step>

  <step n="9" title="Transition">
    <output>
      **{count} team-compatible work items created** for "{intent-title}".

      ---

      Ready to execute with the team orchestrator? [Y/n]
    </output>
    <check if="response == y">
      <route_to>/specsmd-fire-team</route_to>
    </check>
  </step>
</flow>

<output_artifacts>

  | Artifact | Location | Template |
  |----------|----------|----------|
  | Work Item | `.specs-fire/intents/{intent-id}/work-items/{id}.md` | `./templates/work-item.md.hbs` |
</output_artifacts>

<success_criteria>
  <criterion>Intent decomposed into discrete work items</criterion>
  <criterion>Each work item has clear acceptance criteria</criterion>
  <criterion>Complexity assessed for each item</criterion>
  <criterion>Every work item has mode: autopilot (team execution is checkpoint-free)</criterion>
  <criterion>Dependencies validated (no circular dependencies)</criterion>
  <criterion>Every work item has team-compatible context and ownership fields</criterion>
  <criterion>Ownership is accurate; slices are designed for parallel execution (disjoint ownership preferred) without misreporting</criterion>
  <criterion>Work items saved to correct locations</criterion>
  <criterion>State.yaml updated with work items list</criterion>
</success_criteria>
