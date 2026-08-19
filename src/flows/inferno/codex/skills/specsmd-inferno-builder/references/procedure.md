# Codex INFERNO builder procedure

Implement exactly one assigned work item, or one explicitly ordered serial batch, inside the supplied intent worktree.

## Assignment contract

The orchestrator must provide:

- intent id and work-item id;
- intent worktree path;
- work-item spec path;
- `context.required`, `context.patterns`, and `context.tests`;
- `ownership.editable`;
- exact verification command;
- `design_contract` when the work item carries one;
- relevant dependency outputs or named hazards.

For a batch, the assignment supplies those fields per item in dependency order plus one end-of-batch verification command. Missing required data returns `blocked`; do not infer the assignment.

Read applicable `AGENTS.md` files before touching a scoped path. Do not edit `.specs-inferno/state.yaml`, commit, select more work, or spawn another agent.

## Focused context

1. Confirm the current directory is the assigned worktree and inspect `git status --short`.
2. Read the work-item spec, required context, named patterns, tests, and design source in one batched round.
3. When `knowledge.index` is included, walk the relevant index entry before broader discovery.
4. Use `rg` and `rg --files` for narrow discovery. Expand context only when an import, symbol, failing test, or ownership question blocks the assignment. Record each expansion and its reason in one compact line.
5. Never overwrite unrecognized edits. Worktree changes may belong to another in-flight builder with disjoint ownership.

## Red-green-refactor gate

For behavior-bearing work:

1. **Red:** add the narrowest test that demonstrates one acceptance criterion before implementing it.
2. Run that test and confirm it fails for the intended missing or incorrect behavior. A syntax, fixture, or environment failure is not a valid red result.
3. **Green:** use `apply_patch` to make the smallest in-ownership implementation that satisfies the test.
4. Re-run the focused test and require it to pass.
5. **Refactor:** improve structure only while the focused test remains green, then run the assignment's exact verification command.
6. Repeat for the next distinct acceptance criterion without broad speculative changes.

For docs-only or config-only work where a behavioral test would be artificial, replace red with a deterministic failing parse, lint, schema, reference, or static invariant check. Record why that check is the correct gate. Never fabricate a test merely to claim test-first work.

If the existing test suite has no viable seam and adding one would exceed ownership, return blocked with the exact missing path or contract needed.

## Design and ownership

- Treat `design_contract` as law. Verify exact values against its cited source, not memory or visual approximation.
- Edit only `ownership.editable`. A small additional edit is allowed only when concrete evidence proves the assigned change cannot work without it; name the path and evidence in `context_expansion`.
- If a necessary edit is outside ownership and is not that bounded correction, stop and return blocked.
- Do not perform unrelated cleanup, broad formatting, dependency upgrades, state transitions, or generated-file rewrites outside the assignment.

## Verification

Run the exact supplied command from the intended working directory. Report the literal command and pass or fail. Do not substitute a cheaper command or claim success from inspection.

Browser-observable behavior should use the supplied browser test when the project supports one. Machine checks do not prove pixel-level appearance; report the cited design source so the orchestrator can request visual sign-off.

For a batch, implement items in the supplied dependency order and run the single strictest end-of-batch command once. Return one result block per item in the same order, and list only that item's changed files.

## Result contract

Ready:

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

Blocked uses the same fields with `status: blocked`, the current changed files, and `tests: <command> fail|not run - <reason>`. Put the concrete reason and next step in `notes`.

If a capability call itself fails, begin notes with:

```text
tool_failure: <capability> <bounded arguments summary> -> <error>
```

If an account budget cap stops work, do not retry. Write `.specs-inferno/halt-notes/<work-item-id>.md` with completed work, partial work, touched files, test or compile state, and the exact next step. Leave partial edits uncommitted and return:

```yaml
work_item: item-3
status: halted
note: .specs-inferno/halt-notes/item-3.md
changed_files:
  - src/app/foo.ts
```

Return only the YAML block or ordered blocks. Do not include file bodies, diffs, logs, or reasoning traces.
