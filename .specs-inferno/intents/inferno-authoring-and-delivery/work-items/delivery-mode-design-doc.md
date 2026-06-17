---
work_item: delivery-mode-design
intent: inferno-authoring-and-delivery
created: 2026-06-17T00:00:00Z
mode: autopilot
checkpoint_1: approved
---

# Design: merge-request delivery mode

## Summary

Add a `delivery.mode` toggle to the INFERNO orchestrator. `auto-close` (default)
is today's behavior unchanged: serialized direct commits onto the intent branch,
a local merge into the base branch at finalize, worktree teardown, and push.
`merge-request` ("production") instead lands each work item on the intent branch
through a **non-blocking** per-item merge request, and at finalize pushes the
intent branch and opens a single **intent → base** merge request as the one human
review gate — then stops, leaving the worktree intact. Merge-request actions are
forge-aware (gh / glab) and degrade gracefully when no forge CLI is present.

## Scope

**In Scope:**
- A `delivery.mode` toggle read from `.specs-inferno/config.yaml` (absent → `auto-close`).
- Per-item non-blocking MRs into the intent branch in `merge-request` mode.
- An intent → base MR at finalize in `merge-request` mode, base proposed + confirmed.
- Forge abstraction over gh (GitHub) and glab (GitLab), with graceful degradation.

**Out of Scope:**
- Changing `auto-close` behavior in any observable way.
- CI configuration, required-reviewer rules, or auto-merge policy on the forge.
- Per-tier effort and the scribe fan-out (other work items).
- Pushing/merging the intent → base MR for the user (that is the human gate).

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Per-item MRs blocking? | **Non-blocking** (opened for record / auto-merge) | A blocking per-item review gate stalls the dependency frontier — a dependent item could not build until a human merged its predecessor. Non-blocking keeps the parallel autopilot intact. |
| The single human gate | The **intent → base** MR | One reviewable PR per intent is what "production" delivery wants; the orchestrator stops there rather than merging locally. |
| Per-item branch mechanics | **Branch-at-integration** in the one shared worktree | Preserves the single-worktree + serial-integration model. Safe because work items have disjoint `ownership.editable`, so checking out an item branch never conflicts with other in-flight items' uncommitted edits. |
| Forge selection | Detect `gh`, else `glab`, at runtime | Keeps the flow host-neutral; no hardcoded forge. |
| No forge CLI present | Degrade: push branches, skip MR creation, report | Never hard-fail an otherwise-green build; the user opens MRs manually from the pushed branches. |
| Base branch | `delivery.base_branch` → else propose + confirm | The intent must merge somewhere; the user owns that target. |

## Technical Approach

### Architecture

```
delivery.mode = auto-close (default)         delivery.mode = merge-request
---------------------------------            ------------------------------------------
builder -> edits in shared worktree          builder -> edits in shared worktree
orchestrator: stage item files               orchestrator (branch-at-integration):
  -> commit on intent branch                   P = intent HEAD
                                                git checkout -b inferno-item/<intent>/<id> P
... all items integrate ...                    git add <item ownership.editable>; commit C
                                                push item branch; open MR (head=item, base=intent)
finalize:                                       merge item branch -> intent (non-blocking)
  full verification on intent tree              git checkout intent   (other items' unstaged
  merge intent -> base (local)                   edits ride along; disjoint => no conflict)
  kill worktree processes; remove worktree     ... next ready item repeats from new intent HEAD ...
  push base                                   finalize:
                                                full verification on intent tree
                                                push intent branch
                                                open MR (head=intent, base=<confirmed base>)
                                                STOP — no local merge, no teardown, no base push
```

### Branch-at-integration, step by step (merge-request mode, per item)

The orchestrator already integrates items one at a time and stages only the
item's own files. In `merge-request` mode each integration becomes:

1. `P` = current intent-branch HEAD. `git checkout -b inferno-item/{intent}/{item-id} P`.
2. `git add <item ownership.editable>` (only this item's files; other in-flight
   items' edits stay unstaged in the shared tree).
3. Commit on the item branch → real diff of just this item vs `P`.
4. Push the item branch; open a non-blocking MR (head = item branch, base = intent
   branch) for record / CI / auto-merge.
5. Merge the item branch into the intent branch locally (fast-forward), then
   `git checkout {intent-branch}`. Disjoint ownership guarantees the carried-over
   unstaged edits of other items never conflict with the checkout.
6. Update `.specs-inferno/state.yaml` (item completed) as today, recompute the
   frontier, dispatch newly unblocked items.

Dependency scheduling is unchanged, so by the time a dependent integrates, its
predecessors are already merged into the intent branch.

### Forge abstraction

A small runtime probe: prefer `gh` if on PATH and authenticated, else `glab`,
else "none". MR creation maps to `gh pr create --base <base> --head <head> --title … --body …`
or `glab mr create --target-branch <base> --source-branch <head> --title … --description …`.
"none" → push the branch and emit a clear line telling the user to open the MR
manually; do not fail the run.

## Affected Files

| File | Action | Purpose |
|------|--------|---------|
| `src/flows/inferno/agents/orchestrator/agent.md` | modify | Make `<dispatch_loop>` integrate step and `<finalize>` mode-aware; add forge + base-branch handling |
| `src/flows/inferno/agents/orchestrator/config.example.yaml` | (done in config-template) | Documents `delivery.mode` / `delivery.base_branch` |

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Checkout conflict from a non-disjoint edit | medium | Ownership overlap already serializes those items; integration is serial, so only one overlapping item is ever in flight — its edits are committed before the next overlapping item runs |
| Forge CLI missing or unauthenticated in CI/headless | medium | Degrade: push branch, skip MR, report; never hard-fail a green build |
| User expects auto-close but configured production | low | First-run config UX states the delivery choice in plain language; default remains `auto-close` |
| Intent → base MR left open forever | low | That is the intended human gate; the orchestrator reports the MR URL and stops |

## Implementation Checklist

- [ ] Read `delivery.mode` (+ `delivery.base_branch`) from config; absent → `auto-close`
- [ ] `auto-close` path identical to current `<finalize>` (merge + teardown + push)
- [ ] `merge-request` integrate: branch-at-integration + push + non-blocking per-item MR
- [ ] `merge-request` finalize: verify, push intent branch, open intent → base MR, STOP
- [ ] Base branch resolved from config/state or proposed-and-confirmed
- [ ] Forge probe (gh → glab → none) with graceful degradation and clear reporting
- [ ] Preserve all token-discipline and safety constraints; no FIRE-namespace references

---
*Generated by specs.md - fabriqa.ai INFERNO Flow | Checkpoint 1 approved: 2026-06-17*
