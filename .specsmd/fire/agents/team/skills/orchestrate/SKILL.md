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
  <mandate>Never auto-select an intent: render the standard numbered menu and wait for the user's number, or require an explicit [Y/n] when only one intent is runnable</mandate>
  <mandate>Validate every pending work item before dispatching any builder</mandate>
  <mandate>Pass context pointers, not full file bodies, to builders</mandate>
  <mandate>Allow builders to search autonomously when the manifest is insufficient</mandate>
  <mandate>Do not enforce hard search/token limits that can jam autonomous execution</mandate>
  <mandate>Serialize commits and `.specs-fire/state.yaml` updates in the orchestrator</mandate>
</llm>

<prerequisites>
  <step n="1" title="Load State and Select Intent (never auto-pick)">
    <action>Read `.specs-fire/state.yaml`</action>
    <action>Scan `.specs-fire/intents/*/work-items/*.md`</action>
    <action>If the user named an intent explicitly on invocation, use it and skip the menu</action>
    <action>Otherwise build the runnable set: every intent whose status is not `completed` with at least one pending work item</action>
    <check if="runnable set is empty">
      <output>No runnable intent is present. Capture or decompose one with `/specsmd-fire-team-planner` first.</output>
      <stop/>
    </check>
    <action>Render the runnable set in the standard format from `templates/intent-selection.md.hbs` — numbered menu for multiple intents, single-entry confirmation variant for one. Per intent show number, id, status, pending/total work items, ready-now count, and pending-mode mix.</action>
    <action>STOP and wait: accept the user's number when several intents are runnable; require an explicit [Y/n] when exactly one is. Never proceed on an auto-selected or unconfirmed intent.</action>
    <stop/>
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

  <step n="3" title="Create Intent Worktree (mandatory)">
    <action>Create exactly one dedicated worktree+branch for the intent: `git worktree add <path> -b fire-intent/{intent-id}-{timestamp}`. Run ALL builders inside it. Never run in-place on the default branch — that is what let two concurrent FIRE sessions race on one `state.yaml`. In-place is an explicit user override only.</action>
    <action>Before/at creation, make sure the intent's spec artifacts (`.specs-fire/intents/{intent-id}/` and its `state.yaml` registration) actually live in the worktree: a fresh worktree is checked out from a commit, so any still-untracked or uncommitted intent artifacts must be committed first (this is the gotcha that historically pushed runs in-place — handle it, don't skip the worktree).</action>
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
    <action>Before dispatching any builder, check the budget HALT flag at `~/.claude/wrap-up-state/HALT`. If it exists with `resets_at` in the future, STOP dispatching entirely and go to Halt Finalize — do not start new builders during a cap.</action>
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

<halt_finalize critical="true">
  Runs when the budget HALT flag is set (detected before a frontier dispatch, or because one or more builders returned `status: halted`). This REPLACES normal finalize while halted — the intent is NOT complete.

  <step n="1" title="Collect state">
    <action>Partition items into: completed (already committed this run), halted (returned halted, partial edits uncommitted in the worktree), and pending (never dispatched).</action>
  </step>
  <step n="2" title="Write the intent-handoff">
    <action>Write `.specs-fire/halt-notes/_intent-<intent_id>.md` recording: the intent id and worktree path; which items are completed/halted/pending; for each halted item a pointer to its `.specs-fire/halt-notes/<work_item_id>.md` note and that its edits sit uncommitted in the worktree; and the dependency frontier as of the halt.</action>
    <action>Do NOT touch `.specs-fire/state.yaml`. Halted items were never committed, so they remain `pending` and will be re-selected naturally on resume.</action>
  </step>
  <step n="3" title="Wait">
    <action>Launch the waiter in the background: Bash("~/.claude/bin/wait-for-5h-reset.sh", run_in_background: true). Then end the turn. The harness re-invokes this same orchestrator session when the wait ends.</action>
  </step>
</halt_finalize>

<resume critical="true">
  On re-invocation after the wait (HALT now cleared), resume instead of starting fresh:
  <step n="1"><action>Read `.specs-fire/halt-notes/_intent-<intent_id>.md` to recover the partition and frontier.</action></step>
  <step n="2"><action>Recompute the dependency frontier from `.specs-fire/state.yaml` (the source of truth — halted/pending items are still `pending`).</action></step>
  <step n="3"><action>Re-dispatch halted + pending ready items. For each halted item, pass its note path `.specs-fire/halt-notes/<work_item_id>.md` and instruct the builder to assess the partial uncommitted edits already in the worktree before continuing, rather than starting over.</action></step>
  <step n="4"><action>Continue the normal dispatch/integrate loop to completion, then run the normal finalize.</action></step>
</resume>

<finalize critical="true">
  Run this ONCE, automatically, the moment the selected intent has no pending or in-flight items left — i.e. the last item just integrated. Closing an intent INCLUDES shipping it. Do NOT stop at local commits and wait for the user to ask for the merge, push, or cleanup — that is the recurring failure this step exists to kill.

  <step n="1" title="Final Verification">
    <action>Confirm the full build passes on the integrated tree (not just per-item tests)</action>
  </step>
  <step n="2" title="Mark Intent Completed">
    <action>Set the intent status to `completed` (with `completed_at`) in `.specs-fire/state.yaml` and commit the bookkeeping, staging only FIRE artifacts for this intent — never `git add -A`</action>
  </step>
  <step n="3" title="Merge + Tear Down Worktree">
    <action>Merge the intent worktree branch into the default branch.</action>
    <action>Kill every process THIS worktree spawned before removing it: its dev-server port, any MCP/sidecar process, the build/compile process, and file watchers. Scope the kill to THIS worktree (processes whose cwd is inside it, or the specific port/PID it started); never blanket-kill shared toolchain processes — that could hit a concurrent session. A stale dev server left alive on the worktree's port is what poisons a later e2e run.</action>
    <action>Remove the worktree (`git worktree remove`) + delete the branch. This ALWAYS runs — the team flow always uses a dedicated worktree, so there is always one to tear down. Never leave a merged worktree, or its processes, alive.</action>
  </step>
  <step n="4" title="Push to Remote">
    <action>Push the default branch to `origin`. This is part of intent close, not an optional extra</action>
    <action>Verify the push landed (HEAD == origin/HEAD, 0 ahead) before reporting success</action>
  </step>
  <step n="5" title="Report">
    <action>Report the intent commits, push result (ahead → 0), and worktree disposition (merged+removed, or "in-place, none to clean up")</action>
  </step>
</finalize>

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

  <status name="halted">
    <action>This builder hit the account budget cap mid-item and checkpointed instead of finishing. Do NOT re-dispatch it — re-dispatching just re-hits the gate and loops.</action>
    <action>Record the item as halted with a pointer to its note at `.specs-fire/halt-notes/<work_item_id>.md`. Its partial edits remain uncommitted in the worktree.</action>
    <action>Do not commit the item and do not advance dependents. Proceed to Halt Finalize.</action>
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

  <case name="Builder reported tool-call failure">
    <trigger>Builder returned `status: blocked` with `notes` whose first token is `tool_failure:`</trigger>
    <action>Parse the failure line: `tool_failure: <ToolName> <args summary> → <error>`</action>
    <action>Augment the original context manifest based on the failure mode before re-dispatching:
      - **Missing file / ENOENT** — run `Glob` for plausible matches (filename across the worktree, sibling typos), pick the closest match, and add it to `context.required` with a one-line reason. If no plausible match exists, escalate to user instead of re-dispatching.
      - **Edit stale-fingerprint** — no manifest change. Add an explicit instruction in the re-dispatch prompt: "the previous attempt hit a stale-fingerprint Edit on `<path>` — Read the file fresh before any Edit on it this run."
      - **Bash exit-nonzero on non-test command** — include the stderr verbatim (one line, truncated to ~200 chars if long) in the re-dispatch prompt's instructions, with the explicit ask "address this error and retry the same command, or return blocked with a different cause if the error indicates a work-item premise problem."
      - **Write permission denied** — escalate to user immediately, do not re-dispatch. Likely a path-outside-ownership or fs-permission issue the builder cannot resolve.
      - **Unknown / other tool failure** — escalate to user with the raw failure line.
    </action>
    <action>Re-dispatch the SAME work item ONCE with the augmented prompt. Mark the dispatch internally as attempt 2 of 2; do not re-dispatch a third time on tool failure.</action>
    <action>If the second attempt also returns `status: blocked` with a `tool_failure:` prefix, halt and report to user: include the work item id, both failure lines, and the manifest augmentation tried. Do not commit, do not advance to dependent items.</action>
  </case>

  <case name="Builder produced no result or malformed result">
    <trigger>Dispatched builder's final response is empty, plain prose without a parseable YAML contract, or YAML missing the required `work_item` or `status` fields. A well-formed `status: halted` return is NOT malformed — route it to the `halted` status handler, never re-dispatch.</trigger>
    <action>Treat the dispatch as `status: blocked` with reason "malformed/missing return". Do NOT optimistically assume `ready` and commit — this is the primary silent-stall vector and must always surface.</action>
    <action>Capture up to the first ~400 chars of the raw final response for the audit log; if the prose contains an obvious error fragment, extract it as a hint for the re-dispatch.</action>
    <action>Re-dispatch the SAME work item ONCE with a sharpened prompt that (a) quotes the YAML return contract verbatim, (b) explicitly forbids prose-only responses, and (c) lists the missing/malformed fields from the previous attempt. Include the captured error hint if any.</action>
    <action>If the re-dispatch also produces malformed/missing output, halt and report to user with the work item id, both raw response excerpts, and the prompt augmentation tried. Do not commit, do not mark the item completed, do not advance to dependent items.</action>
  </case>

  <case name="No ready items but pending work remains">
    <action>Report dependency cycle, blocked dependency, or ownership contention with exact item ids</action>
  </case>
</error_handling>

<dispatch_audit_log critical="true">
  Every dispatch and every result MUST be recorded in an in-memory audit log for the duration of the run, keyed by `(work_item_id, attempt_number)`. Required fields per entry:
  - `dispatched_at` — wall-clock or run-relative timestamp
  - `attempt` — 1 or 2
  - `result_status` — `ready` | `blocked` | `retry` | `malformed` | `no_return`
  - `failure_signature` — for non-ready: first line of `notes` (or "malformed/missing" if no parseable result)

  Before halting the run for ANY reason — success or failure — surface a one-block summary of every non-`ready` entry to the user. The orchestrator's silent-stall failure mode happens precisely when a dispatch returns nothing useful and the orchestrator never tells anyone; this log is the structural guard against that. Do not skip it even when the run looks clean.
</dispatch_audit_log>

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
  <criterion>Intent close merges the intent worktree into the default branch, kills the processes that worktree spawned, removes the worktree, and pushes to origin — automatically, without the user asking</criterion>
</success_criteria>
