# Codex INFERNO orchestration procedure

This procedure adapts the canonical INFERNO lifecycle to Codex. The canonical scripts, templates, state, and work-item formats remain the source of truth.

## Paths and invariants

- State: `.specs-inferno/state.yaml`
- Codex configuration: `.specs-inferno/config.codex.yaml`
- Intent artifacts: `.specs-inferno/intents/<intent-id>/`
- Work items: `.specs-inferno/intents/<intent-id>/work-items/<item-id>.md`
- Halt notes: `.specs-inferno/halt-notes/`
- Run script, one subcommand per mechanical step: `.specsmd/inferno/agents/orchestrator/skills/orchestrate/scripts/run.cjs` (exit 0 ok, 1 usage, 2 failure, 3 gate needed)
- Ledger writer: `.specsmd/inferno/agents/orchestrator/skills/orchestrate/scripts/state-transition.cjs`
- Scheduler helpers behind `run.cjs frontier`: `.specsmd/inferno/agents/orchestrator/skills/orchestrate/scripts/team-scheduler.cjs`
- Selection template: `.specsmd/inferno/agents/orchestrator/skills/orchestrate/templates/intent-selection.md.hbs`

Do not read `.specsmd/inferno/memory-bank.yaml`. Never edit a canonical flow resource during a run. Read applicable `AGENTS.md` instructions before work and again when entering a nested scope.

The parent conversation owns interactive intent selection. The delegated orchestrator owns the selected run. Builders never commit, update state, spawn nested agents, or choose extra work. One intent uses one dedicated worktree; never create per-item worktrees.

## Phase A: parent-thread discovery and selection

Complete this phase before spawning the orchestrator.

1. Confirm state exists. If it does not, tell the user to plan with `$specsmd-inferno-planner` and stop.
2. Read state and scan all work-item specs with `rg --files .specs-inferno/intents`.
3. Compute the runnable set from disk:
   - intent status is `pending`;
   - it has at least one pending work item;
   - every intent in `depends_on_intents` is `completed`.
4. List `in_progress` intents separately with `claimed_at` and `claimed_by`. List pending intents with unmet prerequisites separately with those prerequisite ids. Detect and report intent-level dependency cycles.
5. A user-named intent must pass the same prerequisite gate. Naming it never bypasses dependencies.
6. For a named `in_progress` intent, distinguish a live run from a dead run using process, worktree, branch, and recent-commit evidence:
   - a worktree with a live process or a branch advancing after this session began is running elsewhere;
   - a stale branch or worktree without a process is recoverable;
   - a stale claim with neither branch nor worktree can be reclaimed.
7. If no intent was named, render a numbered menu. For one entry, ask for explicit yes or no. For several, ask for the number. Show running and blocked intents for context, but never offer them.
8. Stop the turn and wait. Do not auto-select and do not spawn an agent before the user confirms.
9. Spawn `specsmd_inferno_orchestrator` only after confirmation. Pass the selected intent id, repository root, this procedure path, and whether recovery evidence was found. The custom agent runs on `gpt-5.6-sol` with `xhigh` reasoning.

## Phase B: activate and claim

The delegated orchestrator begins here.

1. In one batched read, load the applicable `AGENTS.md` files, state, Codex config, every pending work-item spec for the selected intent, the halt flag when configured, UTC time, worktree list, and relevant branch status.
2. Read configuration once. Missing keys use canonical behavior: `delivery.mode: auto-close`, discovered project build and full tests for final verification, and no halt or knowledge integration. `verification.finalize_scopes` narrows a gate command to the paths that make it worth running, `worktree.bootstrap` lists commands run in a fresh worktree, and `dispatch.constraints` lists machine rules pasted verbatim into every dispatch.
3. Validate every pending work item before creating a worktree, with `run.cjs frontier <intent-id> --tree <path>` where Node is available:
   - `context.required` is non-empty;
   - `ownership.editable` is non-empty;
   - `context.patterns` is non-empty for behavior, architecture, UI, or API work;
   - `context.tests` is non-empty unless explicitly docs-only or config-only;
   - dependencies refer to known items and are acyclic.
   Stop and report exact missing fields if any item is invalid.
4. For recovery, inspect commits on the intent branch and run:

   ```sh
   node .specsmd/inferno/agents/orchestrator/skills/orchestrate/scripts/state-transition.cjs check --intent <intent-id>
   ```

   Mark with `complete-item` only work proven present on the branch but absent from the ledger. Never redispatch landed work.
5. For a fresh or stale-claim run, claim on the default branch before worktree creation: set intent status to `in_progress`, add ISO `claimed_at`, and set `claimed_by` to the intended `inferno-intent/<id>-<timestamp>` branch. Stage only state plus this intent's artifacts and commit `specsmd(<id>): claim intent for run`.
6. Create one clean worktree from that claim commit on branch `inferno-intent/<id>-<timestamp>`, then run every `worktree.bootstrap` command inside it before the first dispatch. An in-place run is allowed only after an explicit user override.

If a fresh run is abandoned before any item integrates, revert the claim to pending and commit that reversal. A halted run retains its claim.

## Dependency-frontier scheduler

Repeat until all items are completed or the run blocks or halts.

1. Build the graph from `depends_on`. Ready items are pending, have completed dependencies, are not in flight, and do not overlap any in-flight or co-selected `ownership.editable` path.
2. Before each frontier, compare the base branch since the merge base across the frontier's editable and required paths. If relevant base changes landed, merge the base into the intent branch before dispatch when no work is in flight. When work is in flight, hold only affected items until refresh.
3. Check the configured halt flag before every frontier. A future `resets_at` stops new dispatch.
4. Batch roughly two to four consecutive low or medium items only when a serial dependency chain or shared compile tree prevents parallelism. Keep combined required context near six files. Never batch high-complexity work, different worker tiers, or across a point where disjoint work can run in parallel.
5. Choose the custom builder deterministically:
   - `kind: config-only`, `kind: docs-only`, `kind: test`, or `complexity: low` uses `specsmd_inferno_builder_cheap` on `gpt-5.6-terra` with `high` reasoning;
   - other `complexity: medium` or `high` work uses `specsmd_inferno_builder_strong` on `gpt-5.6-sol` with `xhigh` reasoning.
   Kind-based cheap routing takes precedence. Do not down-tier medium or high work by intuition. A cheap build that fails integration review once is re-dispatched to the strong role with the review findings, never corrected twice on the cheap role. When the project ships its own tester agent, spawn it with `models.tester_high` for a high-complexity item or intent and with `models.tester` otherwise.
6. Use `spawn_agent` for every item or approved batch in the frontier in the same dispatch round. The prompt contains only:
   - intent and work-item ids;
   - worktree and work-item spec paths;
   - the item's `context` manifest and `ownership.editable` verbatim;
   - `design_contract` verbatim when present;
   - the exact verification command, as the whole verification budget;
   - `dispatch.constraints` pasted verbatim;
   - firewall files by name with the sanctioned alternative for each;
   - already-landed dependency outputs, semantics that must survive, skipped items, and specific known hazards.
   Pass pointers, not file bodies or broad search instructions. Never ask for residual risks: that slot is how a builder parks a defect it could have fixed.
7. Use `wait_agent` until every dispatched builder returns. Keep an in-memory audit keyed by item id and attempt with dispatch time, status, and first failure line.

## Builder result and bounded retries

A single item returns exactly:

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

Allowed statuses are `ready`, `blocked`, and `halted`. A batch returns one block per item in dependency order.

- Empty, prose-only, or missing-key output is malformed. Use `followup_task` once with the exact result contract and missing fields. A second malformed result blocks the run.
- A blocked result beginning `tool_failure:` gets one evidence-based retry using `followup_task`: locate a missing path with `rg`, require a fresh read for a stale edit fingerprint, or include a bounded error line for a non-test shell failure. Permission denial and unknown failures go to the user without retry. A second failure blocks.
- A normal blocked result stops dependent dispatch, preserves the worktree, and reports the reason, changed files, failing command, and next step.
- A halted result is not retried. Preserve partial edits and proceed to halt finalization.

## Serialized integration

Process ready results one at a time.

1. Reject noisy output. Review from the result block, `run.cjs verify-item <item-id> --tree <path>` and `git diff --stat`, and open a changed file only when one of those raises a question. Check `changed_files` against `ownership.editable`; accept an extra file only when the result gives concrete evidence that the assigned change requires it.
2. Run or independently confirm the assigned verification. For a `design_contract`, require explicit verification against the cited source. A note naming a defect the builder saw and left, a residual or a product call is postponed work: send it back to the same agent with `followup_task` before integrating, never into the ledger, the report or the user's lap.
3. Before staging or committing, run:

   ```sh
   node .specsmd/inferno/agents/orchestrator/skills/orchestrate/scripts/state-transition.cjs complete-item --intent <intent-id> --item <item-id>
   ```

   Non-zero is a bookkeeping failure to fix, never a reason to edit state by hand.
4. Stage only that item's changed files, state, and the work-item markdown synchronized by the ledger writer. Never stage the entire tree. Commit directly on the intent branch for `auto-close`.
5. For `merge-request`, create an item branch from current intent head, commit the same exact paths, push, open a non-blocking item-to-intent merge request when a forge is available, merge it into the intent branch serially, and return to the intent branch. If no forge is available, push and report the request details for manual creation.
6. For a batch, transition every item, then one commit may name the batch. Recompute the frontier immediately after integration.

## Halt and resume

On a halt, partition completed, halted, and never-dispatched items. Write `.specs-inferno/halt-notes/_intent-<intent-id>.md` with the intent, worktree, partitions, note pointers, and frontier. Leave halted items pending and uncommitted, preserve the worktree and claim, and run the configured waiter when present. Otherwise report manual resume.

On resume, read the intent halt note, reconcile state from disk, and dispatch ready halted or pending items. Give a resumed builder its note path and require it to assess existing partial edits before continuing.

## Final verification and delivery

Finalize automatically once no work remains.

1. Fold the base branch into the intent branch first (`git fetch origin <base>` then `git merge --no-edit origin/<base>`), resolving any conflict there so both goals survive, then run the gate once on that folded tree: `run.cjs gate --tree <path>` where Node is available, otherwise every `verification.finalize` command in order, or the project's production build and full test suite when absent. A command listed in `verification.finalize_scopes` is skipped when no changed path matches it; an unlisted command always runs. That list is the gate and it runs once per intent. Run a work-item `finalize_check` only when it is a scoped invariant the list does not cover; one that repeats a listed command or the same suite under another filter is not run again. Non-zero blocks close. Never de-parallelize the gate, add retries to mask flake, or poll in a loop while waiting.
2. Run ledger reconciliation:

   ```sh
   node .specsmd/inferno/agents/orchestrator/skills/orchestrate/scripts/state-transition.cjs check --intent <intent-id>
   ```

   Reconcile only work that is demonstrably integrated, then require exit zero.
3. Close through the single writer and commit only the resulting intent artifacts:

   ```sh
   node .specsmd/inferno/agents/orchestrator/skills/orchestrate/scripts/state-transition.cjs close-intent --intent <intent-id>
   ```

   Its refusal over open items is authoritative.
4. In `auto-close`, resolve the primary working tree, verify it is on the base branch, absorb the current remote base and merge the intent branch from the primary tree, both merges with `--autostash` so another session's uncommitted edits are parked and restored. Then compare `HEAD^{tree}` on the base with the intent branch's tree: equal means the base holds exactly the tree the gate passed, so push and rerun nothing; unequal means the base moved, so fold it in again, run the gate once more, merge and compare again. That loop is the only post-merge rerun. Resolve ordinary conflicts by preserving both compatible goals; ask only about irreducible contradictions. Stop worktree-owned processes, remove the merged worktree from the primary tree, and delete the merged branch.
5. In `merge-request`, keep the intent worktree and branch, push the intent branch, and open one intent-to-base merge request as the review gate. Stop only processes spawned in the worktree. If no forge is available, report the exact head, base, and title.
6. Report the run in one shape. The first line is the status in capitals with the intent id: `Intent FINISHED <id>`, `Intent HALTED <id>`, `Intent BLOCKED <id>` or `Intent FAILED <id>`. Then a small block in plain language: what changed for the user of the product without file paths, what was verified in one line, what shipped as the merged branch and its sha or why it did not, and only when something genuinely needs the user a last line starting `Needs you:`. At most eight lines, no headers, no inventories, no process narration.

Never force destructive cleanup, discard another session's edits, guess a base branch, or hide an unmerged completed intent.
