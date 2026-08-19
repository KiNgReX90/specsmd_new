# AGENTS.md

Canonical source for the specsmd **INFERNO** flow tooling (agents, commands, skills) across Claude Code, Cursor, and Codex. This file carries only the specsmd-relevant guidance; it is project-agnostic on purpose.

## INFERNO

INFERNO is this project's specsmd flow: a standalone, autonomous, parallel build flow chosen at install time *instead of* FIRE. It has its own `.specs-inferno/` artifact namespace and shares no state with FIRE. Because the standalone flow ships exactly one planner, there is no "which planner?" routing decision and no policy hook.

**Lifecycle:** intent → auto-decomposed work items → one intent worktree → parallel autopilot builders → orchestrator-verified merge. Planning autonomy is config-driven via `autonomy.level` in `.specs-inferno/config.codex.yaml`. Coupled work items serialize naturally through `depends_on`; independent items build concurrently without edit collisions.

**specsmd owns the artifacts.** Intents, work items, runs, `.specs-inferno/state.yaml`, walkthroughs. Don't author scratch plans or ad-hoc TodoWrite lists that should have been work items or runs.

## Source of truth and build/eval workflow

This repo is self-contained: the flow's source of truth lives here under `src/flows/inferno/`, the full `specsmd` package (`src/`, `package.json`, all flows) is vendored into this repo. To change the flow and validate it:

1. Edit the flow sources under `src/flows/inferno/`.
2. `cd src && npm run validate:all`.
3. `npm pack` to build a tarball.
4. Drop the tarball in this repo's `evals/dist/`.
5. Run `evals/install-eval.sh <tarball>` (deterministic install eval).
6. Run the e2e smoke harness under `evals/e2e/`.

The installed builder agent is kept in sync with its canonical source by a drift **test** (no codegen/sync script).

## Per-project config

Project- and machine-specific Codex values live in `.specs-inferno/config.codex.yaml`: role routing, finalize verification commands, `autonomy.level`, and optional `halt.*` / `knowledge.index` keys. The `$specsmd-inferno-config` skill scaffolds it through a display-and-confirm first-run gate. Claude keeps its separate `.specs-inferno/config.yaml`; never read or alter that file as Codex configuration.

## Budget-cap halt

When `halt.flag_file` / `halt.wait_script` are set in `.specs-inferno/config.codex.yaml`, builders and the orchestrator honor that budget HALT flag: a gated builder writes a halt-note (`.specs-inferno/halt-notes/<work_item_id>.md`) and returns `status: halted` (never re-dispatched); the orchestrator writes an intent-handoff, waits for the reset, then resumes the halted/pending items. Without halt config the gate is skipped and a halted run resumes manually.

## Close your own intent automatically; never touch another session's

When an intent is complete, run this sequence yourself, every time, without asking and without stopping at local commits:

1. **Commit the close artifacts** (`.specs-inferno/state.yaml` + the work-item statuses) on YOUR branch.
2. **Merge** YOUR intent worktree/branch into the default branch.
3. **Tear down the worktree if present:** first kill ONLY the processes THAT worktree spawned (its dev-server port/PID, any MCP/sidecar process, the build/compile process, and file watchers), then remove the worktree + branch. Never leave a merged worktree, or its processes, alive. A direct-on-branch build (no worktree) just deletes the merged branch.
4. **Push** the default branch to origin.

Scope the process-kill to THIS worktree only: processes whose working directory is inside it, or the specific port/PID it started; never blanket-kill shared toolchain processes that a concurrent session could be using. Other sessions' worktrees (any other `.worktrees/<id>` or `inferno-intent/<other>` branch, even one mid build) are never yours to merge, remove, kill, or ask about. A concurrent worktree is not a blocker and not a question; finish your own and move on.

## Codex and INFERNO activation

- Use `$specsmd-inferno-planner` for INFERNO intent capture, repair, and decomposition. Its parent skill owns questions and the configuration gate before delegation.
- Use `$specsmd-inferno-config` to review or update `.specs-inferno/config.codex.yaml`; confirmation stays in the parent conversation.
- Use `$specsmd-inferno` to select, execute, or resume a planned intent. Intent selection stays in the parent conversation before orchestrator delegation.
- Treat legacy slash-command wording as intent to invoke the matching Codex skill, never as a reason to read or execute another host's command file.
- The orchestrator alone dispatches `specsmd_inferno_builder_strong` and `specsmd_inferno_builder_cheap`; the planner alone dispatches `specsmd_inferno_writer`. Never activate a builder or writer without a complete assignment from its owning role, and never let a worker spawn nested agents.
- Codex source assets live under `src/flows/inferno/codex/`. Claude commands, agents, and `.specs-inferno/config.yaml` remain a separate host surface.
