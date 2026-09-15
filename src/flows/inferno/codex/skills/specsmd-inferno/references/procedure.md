# Codex INFERNO orchestration procedure

This procedure adapts the canonical INFERNO lifecycle to Codex. The canonical scripts, templates, state and work-item formats remain the source of truth.

## Paths and invariants

- State: `.specs-inferno/state.yaml`
- Codex configuration: `.specs-inferno/config.codex.yaml`
- Intent artifacts: `.specs-inferno/intents/<intent-id>/`
- Work items: `.specs-inferno/intents/<intent-id>/work-items/<item-id>.md`
- Halt notes: `.specs-inferno/halt-notes/`
- Run script, one subcommand per mechanical step: `.specsmd/inferno/agents/orchestrator/skills/orchestrate/scripts/run.cjs` (exit 0 ok, 1 usage, 2 failure, 3 gate needed)
- Ledger writer: `.specsmd/inferno/agents/orchestrator/skills/orchestrate/scripts/state-transition.cjs`
- Selection template: `.specsmd/inferno/agents/orchestrator/skills/orchestrate/templates/intent-selection.md.hbs`
- Codex gate plan: `node scripts/specs-inferno-codex-gate.mjs <worktree>` prints the gate's commands and scopes without running them

Do not read `.specsmd/inferno/memory-bank.yaml` and never edit a canonical flow resource during a run. Read applicable `AGENTS.md` instructions before work and again in a nested scope.

The session's main thread is the orchestrator: it owns interactive intent selection and then the selected run, on the session's own model and effort. Builders never commit, update state, spawn nested agents or choose extra work. One intent uses one dedicated worktree; never create per-item worktrees.

## Phase A: discovery and selection

Complete this phase before claiming anything.

1. Confirm state exists. If it does not, tell the user to plan with `$specsmd-inferno-planner` and stop.
2. Read state and scan all work-item specs with `rg --files .specs-inferno/intents`.
3. Compute the runnable set from disk: status `pending`, one or more pending work items, every `depends_on_intents` entry `completed`.
4. List `in_progress` intents with `claimed_at` and `claimed_by`, pending intents with unmet prerequisites with those ids, and report intent-level dependency cycles. Run `run.cjs select --config .specs-inferno/config.codex.yaml` in the same batch; every `leftover` line names a worktree a finished run left standing, so tear each down with `run.cjs teardown --tree <path> --config .specs-inferno/config.codex.yaml` before the menu. The scripts print their own refusals; report one, never work around it.
5. A user-named intent passes the same prerequisite gate; naming it never bypasses dependencies.
6. For a named `in_progress` intent, a live process or a branch advancing since this session began is running elsewhere, a stale branch or worktree without a process is recoverable, and a stale claim with neither can be reclaimed.
7. If no intent was named, render a numbered menu: for one entry ask for yes or no, for several ask for the number. Show running and blocked intents for context, never offer them.
8. Stop the turn and wait. Never auto-select, and never claim, create a worktree or dispatch before the user confirms.
9. After confirmation, continue in this thread at Phase B with the selected intent id, the relevant user constraints and authorization, and whether recovery evidence was found. Never spawn a subagent to run Phase B in your place.

## Phase B: activate and claim

Continue in this thread from here.

1. In one batched read, load the applicable `AGENTS.md` files, state, Codex config, every pending work-item spec for this intent, the halt flag, UTC time, the worktree list and branch status.
2. Read configuration once. Missing keys use canonical behavior: `delivery.mode: auto-close` and the discovered build and full tests for final verification. `verification.finalize_scopes` narrows a gate command to the paths worth running it on, `worktree.bootstrap` runs in a fresh worktree, and `dispatch.constraints` is pasted verbatim into every dispatch.
3. Validate every pending work item before creating a worktree with `run.cjs frontier <intent-id> --tree <path>`. It checks the manifest fields and the dependency graph and names the exact missing field; hand a manifest defect to the planner skill for a bounded repair and never claim or dispatch an invalid item.
4. For recovery, inspect the intent branch's commits and run:

   ```sh
   node .specsmd/inferno/agents/orchestrator/skills/orchestrate/scripts/state-transition.cjs check --intent <intent-id>
   ```

   Mark with `complete-item` only work present on the branch but absent from the ledger; never redispatch landed work.
5. For a fresh or stale-claim run, claim on the default branch before the worktree with `run.cjs claim <intent-id> --config .specs-inferno/config.codex.yaml`: it sets `in_progress` and `claimed_at`, sets `claimed_by` to the intended `inferno-intent/<id>-<timestamp>` branch, and commits `specsmd(<id>): claim intent for run`.
6. Choose an explicit `<path>` inside the current writable roots, then create one clean worktree from that claim commit on branch `inferno-intent/<id>-<timestamp>` with `run.cjs worktree <intent-id> --config .specs-inferno/config.codex.yaml --path <path>`. It runs every `worktree.bootstrap` command there once, before the first dispatch. An in-place run needs an explicit user override.

If a fresh run is abandoned before any item integrates, run `run.cjs unclaim <intent-id> --config .specs-inferno/config.codex.yaml`. A halted run retains its claim.

## Dependency-frontier scheduler

Repeat until all items are completed or the run blocks or halts.

1. Build the graph from `depends_on`. Ready items are pending, have completed dependencies, are not in flight, and do not overlap an in-flight or co-selected `ownership.editable` path. `run.cjs frontier` also prints a `candidate` line for every file outside an item that references what the item owns; grant each into the dispatched ownership unless you can say why it is not this item's.
2. Before each frontier, compare the base branch since the merge base across the frontier's editable and required paths. Merge it in before dispatch when relevant changes landed and no work is in flight; when work is in flight, hold only the affected items.
3. Check the configured halt flag before every frontier; a future `resets_at` stops new dispatch.
4. Batch a few consecutive low or medium items only when a serial dependency chain or a shared compile tree prevents parallelism, keeping combined required context near six files. Never batch high-complexity work, different worker tiers, or across a point where disjoint work can run in parallel.
5. Choose the custom builder deterministically:
   - `kind: config-only`, `kind: docs-only`, `kind: test`, or `complexity: low` uses `specsmd_inferno_builder_cheap` on `gpt-5.6-terra` with `high` reasoning;
   - other `complexity: medium` or `high` work uses `specsmd_inferno_builder_strong` on `gpt-5.6-sol` with `xhigh` reasoning.
   Kind-based cheap routing takes precedence; never down-tier medium or high work by intuition. A cheap build that fails integration review once is re-dispatched to the strong role with the findings, never corrected twice on the cheap role.
6. Use `spawn_agent` with `fork_turns: "none"` and the role's `agent_type` for the items or approved batches in the frontier, in one dispatch round. The prompt contains only:
   - intent and work-item ids, worktree and work-item spec paths, the spec to be read first;
   - the item's `context` manifest and `ownership.editable` verbatim, and `design_contract` verbatim when present;
   - the exact verification command, as the whole verification budget;
   - `dispatch.constraints` pasted verbatim;
   - firewall files by name with the sanctioned alternative for each;
   - already-landed dependency outputs, semantics that must survive, skipped items and known hazards;
   - every `drift` line from `run.cjs probes <item-id> --tree <path>`, run in the dispatching round and again after every base fold.
   Pass pointers, not file bodies or broad search instructions. Never ask for residual risks: that slot is how a builder parks a defect it could have fixed.
7. Use `wait_agent` until every dispatched builder returns, tracking each outstanding worker by id.

## Recovery

Call `wait_agent` with `timeout_ms: 1200000`, exactly. A builder returns once, so a wake with no envelope is answered by waiting again, never by a status request or a nudge. A timeout wake is one `git -C <tree> diff --stat` compared with the previous one, the stall criteria below, and `wait_agent` again; the one other thing it may do is review an item that already returned. A dispatched item's spec is frozen until its builder returns, and the turn never ends while a worker is out.

A builder is stuck when any one of these holds:

- two consecutive diff stats are the same and `/tmp/claude-build.log` shows no build for its tree: the last line naming `[<tree>]` is a `done` line, or there is none. A `DUPLICATE` line means the earlier copy still runs. `ps` sees nothing across sandboxes and proves nothing;
- the same check failed three times on a tree whose non-test files did not change between them;
- it wrote a file outside the worktree and the runner's log directory;
- `wait_agent` returned an error instead of a wake, so its turn died or an approval review timed out.

Then climb this ladder, asking nobody:

1. First stall: `interrupt_agent`, then one `followup_task` naming what the worktree holds and setting a bound: return the envelope, `ready` or `blocked` with the cause and the failing line.
2. No envelope by the bound, or a second stall on the same item: interrupt for good and read the worktree diff. Finish the remaining slice in this thread when the diff and the spec make it clear, otherwise dispatch one fresh builder for that slice only, naming what the tree holds and the failure that stopped its predecessor. Never both, never a third builder on one slice.
3. A dead turn is retried once with the same call; a second death takes step 2. Two defensible readings of the spec go to the oracle once, and its decision rides in the followup or fresh dispatch.

Read the machine before reading a red gate or integrate step. The result is void when `/proc/pressure/memory` shows `some avg60` above 25 or `/proc/loadavg` a one-minute load above 8, and the failures share one launch or timeout signature across files different items own. Wait in one bounded shell command until the pressure is under 25, then run it once more.

## Builder result and bounded retries

A single item returns the envelope in the builder procedure. Allowed statuses are `ready`, `blocked` and `halted`; a batch returns one block per item in dependency order.

- Malformed output (empty, prose-only, missing keys) gets one `followup_task` with the result contract and the missing fields; a second malformed result blocks the run.
- A blocked result beginning `tool_failure:` gets one evidence-based retry: a missing path located with `rg`, a fresh read for a stale edit fingerprint, or a bounded error line for a shell failure. A permission denial is answered once with the sandboxed form of the command; only a genuinely missing authorization goes to the user. A second failure blocks.
- A blocked result whose failing line comes from the build wrapper (a run cap kill, a queue refusal) or from the sandbox (`EPERM`, a read-only path) is an environment failure and never a code defect: it goes to the oracle once with that line and what the tree holds, and its decision rides in one fresh dispatch or ends the item in two sentences. No such result waits for a person.
- A normal blocked result stops dependent dispatch, preserves the worktree and reports the reason, changed files, failing command and next step. A halted one is not retried.
- Preserve a halted item's partial edits and proceed to halt finalization.

## Serialized integration

Process ready results one at a time.

1. Reject noisy output. Review from the result block, `run.cjs verify-item <item-id> --tree <path>` and `git diff --stat`, and open a changed file only when one of those raises a question. Check `changed_files` against `ownership.editable`; accept an extra file only on evidence that the assigned change requires it.
2. `verify-item` and `integrate` confirm the builder's checks; do not replay a focused check by hand. For a `design_contract`, require verification against the cited source. A note naming a defect the builder saw and left, a residual or a product call is postponed work: send it back with `followup_task` before integrating, never into the ledger, the report or the user's lap.
3. Stage only that item's changed files, never the entire tree, and commit directly on the intent branch for `auto-close`.
4. Then run:

   ```sh
   node .specsmd/inferno/agents/orchestrator/skills/orchestrate/scripts/run.cjs integrate --item <item-id> --tree <path> --config .specs-inferno/config.codex.yaml
   ```

   It folds the base branch in, runs `verification.integrate` and only then completes the item with the sha those checks proved. Non-zero names the failing command, and every failure goes to the still-warm builder in one correction. Never mark an item completed by hand.
5. For `merge-request`, commit the same exact paths on an item branch off the current intent head, push, open a non-blocking item-to-intent request, merge it serially and return to the intent branch. Without a forge, push and report the request details.
6. For a batch, commit once and pass every id to one `integrate --items <a,b> --tree <path> --config .specs-inferno/config.codex.yaml`. Recompute the frontier immediately after.

## Halt and resume

On a halt, write `.specs-inferno/halt-notes/_intent-<intent-id>.md` with the intent, worktree, the completed, halted and never-dispatched partitions, note pointers and frontier. Leave halted items pending and uncommitted and keep the worktree and claim.

On resume, read that note, reconcile state from disk, and dispatch ready halted or pending items. Give a resumed builder its note path and require it to assess partial edits first.

## Final verification and delivery

Finalize automatically once no work remains.

1. Fold the base branch into the intent branch first (`git fetch origin <base>` then `git merge --no-edit origin/<base>`), resolving any conflict there so both goals survive. Inspect the plan with `node scripts/specs-inferno-codex-gate.mjs <worktree>`, then gate that folded tree once: `run.cjs gate --detach --tree <path> --config .specs-inferno/config.codex.yaml`, then `run.cjs gate --wait --tree <path> --config .specs-inferno/config.codex.yaml`. The runner skips a `finalize_scopes` command no changed path matches; that list is the gate and it runs once per intent. Run a work-item `finalize_check` only for a scoped invariant the list does not cover. The binary journeys never run in a run: a criterion naming a case is met by its text and its test, and the harness refuses a Codex session by name. Non-zero blocks close. Never de-parallelize the gate, add retries to mask flake, or poll in a loop.
2. Run ledger reconciliation:

   ```sh
   node .specsmd/inferno/agents/orchestrator/skills/orchestrate/scripts/state-transition.cjs check --intent <intent-id>
   ```

   Reconcile only demonstrably integrated work, then require exit zero.
3. Close through the single writer, committing only the resulting intent artifacts:

   ```sh
   node .specsmd/inferno/agents/orchestrator/skills/orchestrate/scripts/state-transition.cjs close-intent --intent <intent-id>
   ```

   Its refusal over open items is authoritative. Then archive, so the live ledger holds open work only:

   ```sh
   node .specsmd/inferno/agents/orchestrator/skills/orchestrate/scripts/state-transition.cjs archive-intent --intent <intent-id> --sweep
   ```

   Commit both as `specsmd(<intent-id>): close intent`, staging only the ledger, the archive and this intent's directory.
4. Before delivery, run `run.cjs green --tree <path> --config .specs-inferno/config.codex.yaml` and require exit zero. In `auto-close`, resolve the primary working tree, verify it is on the base branch, then absorb the remote base and merge the intent branch from there, both merges with `--autostash`. Compare `HEAD^{tree}` on the base with the intent branch's tree: equal means the base holds the tree the gate passed, so push; unequal means the base moved, so fold it in, gate once more, merge and compare again. That loop is the only post-merge rerun. Once the push has landed, tear the worktree down:

   ```sh
   node .specsmd/inferno/agents/orchestrator/skills/orchestrate/scripts/run.cjs teardown --tree <worktree> --config .specs-inferno/config.codex.yaml
   ```

   It stops the worktree's processes, removes the worktree and deletes the branch, and refuses while the base does not hold the branch, the tree is dirty, or the ledger has the intent in progress. The intent is not finished while its worktree stands.
5. In `merge-request`, keep the worktree and branch, push it, and open one intent-to-base request as the review gate, stopping only processes spawned in the worktree. Without a forge, report the head, base and title.
6. Report the run in one shape. For an actually finished, verified and delivered intent the exact first line is `INTENT FINISHED {intent-id}`, with the full actual intent id substituted, emitted once and preserved verbatim. A blocked, halted, failed or delivery-pending intent, including one with an open merge request, uses `Intent HALTED <id>`, `Intent BLOCKED <id>`, `Intent FAILED <id>` or `Intent PENDING <id>` instead. Then a small block in plain language: what changed for the user of the product, what was verified, what shipped and its sha or why it did not, and only when something genuinely needs the user a last line starting `Needs you:`. No headers, no inventories, no process narration.

Never force destructive cleanup, discard another session's edits, guess a base branch or hide an unmerged intent.
