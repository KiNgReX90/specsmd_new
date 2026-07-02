# CLAUDE.md

This repo is **a privately maintained version of `specsmd`** — the full upstream package (`src/`, `package.json`, and **all flows**) is vendored here and is self-contained. It is a fork of fabriqaai's specsmd; the canonical home is a private GitLab repo. **Never push to the fabriqaai upstream.** This file carries only specsmd-relevant guidance; it is project-agnostic on purpose.

## Flows

All five specsmd flows live under `src/flows/`: `aidlc`, `fire`, `ideation`, `inferno`, `simple`. Any of them can be edited, validated, and shipped from this repo — it is not single-flow.

**INFERNO is the flow currently under active development and dogfooding here**, which is why most of the operational guidance below is INFERNO-specific. That focus is about *current work*, not the repo's scope — the other flows are first-class and live alongside it.

## Source of truth and build/eval workflow

This repo is self-contained: each flow's source of truth lives under `src/flows/<flow>/`. To change a flow and validate it:

1. Edit the flow sources under `src/flows/<flow>/` (e.g. `src/flows/inferno/`).
2. `cd src && npm run validate:all`.
3. `npm pack` to build a tarball.
4. Drop the tarball in this repo's `evals/dist/`.
5. Run `evals/install-eval.sh <tarball>` (deterministic install eval).
6. Run the e2e smoke harness under `evals/e2e/`.

For INFERNO, the installed builder agent is kept in sync with its canonical source by a drift **test** (no codegen/sync script).

## Specsmd owns the artifacts

Each flow's artifacts — intents, work items / bolts, runs, its state file, walkthroughs — are owned by specsmd. Don't author scratch plans or ad-hoc TodoWrite lists that should have been first-class flow artifacts.

---

# INFERNO flow specifics

The sections below apply specifically to the **INFERNO** flow — the standalone, autonomous, parallel build flow under the `.specs-inferno/` artifact namespace.

## What INFERNO is

INFERNO is a standalone specsmd flow chosen at install time *instead of* FIRE. It has its own `.specs-inferno/` artifact namespace and shares no state with FIRE. Because the standalone flow ships exactly one planner, there is no "which planner?" routing decision and no policy hook.

**Lifecycle:** intent → auto-decomposed work items → one intent worktree → parallel autopilot builders → orchestrator-verified merge. Planning depth, the post-write review pause, and the delivery default are all driven by the top-level `mode: production | autonomous` in `.specs-inferno/config.yaml` (legacy `autonomy.level` still maps: review → production, full → autonomous). Coupled work items serialize naturally through `depends_on`; independent items build concurrently without edit collisions.

## Per-project config

Project- and machine-specific values live in an optional `.specs-inferno/config.yaml`: the top-level `mode` (production | autonomous), worker model tiers, finalize verification commands, an optional `delivery.mode` override, and optional `halt.*` / `knowledge.index` keys. Every key is optional; without the file the flow runs on host/project defaults, and the flow files under `.specsmd/` never hardcode these. `npx specsmd install` scaffolds it at install time (an existing config is never overwritten); `/specsmd-inferno-config` is the create-or-edit wizard, and the annotated template is `.specsmd/inferno/agents/orchestrator/config.example.yaml`.

## Budget-cap halt

When `halt.flag_file` / `halt.wait_script` are set in `.specs-inferno/config.yaml`, builders and the orchestrator honor that budget HALT flag: a gated builder writes a halt-note (`.specs-inferno/halt-notes/<work_item_id>.md`) and returns `status: halted` (never re-dispatched); the orchestrator writes an intent-handoff, waits for the reset, then resumes the halted/pending items. Without halt config the gate is skipped and a halted run resumes manually.

## Close your own intent automatically; never touch another session's

When an intent is complete, run this sequence yourself, every time, without asking and without stopping at local commits:

1. **Commit the close artifacts** (`.specs-inferno/state.yaml` + the work-item statuses) on YOUR branch.
2. **Merge** YOUR intent worktree/branch into the default branch.
3. **Tear down the worktree if present:** first kill ONLY the processes THAT worktree spawned (its dev-server port/PID, any MCP/sidecar process, the build/compile process, and file watchers), then remove the worktree + branch. Never leave a merged worktree, or its processes, alive. A direct-on-branch build (no worktree) just deletes the merged branch.
4. **Push** the default branch to origin.

Scope the process-kill to THIS worktree only — processes whose working directory is inside it, or the specific port/PID it started; never blanket-kill shared toolchain processes that a concurrent session could be using. Other sessions' worktrees (any other `.worktrees/<id>` or `inferno-intent/<other>` branch, even one mid build) are never yours to merge, remove, kill, or ask about. A concurrent worktree is not a blocker and not a question; finish your own and move on.
