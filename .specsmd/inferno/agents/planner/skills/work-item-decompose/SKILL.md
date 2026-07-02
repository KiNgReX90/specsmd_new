---
name: work-item-decompose
description: Break an intent into discrete, executable, work items with context pointers, ownership, complexity assessment, and dependency validation.
version: 1.0.0
---

<objective>
Break an intent into discrete, executable work items for `/specsmd-inferno`.
</objective>

<triggers>
  - Intent exists without work items
  - User wants to plan execution for the INFERNO workflow
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
  <mandate>Every load-bearing caveat in decisions.md MUST be INLINED into the `## Caveats` of at least one work item (the item(s) whose code it governs) AND that item MUST list decisions.md in context.required. Caveats are written once in the ledger and carried into the builder-facing item — never flattened away. A dropped caveat is the dominant cause of a confidently-wrong build.</mandate>
  <mandate>Record ownership and dependencies truthfully; never misreport them to manufacture parallelism</mandate>
  <mandate>Quality first, parallelism a close second: when slice boundaries are a free choice, prefer ones that give disjoint ownership and short depends_on chains so multiple builders run at once</mandate>
</llm>

<team_manifest_contract>
  Every work item must include the standard INFERNO metadata and this execution manifest:

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
    <action>Read intent brief from .specs-inferno/intents/{intent-id}/brief.md</action>
    <action>Read the two ledgers `decisions-capture` wrote: `.specs-inferno/intents/{intent-id}/requirements.md` (the written scope every item must collectively cover) and `.specs-inferno/intents/{intent-id}/decisions.md` (dated decisions + load-bearing caveats + release gates). These are the source of truth — you LINK and INLINE from them, never re-derive or re-summarize.</action>
    <action>Understand goal, users, success criteria, and the full caveat list (note which are `OPEN`)</action>
    <append_mode>
      When invoked in APPEND mode (an `integrate` outcome from intent-capture's cross-intent overlap check), the target intent already has work items. ALSO read its existing `.specs-inferno/intents/{intent-id}/work-items/*.md` and its `work_items` list in state.yaml. You are ADDING items, not replacing: new work-item ids must not collide with existing ones, and wire each new item's `depends_on` to the existing items it genuinely builds on. In step 8.5 you MERGE the new items into the intent's `work_items` list — never overwrite the existing entries.
    </append_mode>
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
    <note>Execution is always autopilot: builders run as parallel subagents inside the
    orchestrator's intent worktree and cannot pause for user checkpoints. Oversight happens
    at planning time (under `mode: production`, the planner's single urgent-only review
    point after decomposition) and at the orchestrator's verified finalize. Complexity from
    step 3 still matters: the orchestrator uses it to pick the worker model tier.</note>
  </step>

  <step n="4" title="Define Acceptance Criteria">
    <action>For each work item, define:</action>
    <substep>What must be true when complete</substep>
    <substep>How to verify it works</substep>
    <substep>Any edge cases to handle</substep>
  </step>

  <step n="5" title="Define Manifest">
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

  <step n="6b" title="Cross-Intent Ownership Cross-Check" critical="true">
    <action>Now that ownership is known, cross-check it against the OTHER open intents. Read `.specs-inferno/state.yaml` plus the `ownership.editable` of every non-completed intent's work items (`.specs-inferno/intents/{other-id}/work-items/*.md`).</action>
    <action>If any of THIS intent's `ownership.editable` paths collide with a `pending` intent's work-item ownership AND this intent is not already integrated into or dependent on it, you have a cross-intent file collision: two intents that edit the same files cannot safely build in arbitrary order across separate worktrees. Record an intent-level dependency — add `depends_on: [<that-intent-id>]` to THIS intent's state.yaml entry and brief — so the orchestrator serializes them. Under `mode: production` surface the collision and the added dependency; under `autonomous` apply it and note it.</action>
    <action>Never point the dependency at a `completed` intent and never create a cycle. A genuine same-file integration may instead warrant folding the two intents together — surface that option under `review`.</action>
  </step>

  <step n="6c" title="Caveat-Survival Check" critical="true">
    <action>Before presenting the plan, prove that no load-bearing fact was lost in decomposition. Walk EVERY caveat in `decisions.md`. For each, confirm it is INLINED into the `## Caveats` of at least one work item — the item(s) whose code it actually governs — and that those items list `decisions.md` in `context.required`.</action>
    <action>Also confirm coverage the other way: every FR/NFR in `requirements.md` is covered by at least one work item's acceptance criteria, with nothing silently descoped.</action>
    <check if="any caveat is unhomed OR any requirement is uncovered">
      <output>
        Caveat-survival gap: {caveat-id / requirement-id} is not carried by any work item.
      </output>
      <action>This is a decomposition bug, not an acceptable state. Fix it: attach the caveat to the right item (or add the missing item), then re-run this check. Do NOT proceed to write items with an unhomed load-bearing caveat.</action>
    </check>
    <note>An `OPEN` caveat is still homed — the build rule tells the builder what NOT to assume (e.g. "no column exists — do not add NOT NULL"). OPEN means unresolved, not droppable.</note>
  </step>

  <step n="7" title="Present Plan">
    <output>
      ## Work Items for "{intent-title}"

      **Total**: {count} work items
      **Complexity**: {low} low / {medium} medium / {high} high — all autopilot (execution)

      **Work Item Details**:

      {for each item}
      {n}. **{title}** ({mode}) - {description}
         - kind: {kind}
         - depends_on: {depends_on}
         - required context: {context.required paths}
         - editable ownership: {ownership.editable paths}
      {/for}

      ---

      Approve this plan? [Y/n/edit]
    </output>
  </step>

  <step n="8" title="Save Work Items (parallel scribe fan-out)">
    <critical>ALL content and reasoning is done HERE, by you (the planner), BEFORE any file is written. The writing itself is fanned out to parallel scribes purely for speed — scribes make no decisions.</critical>
    <check if="approved">
      <substep n="8.1" title="Build decision records">
        For EACH work item, produce a COMPLETE decision record — every field the
        template `templates/work-item.md.hbs` needs, fully decided: id, title,
        kind, complexity, mode (autopilot), depends_on, description, acceptance
        criteria, the `caveats` list (id + build rule, copied verbatim from
        decisions.md for the caveats that govern this item — empty list if none),
        the full `context` manifest (required/patterns/tests with real paths +
        reasons; include `decisions.md` in required whenever the item carries a
        caveat), `ownership.editable`, optional `finalize_check`, and technical
        notes. Leave NOTHING for the scribe to decide or infer. These records are
        the entirety of your decomposition reasoning, serialized.
      </substep>
      <substep n="8.2" title="Create the target directory">
        Create `.specs-inferno/intents/{intent-id}/work-items/`.
      </substep>
      <substep n="8.3" title="Dispatch scribes in parallel">
        Dispatch one `specsmd-inferno-writer` subagent PER work item, all in ONE
        round (parallel). Each dispatch prompt contains ONLY: the item's decision
        record, the template path `templates/work-item.md.hbs`, and the output
        path `.specs-inferno/intents/{intent-id}/work-items/{work-item-id}.md`.
        No policy restatement — the installed writer agent body is its system
        prompt. Set each dispatch `model` override to `models.writer` from
        `.specs-inferno/config.yaml`; if `models.writer` is unset, use
        `models.cheap`; if neither is set, dispatch with no model override
        (host default). Disjoint output paths mean the writers never collide.
      </substep>
      <substep n="8.4" title="Collect results">
        Each scribe returns `status: written | failed` with the path it wrote.
        Any `failed` (missing/ambiguous field) is YOUR bug in the decision
        record, not the scribe's — fix the record and re-dispatch that one item.
        Never accept a partial or invented artifact.
      </substep>
      <substep n="8.5" title="Update state (planner only)">
        After ALL scribes return `written`, YOU — not any scribe — update
        `state.yaml` once with the work-items list. Scribes never touch
        `state.yaml`. In APPEND mode, MERGE the new items into the target
        intent's existing `work_items` list (and keep any intent-level
        `depends_on` the cross-checks added) — never overwrite the existing
        items.
      </substep>
      <substep n="8.6" title="Fallback (host without subagents)">
        On a host without subagents, skip the dispatch: render each item from the
        template and write the files yourself, sequentially, then do 8.5.
      </substep>
    </check>
  </step>

  <step n="9" title="Transition">
    Decomposition ends at writing the items — it never starts the build. After the files are written, hand back to the planner's `<handoff_format>`, which prints the summary, applies the `mode` review pause, and STOPS. The build is a separate, explicit step the user runs later with `/specsmd-inferno` (or `/schedule-inferno`).
    <output>
      **{count} work items created** for "{intent-title}".

      ---

      The plan is ready. Start the build with `/specsmd-inferno` (or `/schedule-inferno`) when you're ready.
    </output>
  </step>
</flow>

<output_artifacts>

  | Artifact | Location | Template |
  |----------|----------|----------|
  | Work Item | `.specs-inferno/intents/{intent-id}/work-items/{id}.md` | `./templates/work-item.md.hbs` |
</output_artifacts>

<success_criteria>
  <criterion>Intent decomposed into discrete work items</criterion>
  <criterion>Each work item has clear acceptance criteria</criterion>
  <criterion>Every load-bearing caveat in decisions.md is inlined into at least one work item's `## Caveats` and that item lists decisions.md in context.required (caveat-survival check passed)</criterion>
  <criterion>Every requirement in requirements.md is covered by a work item's acceptance criteria; nothing silently descoped</criterion>
  <criterion>Complexity assessed for each item</criterion>
  <criterion>Every work item has mode: autopilot (execution is checkpoint-free)</criterion>
  <criterion>Dependencies validated (no circular dependencies)</criterion>
  <criterion>Ownership cross-checked against other open intents; cross-intent file collisions resolved by an intent-level `depends_on` (or folding), never left to race</criterion>
  <criterion>In APPEND mode, new items merged into the existing intent without overwriting its current work items</criterion>
  <criterion>Every work item has context and ownership fields</criterion>
  <criterion>Ownership is accurate; slices are designed for parallel execution (disjoint ownership preferred) without misreporting</criterion>
  <criterion>Work items saved to correct locations</criterion>
  <criterion>All decomposition reasoning done by the planner; file writing fanned out to parallel `specsmd-inferno-writer` scribes (one file per work item) on the `models.writer` tier, with a sequential fallback where subagents are unavailable</criterion>
  <criterion>State.yaml updated with work items list by the planner alone (scribes never touch state)</criterion>
</success_criteria>
